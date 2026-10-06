"""Declarative subagent system.

Public API:
    SubagentDefinition  — dataclass describing a subagent
    SubagentRegistry    — merges built-in + user-defined definitions
    SubagentCompiler    — compiles definitions into SubAgent TypedDicts
    BUILTIN_SUBAGENTS   — shipped defaults
    create_subagents    — main entry point
"""

from __future__ import annotations

from typing import Any

from ptc_agent.agent.roles import AgentRole

from .builtins import BUILTIN_SUBAGENTS
from .compiler import SubagentCompiler
from .definition import SubagentDefinition, SubagentMode
from .registry import SubagentRegistry


def create_subagents(
    registry: SubagentRegistry,
    enabled_names: list[str],
    compiler: SubagentCompiler,
    event_capture_middleware: Any | None = None,
    role: AgentRole | None = None,
) -> list[dict[str, Any]]:
    """Compile enabled subagents into SubAgent TypedDicts.

    Args:
        registry: The subagent registry (built-in + user definitions).
        enabled_names: Which subagents to include.
        compiler: The compiler with runtime context (sandbox, tools, etc.).
        event_capture_middleware: Optional middleware injected into every subagent
            for event capture (SSE streaming) and tool-call metrics.
        role: The role of the agent the subagents serve; leaves out the ones
            that role is not listed for. None keeps every enabled subagent.

    Returns:
        List of SubAgent TypedDicts ready for ``SubAgentMiddleware``.
    """
    definitions = registry.get_enabled(enabled_names, role=role)
    subagents = compiler.compile_many(definitions)

    if event_capture_middleware is not None:
        for spec in subagents:
            existing = spec.get("middleware", [])
            spec["middleware"] = [event_capture_middleware, *list(existing)]

    return subagents


__all__ = [
    "BUILTIN_SUBAGENTS",
    "SubagentCompiler",
    "SubagentDefinition",
    "SubagentMode",
    "SubagentRegistry",
    "create_subagents",
]
