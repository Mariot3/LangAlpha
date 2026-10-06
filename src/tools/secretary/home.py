"""The workspace tool the full agent carries in Home.

Home answers the chats that belong to no workspace, so a user who asks it for
a new workspace has to get one there, as Flash could. It lists and creates
only: Home runs on the computer a stop would take down, and deleting is the
user's to do from the workspace itself.
"""

from typing import Annotated

from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.types import Command

from src.tools.secretary.tools import (
    InjectedToolCallId,
    _error_command,
    _workspaces_create,
    _workspaces_list,
)


@tool("manage_workspaces")
async def home_workspaces(
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
        JSON: each workspace's id, name and folder (``dir_name``), or the new workspace's id and name.
    """
    user_id = config.get("configurable", {}).get("user_id")
    if not user_id:
        return _error_command("user_id not found in config", tool_call_id)
    if action == "list":
        return await _workspaces_list(user_id, tool_call_id)
    if action == "create":
        return await _workspaces_create(user_id, name, description, tool_call_id)
    return _error_command(
        f"Unknown action: {action}. Use list or create.", tool_call_id
    )


HOME_TOOLS = [home_workspaces]
