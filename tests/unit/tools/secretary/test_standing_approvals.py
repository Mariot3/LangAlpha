"""Hand-offs and new workspaces the user approved in advance.

The setting is read when the model proposes the call, not when the tool runs:
a tool that paused for its card re-runs from the top on resume, so reading it
there would let a setting flipped while the card was pending skip an answer
the user already gave.
"""

from __future__ import annotations

import json
from typing import Annotated
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from langchain.agents import create_agent
from langchain.tools import InjectedState
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import tool
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from src.tools.secretary._commands import InjectedToolCallId, hitl_confirm
from src.server.models.user import OtherPreference
from src.tools.secretary.approvals import (
    AUTO_APPROVE_HANDOFFS,
    AUTO_APPROVE_KEYS,
    AUTO_APPROVE_WORKSPACE_CREATION,
    StandingApprovalMiddleware,
    preapproved,
)
from src.tools.secretary.chief_of_staff import delegate_to_analyst
from src.tools.secretary.tools import ptc_agent, workspaces_create
from tests.unit.server.handlers.chat.redis_fakes import FakeCache

from .conftest import FakeResp, FakeSession, workspace_manager

USER_ID = "user-1"


@pytest.fixture
def other_preference(monkeypatch) -> dict:
    """The user's ``other_preference``; tests set approval keys on it."""
    other: dict = {}

    async def get_user_preferences(user_id):
        return {"other_preference": other}

    monkeypatch.setattr(
        "src.server.database.user.get_user_preferences", get_user_preferences
    )
    return other


# --- The decision is frozen at proposal time ---------------------------------


@pytest.fixture
def ran() -> list[str]:
    """The questions the stand-in hand-off actually dispatched."""
    return []


class _Model(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


def _agent(ran: list[str], *questions: str):
    @tool("delegate_to_analyst")
    async def handoff(
        question: str,
        workspace_id: str,
        state: Annotated[dict, InjectedState],
        tool_call_id: Annotated[str, InjectedToolCallId] = "",
    ) -> str:
        """Hand off, asking first unless approved in advance."""
        if not preapproved(state, tool_call_id):
            approved, _ = hitl_confirm("ptc_agent", {"question": question})
            if not approved:
                return f"declined {question}"
        ran.append(question)
        return f"dispatched {question}"

    model = _Model(responses=[
        AIMessage(content="", tool_calls=[
            {
                "name": "delegate_to_analyst",
                "args": {"question": q, "workspace_id": "ws-1"},
                "id": f"call-{q}",
            }
            for q in questions
        ]),
        AIMessage(content="done"),
    ])
    return create_agent(
        model,
        tools=[handoff],
        middleware=[StandingApprovalMiddleware(USER_ID)],
        checkpointer=InMemorySaver(),
    )


def _tool_results(out: dict) -> list[str]:
    return [m.content for m in out["messages"] if m.type == "tool"]


@pytest.mark.asyncio
async def test_a_handoff_approved_in_advance_runs_without_a_card(other_preference, ran):
    other_preference[AUTO_APPROVE_HANDOFFS] = True
    await _agent(ran, "a").ainvoke(
        {"messages": [("user", "go")]}, {"configurable": {"thread_id": "t1"}}
    )

    assert ran == ["a"]


@pytest.mark.asyncio
async def test_turning_the_setting_on_while_a_card_waits_keeps_the_users_no(
    other_preference, ran
):
    agent = _agent(ran, "b")
    config = {"configurable": {"thread_id": "t2"}}
    out = await agent.ainvoke({"messages": [("user", "go")]}, config)
    (pending,) = out["__interrupt__"]

    other_preference[AUTO_APPROVE_HANDOFFS] = True
    out = await agent.ainvoke(
        Command(resume={pending.id: {"decisions": [{"type": "reject"}]}}), config
    )

    assert ran == []
    assert _tool_results(out) == ["declined b"]


@pytest.mark.asyncio
async def test_parallel_cards_are_each_answered_by_the_user(other_preference, ran):
    agent = _agent(ran, "c", "d")
    config = {"configurable": {"thread_id": "t3"}}
    out = await agent.ainvoke({"messages": [("user", "go")]}, config)
    # By question, not position: LangGraph does not promise the cards' order.
    card = {i.value["action_requests"][0]["question"]: i for i in out["__interrupt__"]}

    other_preference[AUTO_APPROVE_HANDOFFS] = True
    out = await agent.ainvoke(
        Command(resume={
            card["c"].id: {"decisions": [{"type": "approve"}]},
            card["d"].id: {"decisions": [{"type": "reject"}]},
        }),
        config,
    )

    assert ran == ["c"]
    assert sorted(_tool_results(out)) == ["declined d", "dispatched c"]


def test_the_keys_read_are_the_keys_settings_save():
    """The web saves these names and the validator accepts them; a key the
    middleware reads under another name leaves every card asking."""
    assert AUTO_APPROVE_KEYS == ("auto_approve_handoffs", "auto_approve_workspace_creation")
    assert set(AUTO_APPROVE_KEYS) <= set(OtherPreference.model_fields)


# --- Which calls the middleware records --------------------------------------


async def _recorded(tool_calls: list[dict], user_id: str | None = USER_ID):
    state = {"messages": [AIMessage(content="", tool_calls=tool_calls)]}
    return await StandingApprovalMiddleware(user_id).aafter_model(state, None)


def _call(tool_name: str, call_id: str, **args) -> dict:
    return {"name": tool_name, "args": args, "id": call_id}


@pytest.mark.asyncio
async def test_each_setting_covers_only_its_own_action(other_preference):
    other_preference[AUTO_APPROVE_WORKSPACE_CREATION] = True
    update = await _recorded([
        _call("manage_workspaces", "create", action="create", name="Research"),
        _call("manage_workspaces", "list", action="list"),
        _call("delegate_to_analyst", "handoff", question="q", workspace_id="ws-1"),
    ])

    assert update == {"preapproved_calls": ["create"]}


@pytest.mark.asyncio
@pytest.mark.parametrize("ids", [{"workspace_id": "ws-1"}, {"thread_id": "t-1"}])
async def test_a_handoff_to_a_named_workspace_or_thread_needs_only_its_own_setting(
    other_preference, ids
):
    other_preference[AUTO_APPROVE_HANDOFFS] = True
    update = await _recorded([_call("ptc_agent", "handoff", question="q", **ids)])

    assert update == {"preapproved_calls": ["handoff"]}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("granted", "recorded"),
    [
        ({AUTO_APPROVE_HANDOFFS}, []),
        ({AUTO_APPROVE_WORKSPACE_CREATION}, []),
        ({AUTO_APPROVE_HANDOFFS, AUTO_APPROVE_WORKSPACE_CREATION}, ["handoff"]),
    ],
)
async def test_a_handoff_that_creates_its_workspace_needs_both_settings(
    other_preference, granted, recorded
):
    """Flash's ptc_agent with no workspace or thread creates one first, so a
    yes to hand-offs alone must not make a workspace without its card."""
    other_preference.update(dict.fromkeys(granted, True))
    update = await _recorded([_call("ptc_agent", "handoff", question="q")])

    assert update == {"preapproved_calls": recorded}


@pytest.mark.asyncio
async def test_only_a_true_setting_approves(other_preference):
    other_preference[AUTO_APPROVE_HANDOFFS] = "yes"
    update = await _recorded(
        [_call("ptc_agent", "handoff", question="q", workspace_id="ws-1")]
    )

    assert update == {"preapproved_calls": []}


@pytest.mark.asyncio
async def test_an_unreadable_setting_asks_instead_of_failing_the_turn(monkeypatch):
    monkeypatch.setattr(
        "src.server.database.user.get_user_preferences",
        AsyncMock(side_effect=RuntimeError("pool closed")),
    )
    update = await _recorded(
        [_call("ptc_agent", "handoff", question="q", workspace_id="ws-1")]
    )

    assert update == {"preapproved_calls": []}


@pytest.mark.asyncio
async def test_a_turn_without_a_user_or_an_approvable_call_records_nothing(
    other_preference,
):
    other_preference[AUTO_APPROVE_HANDOFFS] = True

    assert await _recorded([_call("ptc_agent", "h", question="q")], None) is None
    assert await _recorded([_call("manage_threads", "t", action="list")]) is None


# --- The tools skip the card only on the recorded call ------------------------


def _payload(result: Command) -> dict:
    return json.loads(result.update["messages"][0].content)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("handoff", "ids"),
    [(delegate_to_analyst, {"workspace_id": "ws-1"}), (ptc_agent, {})],
    ids=["delegate_to_analyst", "ptc_agent"],
)
async def test_the_real_handoff_tools_ask_unless_their_call_was_recorded(
    other_preference, monkeypatch, handoff, ids
):
    """The tools never read the setting: on resume they re-run from the top,
    so only the record made when the model proposed this call may skip it."""
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "test-internal-service-token")
    other_preference.update(
        {AUTO_APPROVE_HANDOFFS: True, AUTO_APPROVE_WORKSPACE_CREATION: True}
    )
    confirm = MagicMock(return_value=(False, {}))
    with patch("src.tools.secretary.dispatch.hitl_confirm", confirm), patch(
        "src.server.database.workspace.get_workspace",
        AsyncMock(return_value={"user_id": USER_ID, "name": "Research"}),
    ):
        result = await handoff.ainvoke(
            {
                "name": handoff.name,
                "args": {
                    "question": "q",
                    **ids,
                    "state": {"preapproved_calls": ["an-earlier-call"]},
                },
                "id": "call-1",
                "type": "tool_call",
            },
            config={"configurable": {"user_id": USER_ID, "thread_id": "home-1"}},
        )

    confirm.assert_called_once()
    assert result.update["messages"][0].content == "User declined PTC agent dispatch."


_NEVER_ASK = MagicMock(side_effect=AssertionError("must not ask"))


@pytest.mark.asyncio
async def test_a_workspace_created_without_asking_carries_its_card():
    mgr = workspace_manager({"workspace_id": "ws-1", "name": "Research"})
    with patch("src.tools.secretary.tools.hitl_confirm", _NEVER_ASK), patch(
        "src.server.services.workspace_manager.WorkspaceManager.get_instance",
        return_value=mgr,
    ):
        result = await workspaces_create(
            USER_ID, "Research", "Q3 notes", "call-1", preapproved=True
        )

    assert _payload(result) == {
        "success": True,
        "workspace_id": "ws-1",
        "workspace_name": "Research",
        "preapproved": True,
        "workspace_description": "Q3 notes",
    }


@pytest.mark.asyncio
async def test_a_workspace_the_user_approved_on_its_card_is_not_marked():
    mgr = workspace_manager({"workspace_id": "ws-1", "name": "Research"})
    with patch(
        "src.tools.secretary.tools.hitl_confirm", return_value=(True, {})
    ), patch(
        "src.server.services.workspace_manager.WorkspaceManager.get_instance",
        return_value=mgr,
    ):
        result = await workspaces_create(USER_ID, "Research", None, "call-1")

    assert "preapproved" not in _payload(result)


@pytest.mark.asyncio
async def test_a_handoff_approved_in_advance_names_the_workspace_it_made(monkeypatch):
    monkeypatch.setenv("INTERNAL_SERVICE_TOKEN", "test-internal-service-token")
    cache = FakeCache()
    monkeypatch.setattr("src.utils.cache.redis_cache.get_cache_client", lambda: cache)
    # The row holds no name: the card's is the one dispatch asked for.
    mgr = workspace_manager()
    with patch("src.tools.secretary.dispatch.hitl_confirm", _NEVER_ASK), patch(
        "src.server.services.workspace_manager.WorkspaceManager.get_instance",
        return_value=mgr,
    ), patch("aiohttp.ClientSession", return_value=FakeSession(FakeResp())):
        result = await ptc_agent.ainvoke(
            {
                "name": "ptc_agent",
                "args": {
                    "question": "analyze this",
                    "state": {"preapproved_calls": ["call-1"]},
                },
                "id": "call-1",
                "type": "tool_call",
            },
            config={"configurable": {"user_id": USER_ID, "thread_id": "flash-1"}},
        )

    payload = _payload(result)
    assert payload["status"] == "dispatched"
    assert payload["preapproved"] is True
    assert payload["workspace_name"] == "analyze this"
    assert payload["report_back"] is True
