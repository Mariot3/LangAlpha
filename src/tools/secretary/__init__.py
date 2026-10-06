"""Flash's secretary tools: workspace management, PTC dispatch, agent monitoring, thread management.

The Chief of Staff's versions are in ``chief_of_staff``.
"""

from src.tools.secretary.tools import (
    agent_output,
    manage_threads,
    manage_workspaces,
    ptc_agent,
)

SECRETARY_TOOLS = [manage_workspaces, ptc_agent, agent_output, manage_threads]

__all__ = [
    "manage_workspaces",
    "ptc_agent",
    "agent_output",
    "manage_threads",
    "SECRETARY_TOOLS",
]
