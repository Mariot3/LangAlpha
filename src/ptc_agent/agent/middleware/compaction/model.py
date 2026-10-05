"""The model that writes a compaction summary, and how much history it can read.

The summary runs on the compaction model, by default the Background model,
whose window can be far smaller than that of the turn's model whose history it
reads, so what one summary call carries is sized to the compaction model.
"""

from __future__ import annotations

import logging
from collections.abc import Iterable, Mapping
from typing import TYPE_CHECKING, Any, cast

from langchain_core.messages import AnyMessage, HumanMessage, get_buffer_string
from langchain_core.messages.utils import trim_messages

from ptc_agent.agent.middleware.compaction.types import TokenCounter
from ptc_agent.agent.middleware.compaction.utils import (
    count_tokens_tiktoken,
    is_summary_message,
)

if TYPE_CHECKING:
    from ptc_agent.config.agent import AgentConfig

logger = logging.getLogger(__name__)

# tiktoken counts low against other vendors' tokenizers, and the summary prompt
# and its answer share the window, so history gets at most this share of it.
_SUMMARY_CONTEXT_SHARE = 0.7


def resolve_compaction_client(config: AgentConfig) -> Any | None:
    """Return the compaction LLM client (role-resolved or main-copy), or None.

    With a dedicated compaction model, use the pre-resolved role client
    (credentialed users) or None (platform users keep the cheap name-based
    model). Without one, fall back to a copy of the main client.
    """
    has_compaction_model = bool(config.llm and config.llm.compaction_name)
    return config.client_for_role("compaction", fallback_to_main=not has_compaction_model)


def max_input_tokens(model: Any) -> int | None:
    """The input window ``model``'s profile declares, or None without one."""
    profile = getattr(model, "profile", None)
    if not isinstance(profile, Mapping):
        return None
    limit = profile.get("max_input_tokens")
    return limit if isinstance(limit, int) else None


def summary_trim_budget(model: Any, token_threshold: int) -> int:
    """How many tokens of history one summary call may carry.

    A budget sized only to the turn's threshold overflows a compaction model
    with a smaller window, and the compaction fails.
    """
    budget = token_threshold + 50_000
    limit = max_input_tokens(model)
    if limit is not None and limit > 0:
        budget = min(budget, int(limit * _SUMMARY_CONTEXT_SHARE))
    return budget


def _as_sent(message: AnyMessage) -> HumanMessage:
    """``message`` as the summary request writes it out, for counting.

    The request flattens history with ``get_buffer_string``, which spells out
    every tool call, so counting content alone sees an ``execute_code`` turn as
    nearly empty and lets a far larger request through than the budget allows.
    """
    return HumanMessage(get_buffer_string([message]))


def trim_for_summary(
    messages: list[AnyMessage],
    budget: int,
    token_counter: TokenCounter = count_tokens_tiktoken,
) -> list[AnyMessage]:
    """The newest of ``messages`` that fit in ``budget`` tokens, behind any earlier summary.

    A list that follows an earlier compaction starts with its summary, the only
    copy of everything before it. Trimming keeps the newest messages, so it
    would drop that summary first; it is kept whole instead, and the rest is
    trimmed to what remains. A summary too large to leave room for anything
    else is trimmed with the rest. Empty when not even the newest message,
    cut to its tail, fits. Each message is measured once, as sent,
    since the trim re-measures spans of the list many times on the event loop.
    """
    if not messages:
        return messages
    sizes = {id(m): token_counter([_as_sent(m)]) for m in messages}

    def count(batch: Iterable[AnyMessage]) -> int:
        # A message trim_messages cut down is a new object, measured afresh.
        return sum(
            sizes[id(m)] if id(m) in sizes else token_counter([_as_sent(m)])
            for m in batch
        )

    total = count(messages)
    if total <= budget:
        return messages

    head: list[AnyMessage] = []
    rest = messages
    if is_summary_message(messages[0]):
        summary_tokens = sizes[id(messages[0])]
        if summary_tokens < budget:
            head, rest = messages[:1], messages[1:]
        else:
            logger.warning(
                "[Compaction] The previous summary (%d tokens) leaves no room in a "
                "%d-token summary budget; trimming it with the rest",
                summary_tokens,
                budget,
            )
    remaining = budget - count(head)

    try:
        kept = cast(
            "list[AnyMessage]",
            trim_messages(
                rest,
                max_tokens=remaining,
                token_counter=count,
                start_on="human",
                strategy="last",
                allow_partial=True,
                include_system=True,
            ),
        )
    except Exception as e:
        logger.warning(f"[Compaction] trim_messages failed: {e}, using fallback")
        kept = []
    if not kept:
        # Nothing starting on a human message fits, as in one long tool loop,
        # so the newest messages that fit wherever they start, the oldest of
        # them cut to its tail when even the newest alone is too long.
        try:
            kept = cast(
                "list[AnyMessage]",
                trim_messages(
                    rest,
                    max_tokens=remaining,
                    token_counter=count,
                    strategy="last",
                    allow_partial=True,
                    include_system=True,
                ),
            )
        except Exception as e:
            logger.warning(f"[Compaction] trim_messages failed: {e}")
            kept = []
        logger.warning(
            "[Compaction] A %d-token summary budget fits no history starting on a "
            "human message; keeping the last %d messages",
            budget,
            len(kept),
        )
    if not kept:
        # A summary of the earlier summary alone would stand in for every turn
        # since it, unread, so the caller treats this as a failed summary.
        logger.warning(
            "[Compaction] Not even the newest message fits a %d-token summary "
            "budget; nothing to summarize",
            budget,
        )
        return []

    trimmed = [*head, *kept]
    logger.info(
        "[Compaction] Summary input trimmed to fit %d tokens: dropped %d of %d "
        "messages, %d of %d tokens%s",
        budget,
        len(messages) - len(trimmed),
        len(messages),
        total - count(trimmed),
        total,
        ", previous summary kept" if head else "",
    )
    return trimmed
