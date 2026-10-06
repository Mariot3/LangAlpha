"""Which agent runs a turn, in which role, and in which workspace.

Behind the ``all_workspaces_agent`` flag a turn that would have run on Flash
runs the full agent in the user's Home instead. Every entry that starts a turn
asks here, so turning the flag off is the whole rollback.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, Literal, Optional

from fastapi import HTTPException

from src.config.features import is_feature_enabled_system
from src.server.database.home_workspace import get_flash_workspace_id, is_flash_row

if TYPE_CHECKING:
    from ptc_agent.agent.agent import AgentRole

ALL_WORKSPACES_AGENT = "all_workspaces_agent"


@dataclass(frozen=True, slots=True)
class TurnRoute:
    """The agent a turn runs on, the role it plays there, and the workspace."""

    agent: Literal["flash", "ptc"]
    workspace_id: str
    # The full agent's role; None on Flash, which has none.
    role: Optional[AgentRole] = None
    # The flash row this resolve upserted, which the Flash workflow reuses
    # rather than upserting it again.
    flash_workspace: Optional[Dict[str, Any]] = None


async def resolve_turn_route(
    user_id: str,
    agent_mode: Optional[str],
    workspace_id: Optional[str],
    workspace: Optional[Dict[str, Any]] = None,
    *,
    bind_home: bool = True,
) -> TurnRoute:
    """Where a turn runs, decided by the flag and the row alone.

    The wire keeps its names, so a channel, the CLI and an automation still
    send ``agent_mode='flash'`` and reach Home. Never decided by a cached
    session: Home has one once it ran, and that must not keep Flash from
    coming back when the flag goes off. ``workspace`` is the caller's read of
    ``workspace_id``, when it has one. A caller that routes before its
    admission gates passes ``bind_home=False`` and calls :func:`ensure_home`
    once they pass, so a refused turn leaves the user's computer as it was.
    """
    from src.server.database.workspace import get_workspace

    if workspace_id and workspace is None:
        workspace = await get_workspace(workspace_id)
    if agent_mode != "flash" and not is_flash_row(workspace):
        return TurnRoute("ptc", workspace_id, role="analyst")
    if not await home_enabled(user_id):
        # A flash row at any id but the user's own is a former one, which any
        # upsert may fold into theirs and retire before this turn writes to it.
        # The upsert below folds it first, and the turn runs where its threads
        # went.
        if workspace_id and not (
            is_flash_row(workspace)
            and str(workspace.get("workspace_id")) != get_flash_workspace_id(user_id)
        ):
            return TurnRoute("flash", workspace_id)
        flash_workspace = await _flash_row(user_id)
        return TurnRoute(
            "flash", str(flash_workspace["workspace_id"]), flash_workspace=flash_workspace
        )
    if workspace is not None and not is_flash_row(workspace):
        # A thread lives in one workspace, so a flash request continuing one
        # that belongs to a workspace runs there; only the rest go Home.
        return TurnRoute("ptc", workspace_id, role="analyst")
    home_id = (
        await ensure_home(user_id, workspace)
        if bind_home
        else get_flash_workspace_id(user_id)
    )
    return TurnRoute("ptc", home_id, role="chief_of_staff")


async def requested_workspace(
    user_id: str, agent_mode: Optional[str], workspace_id: Optional[str]
) -> Optional[Dict[str, Any]]:
    """The workspace a client's turn names, once it is the caller's.

    Checked before the credit gate, as a malformed or foreign request is the
    client's error whatever its balance, and before any route is taken, so a
    turn that is refused never binds Home.
    """
    from src.server.database.workspace import get_workspace
    from src.server.utils.api import require_workspace_owner

    if agent_mode == "ptc" and not workspace_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "workspace_id is required for 'ptc' agent mode. Create workspace "
                "first via POST /workspaces, or use agent_mode='flash' for "
                "lightweight queries."
            ),
        )
    if not workspace_id:
        return None
    workspace = await get_workspace(workspace_id)
    # A fresh thread id must not run inside another user's workspace. The
    # report-back dispatch sets X-User-Id to the owner, so it passes.
    require_workspace_owner(workspace, user_id=user_id)
    return workspace


async def ensure_home(
    user_id: str, flash_workspace: Optional[Dict[str, Any]] = None
) -> str:
    """The id of the user's Home, its row created and put on their computer if need be.

    ``flash_workspace`` is a read of the user's flash row the caller already
    holds, which spares the upsert.
    """
    from src.server.services.workspace_manager import WorkspaceManager

    home_id = get_flash_workspace_id(user_id)
    if flash_workspace is None or str(flash_workspace.get("workspace_id")) != home_id:
        await _flash_row(user_id)
    await WorkspaceManager.get_instance().ensure_home_bound(user_id)
    return home_id


async def _flash_row(user_id: str) -> Dict[str, Any]:
    """The user's flash row, created if need be; a 403 when its id is another account's.

    That is the owner check's answer for any row another account holds, and no
    retry can make this one the caller's.
    """
    from src.server.database.workspace import (
        FlashWorkspaceTaken,
        get_or_create_flash_workspace,
    )

    try:
        return await get_or_create_flash_workspace(user_id)
    except FlashWorkspaceTaken:
        raise HTTPException(status_code=403, detail="Forbidden") from None


async def home_enabled(user_id: str) -> bool:
    """Whether work outside a workspace runs in the user's Home rather than on Flash."""
    # A deployment that never turned the flag on pays no preferences read.
    if not is_feature_enabled_system(ALL_WORKSPACES_AGENT):
        return False
    from src.server.services.features import user_feature_enabled

    return await user_feature_enabled(user_id, ALL_WORKSPACES_AGENT)
