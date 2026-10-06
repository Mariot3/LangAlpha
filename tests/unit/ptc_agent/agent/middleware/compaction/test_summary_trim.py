"""A compaction that has to trim its input keeps the previous summary.

The summary call's input is capped to the compaction model's window, and
trimming keeps the newest messages. After an earlier compaction the list
starts with that compaction's summary, the only copy of everything before it,
so a plain trim dropped it first and the new summary silently forgot the start
of the thread. Both the automatic and the manual compaction trim this way.

The budget is measured on the history as the request renders it, tool calls
included, and holds with the previous summary kept.
"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from langchain.agents.middleware.types import ModelRequest, ModelResponse
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    ToolMessage,
    get_buffer_string,
)

from ptc_agent.agent.middleware.compaction import compact as compact_module
from ptc_agent.agent.middleware.compaction import utils as compaction_utils
from ptc_agent.agent.middleware.compaction.middleware import CompactionMiddleware
from ptc_agent.agent.middleware.compaction.model import trim_for_summary
from ptc_agent.agent.middleware.compaction.utils import (
    build_compaction_event,
    build_summary_message,
)
from ptc_agent.agent.transcript import TranscriptTarget

PRIOR = "Earlier: NVDA gross margin held at 75 percent; the AMD model is pending."
TRANSCRIPT = TranscriptTarget("abcd1234-0000-0000-0000-000000000000")


def _chars(messages) -> int:
    return sum(len(str(m.content)) for m in messages)


def _turns(n: int) -> list:
    return [
        m
        for i in range(1, n + 1)
        for m in (
            HumanMessage(f"q{i} " + "x" * 400, id=f"h{i}"),
            AIMessage(f"a{i} " + "y" * 400, id=f"a{i}"),
        )
    ]


def _tool_loop(n: int, code: str, result: str) -> list:
    """An OpenAI-shaped tool loop: empty content, the work in the tool call."""
    return [
        m
        for i in range(n)
        for m in (
            AIMessage(
                "",
                id=f"c{i}",
                tool_calls=[
                    {"name": "execute_code", "args": {"code": code}, "id": f"call{i}"}
                ],
            ),
            ToolMessage(result, tool_call_id=f"call{i}", id=f"r{i}"),
        )
    ]


class _SummaryModel:
    def __init__(self, window: int | None = None):
        self.profile = {"max_input_tokens": window} if window else None
        self.sent: list = []

    async def ainvoke(self, messages):
        self.sent.append(messages)
        return AIMessage("the new summary")


class _Mount:
    async def save_transcript(self, target, messages):
        return True


@pytest.mark.asyncio
async def test_the_middleware_keeps_the_previous_summary_and_names_the_gap(monkeypatch):
    raw = _turns(8)
    prior_event = build_compaction_event(
        raw_messages=raw,
        preserved_messages=raw[2:],
        summary_message=build_summary_message(PRIOR, None),
        file_path=None,
    )
    model = _SummaryModel()
    mw = CompactionMiddleware(
        model=model,
        trigger=("messages", 6),
        keep=("messages", 2),
        summary_prompt="x",
        token_counter=_chars,
        trim_tokens_to_summarize=2000,
        backend=SimpleNamespace(livefs=_Mount()),
    )
    monkeypatch.setattr(mw, "_transcript_target", lambda: TRANSCRIPT)
    sent: list = []

    async def handler(req):
        sent.append(req.messages)
        return ModelResponse(result=[AIMessage("done")])

    req = ModelRequest(
        model=mw.model,
        messages=raw,
        system_message=None,
        tool_choice=None,
        tools=[],
        response_format=None,
        state={"_summarization_event": prior_event},
        runtime=None,
    )
    await mw.awrap_model_call(req, handler)

    history = model.sent[0][-1].content
    assert PRIOR in history
    assert "q7" in history  # the newest summarized turn
    assert "q2" not in history  # the oldest one after the summary did not fit
    # The new summary says which turns it skipped after the kept one.
    new_summary = sent[0][0].content
    assert "Turns before 6 did not fit in this summary" in new_summary


@pytest.mark.asyncio
async def test_manual_compaction_keeps_the_previous_summary(monkeypatch):
    # Offline stand-in for cl100k_base: about four characters to a token.
    fake = SimpleNamespace(encode=lambda text: [0] * (len(text) // 4 + 1))
    monkeypatch.setattr(compaction_utils, "_get_tiktoken_encoder", lambda: fake)

    async def _passthrough(backend, messages, **kwargs):
        return messages

    monkeypatch.setattr(compact_module, "aoffload_base64_content", _passthrough)
    raw = _turns(8)
    prior_event = build_compaction_event(
        raw_messages=raw,
        preserved_messages=raw[2:],
        summary_message=build_summary_message(PRIOR, None),
        file_path=None,
    )
    # A 0.7 share of this window is about five turns of history.
    model = _SummaryModel(window=800)

    await compact_module.compact_messages(
        messages=raw,
        keep_messages=2,
        previous_event=prior_event,
        llm_client=model,
    )

    history = model.sent[0][-1].content
    assert PRIOR in history
    assert "q7" in history
    assert "q2" not in history


def test_the_trim_counts_the_tool_calls_the_request_spells_out(monkeypatch):
    # A content-only count read each call as nearly empty and kept them all.
    fake = SimpleNamespace(encode=lambda text: [0] * (len(text) // 4 + 1))
    monkeypatch.setattr(compaction_utils, "_get_tiktoken_encoder", lambda: fake)
    code = "print(get_prices('NVDA'))\n" * 40
    history = [HumanMessage("Chart NVDA", id="h0"), *_tool_loop(40, code, "ok")]

    kept = trim_for_summary(history, 5_000)

    assert len(fake.encode(get_buffer_string(kept))) <= 5_000
    assert kept[-1] is history[-1]


def test_a_kept_summary_and_a_tool_loop_fit_the_budget_together():
    # No human message follows the summary, so the human-first trim keeps
    # nothing and the fallback has to budget what remains on its own.
    summary = build_summary_message(PRIOR, None)
    history = [summary, *_tool_loop(20, "x" * 200, "y" * 200)]
    budget = len(get_buffer_string([summary])) + 1_000

    kept = trim_for_summary(history, budget, _chars)

    assert kept[0] is summary
    assert kept[-1] is history[-1]
    assert sum(len(get_buffer_string([m])) for m in kept) <= budget


def _over_budget_result(result: str) -> tuple[list, int]:
    """A kept summary and a turn whose newest message alone is over budget."""
    summary = build_summary_message(PRIOR, None)
    history = [summary, *_tool_loop(1, "print(read())", result)]
    return history, len(get_buffer_string([summary])) + 1_000


def test_a_newest_message_over_the_budget_is_cut_to_its_tail():
    # Keeping the summary alone would summarize none of the turns since it.
    history, budget = _over_budget_result("\n".join(f"row {i}: " + "z" * 40 for i in range(200)))

    kept = trim_for_summary(history, budget, _chars)

    assert kept[0] is history[0]
    assert [m.id for m in kept[1:]] == ["r0"]
    assert "row 199" in kept[-1].content
    assert "row 0:" not in kept[-1].content


def test_nothing_to_summarize_when_the_newest_message_cannot_be_cut():
    history, budget = _over_budget_result("z" * 5_000)

    assert trim_for_summary(history, budget, _chars) == []


@pytest.mark.asyncio
async def test_the_middleware_keeps_the_history_when_nothing_new_fits(monkeypatch):
    # The tool loop is the newest of what this compaction would summarize.
    raw = [*_turns(3), *_tool_loop(1, "print(read())", "z" * 5_000), *_turns(4)[-2:]]
    prior_event = build_compaction_event(
        raw_messages=raw,
        preserved_messages=raw[2:],
        summary_message=build_summary_message(PRIOR, None),
        file_path=None,
    )
    model = _SummaryModel()
    mw = CompactionMiddleware(
        model=model,
        trigger=("messages", 4),
        keep=("messages", 2),
        summary_prompt="x",
        token_counter=_chars,
        trim_tokens_to_summarize=1_000,
        backend=SimpleNamespace(livefs=_Mount()),
    )
    monkeypatch.setattr(mw, "_transcript_target", lambda: TRANSCRIPT)
    sent: list = []

    async def handler(req):
        sent.append(req.messages)
        return ModelResponse(result=[AIMessage("done")])

    req = ModelRequest(
        model=mw.model,
        messages=raw,
        system_message=None,
        tool_choice=None,
        tools=[],
        response_format=None,
        state={"_summarization_event": prior_event},
        runtime=None,
    )
    await mw.awrap_model_call(req, handler)

    assert model.sent == []
    seen = " ".join(str(m.content) for m in sent[0])
    assert PRIOR in seen
    assert "q3" in seen and "q4" in seen


@pytest.mark.asyncio
async def test_manual_compaction_refuses_when_nothing_new_fits(monkeypatch):
    fake = SimpleNamespace(encode=lambda text: [0] * (len(text) // 4 + 1))
    monkeypatch.setattr(compaction_utils, "_get_tiktoken_encoder", lambda: fake)
    raw = [*_turns(2), *_tool_loop(1, "print(read())", "z" * 5_000), *_turns(2)]
    prior_event = build_compaction_event(
        raw_messages=raw,
        preserved_messages=raw[2:],
        summary_message=build_summary_message(PRIOR, None),
        file_path=None,
    )
    model = _SummaryModel(window=800)

    with pytest.raises(RuntimeError, match="fits the compaction model's budget"):
        await compact_module.compact_messages(
            messages=raw,
            keep_messages=4,
            previous_event=prior_event,
            llm_client=model,
        )
    assert model.sent == []
