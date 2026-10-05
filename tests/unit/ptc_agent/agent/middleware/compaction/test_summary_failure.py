"""A failed summary keeps the history it was to replace.

The failure text used to be saved as the summary, so the history was cut and
replaced by an error message. Manual ``/compact`` already raised; automatic
compaction now drops the attempt, and the next turn retries it. Not the next
call: a hung summary model would hold every later call for the whole timeout.
"""

from __future__ import annotations

import asyncio

import pytest
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, HumanMessage

from ptc_agent.agent.middleware.compaction import middleware as middleware_module
from ptc_agent.agent.middleware.compaction.middleware import CompactionMiddleware

HISTORY = [
    m
    for i in range(6)
    for m in (HumanMessage(f"q{i}", id=f"h{i}"), AIMessage(f"a{i}", id=f"a{i}"))
]
# A call that fails, and one that comes back empty, as /compact refuses too.
FAILURES = [RuntimeError("upstream down"), ""]
HANG = object()


class _SummaryModel:
    profile = None

    def __init__(self, answer):
        self.answer = answer
        self.calls = 0

    def invoke(self, messages):
        self.calls += 1
        return self._answer()

    async def ainvoke(self, messages):
        self.calls += 1
        if self.answer is HANG:
            await asyncio.sleep(3600)
        return self._answer()

    def _answer(self):
        if isinstance(self.answer, Exception):
            raise self.answer
        return AIMessage(self.answer)


def _middleware(answer) -> CompactionMiddleware:
    return CompactionMiddleware(
        model=_SummaryModel(answer),
        trigger=("messages", 6),
        keep=("messages", 2),
        summary_prompt="x",
        token_counter=len,
    )


def _request(mw: CompactionMiddleware) -> ModelRequest:
    return ModelRequest(
        model=mw.model,
        messages=HISTORY,
        system_message=None,
        tool_choice=None,
        tools=[],
        response_format=None,
        state={},
        runtime=None,
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("answer", FAILURES)
async def test_a_failed_summary_leaves_the_history_in_place(answer):
    mw = _middleware(answer)
    sent: list = []

    async def handler(req):
        sent.append(req.messages)
        return ModelResponse(result=[AIMessage("done")])

    update = (await mw.awrap_model_call(_request(mw), handler)).command.update

    assert [m.id for m in sent[0]] == [m.id for m in HISTORY]
    assert "_summarization_event" not in update


@pytest.mark.parametrize("answer", FAILURES)
def test_the_sync_path_keeps_the_history_too(answer):
    mw = _middleware(answer)
    sent: list = []

    def handler(req):
        sent.append(req.messages)
        return ModelResponse(result=[AIMessage("done")])

    update = mw.wrap_model_call(_request(mw), handler).command.update

    assert [m.id for m in sent[0]] == [m.id for m in HISTORY]
    assert "_summarization_event" not in update


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "answer", [RuntimeError("upstream down"), HANG], ids=["error", "hang"]
)
async def test_a_failed_summary_is_not_tried_again_this_turn(answer, monkeypatch):
    monkeypatch.setattr(middleware_module, "get_compaction_timeout", lambda: 0.01)
    mw = _middleware(answer)
    sent: list = []

    async def handler(req):
        sent.append(req.messages)
        return ModelResponse(result=[AIMessage("done")])

    for _ in range(2):
        await mw.awrap_model_call(_request(mw), handler)

    assert mw.model.calls == 1
    assert [m.id for m in sent[1]] == [m.id for m in HISTORY]
