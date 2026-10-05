"""The Chief of Staff's tools: how Home's agent runs the user's workspaces.

Each workspace has its own agent, its analyst, and the Chief of Staff in Home
hands work to them rather than doing it in their folders. A hand-off always
names its workspace: a new one is created first, under its own approval, so
the user agrees to the workspace before any work is handed to it. It lists and
creates workspaces but does not delete or stop them: Home runs on the computer
a stop would take down, and deleting is the user's to do from the workspace
itself. ``agent_output`` is how it reads a thread, so its ``manage_threads``
has no second way to.
"""

from typing import Annotated

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.types import Command

from src.tools.secretary._commands import InjectedToolCallId, error_command
from src.tools.secretary.dispatch import dispatch
from src.tools.secretary.tools import (
    agent_output,
    threads_delete,
    threads_list,
    workspaces_create,
    workspaces_list,
)


@tool("manage_workspaces")
async def chief_of_staff_workspaces(
    action: str,
    config: RunnableConfig,
    name: str | None = None,
    description: str | None = None,
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """List the user's workspaces, or create one once the user confirms.

    Args:
        action: "list" or "create".
        name: Name for the new workspace; required for "create".
        description: What the new workspace is for; optional.

    Returns:
        One short row per workspace, with its id and folder (dir_name); for "create", the new id.
    """
    user_id = config.get("configurable", {}).get("user_id")
    if not user_id:
        return error_command("user_id not found in config", tool_call_id)
    if action == "list":
        return await workspaces_list(user_id, tool_call_id)
    if action == "create":
        return await workspaces_create(user_id, name, description, tool_call_id)
    return error_command(
        f"Unknown action: {action}. Use list or create.", tool_call_id
    )


@tool("delegate_to_analyst")
async def delegate_to_analyst(
    question: str,
    config: RunnableConfig,
    workspace_id: str | None = None,
    thread_id: str | None = None,
    report_back: bool = True,
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """Hand work to a workspace's analyst, who does it there in the background once the user approves.

    Needs workspace_id or thread_id: a workspace that does not exist yet is
    created with manage_workspaces first.

    Args:
        question: The task, written for the analyst, who does not see this conversation.
        workspace_id: The workspace whose analyst starts a new thread. Ignored with thread_id.
        thread_id: An analyst's thread to continue.
        report_back: True to be told when the analyst finishes, is stopped or fails, so
            you can relay the outcome; False when the user will read it in the workspace
            themselves.

    Returns:
        The analyst's thread, still running; its report_back field says whether a report-back is coming.
    """
    if not workspace_id and not thread_id:
        return error_command(
            "No workspace named. Pass workspace_id, or thread_id to continue "
            "a thread. For work no workspace covers, create one with "
            'manage_workspaces(action="create") first, then hand off to it.',
            tool_call_id,
        )
    return await dispatch(
        question, config, workspace_id, thread_id, report_back, tool_call_id
    )


@tool("manage_threads")
async def chief_of_staff_threads(
    action: str,
    config: RunnableConfig,
    workspace_id: str | None = None,
    thread_id: str | None = None,
    tool_call_id: Annotated[str, InjectedToolCallId] = "",
) -> Command:
    """List the user's threads, or delete one once the user confirms.

    Args:
        action: "list" or "delete".
        workspace_id: For "list", only this workspace's threads; all of them without it.
        thread_id: The thread to delete; required for "delete".
    """
    user_id = config.get("configurable", {}).get("user_id")
    if not user_id:
        return error_command("user_id not found in config", tool_call_id)
    if action == "list":
        return await threads_list(user_id, workspace_id, tool_call_id)
    if action == "delete":
        return await threads_delete(user_id, thread_id, tool_call_id)
    return error_command(
        f"Unknown action: {action}. Use list or delete.", tool_call_id
    )


CHIEF_OF_STAFF_TOOLS = [
    chief_of_staff_workspaces,
    delegate_to_analyst,
    agent_output,
    chief_of_staff_threads,
]
