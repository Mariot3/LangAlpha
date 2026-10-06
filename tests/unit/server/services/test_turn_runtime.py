"""Which agent runs a turn: the one seam the all-workspaces flag turns on and off.

Every entry that starts a turn (a message, a thread create, an automation, a
warm) asks ``resolve_turn_route``, so these cases are the whole rollback
contract: flag off is Flash exactly as before, flag on sends every turn that
has no workspace of its own to Home.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.server.database.home_workspace import get_flash_workspace_id
from src.server.services.turn_runtime import TurnRoute, resolve_turn_route

USER = "user-1"
HOME = get_flash_workspace_id(USER)
PROJECT = {"workspace_id": "proj-ws", "user_id": USER, "status": "running"}
FLASH_ROW = {"workspace_id": HOME, "user_id": USER, "status": "flash"}
# Bound, Home carries its computer's status; its id still says what it is.
BOUND_HOME = {**FLASH_ROW, "status": "running", "computer_id": "c-1"}
# A flash row at another id, which an account merge carries onto the account.
FORMER_ROW = {"workspace_id": "former-ws", "user_id": USER, "status": "flash"}


@pytest.fixture
def seam():
    """The flag, the flash upsert and the Home bind, as the seam reaches them."""
    manager = MagicMock()
    manager.ensure_home_bound = AsyncMock(return_value={"computer_id": "c-1"})
    with (
        patch("src.server.services.turn_runtime.home_enabled", new=AsyncMock()) as enabled,
        patch(
            "src.server.database.workspace.get_or_create_flash_workspace",
            new=AsyncMock(return_value=FLASH_ROW),
        ) as upsert,
        patch(
            "src.server.database.workspace.get_workspace",
            new=AsyncMock(return_value=None),
        ) as get_workspace,
        patch(
            "src.server.services.workspace_manager.WorkspaceManager.get_instance",
            return_value=manager,
        ),
    ):
        yield enabled, get_workspace, manager.ensure_home_bound, upsert


@pytest.mark.asyncio
async def test_a_workspace_turn_never_reads_the_flag(seam):
    enabled, _, bind, _ = seam
    assert await resolve_turn_route(USER, "ptc", "proj-ws", PROJECT) == TurnRoute(
        "ptc", "proj-ws", role="analyst"
    )
    enabled.assert_not_awaited()
    bind.assert_not_awaited()


@pytest.mark.asyncio
async def test_flag_off_upserts_the_flash_row_for_a_turn_that_names_none(seam):
    enabled, _, bind, upsert = seam
    enabled.return_value = False
    assert await resolve_turn_route(USER, "flash", None) == TurnRoute(
        "flash", HOME, flash_workspace=FLASH_ROW
    )
    upsert.assert_awaited_once_with(USER)
    bind.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("workspace", [FLASH_ROW, BOUND_HOME], ids=["unbound", "bound"])
async def test_flag_off_keeps_flash_and_binds_nothing(seam, workspace):
    """A HITL resume in the flash workspace that didn't resend agent_mode still lands on Flash."""
    enabled, _, bind, _ = seam
    enabled.return_value = False
    assert await resolve_turn_route(USER, "ptc", HOME, workspace) == TurnRoute(
        "flash", HOME
    )
    bind.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("agent_mode", ["flash", "ptc"])
async def test_flag_off_runs_a_turn_naming_a_former_flash_row_in_the_users_own(
    seam, agent_mode
):
    """Any upsert folds a former row into the user's own and retires it, so a
    thread created in it could land in a row that never lists again."""
    enabled, _, bind, upsert = seam
    enabled.return_value = False
    assert await resolve_turn_route(
        USER, agent_mode, "former-ws", FORMER_ROW
    ) == TurnRoute("flash", HOME, flash_workspace=FLASH_ROW)
    upsert.assert_awaited_once_with(USER)
    bind.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("agent_mode", "workspace_id", "workspace"),
    [
        ("flash", None, None),
        ("flash", HOME, FLASH_ROW),
        ("ptc", HOME, FLASH_ROW),
        ("ptc", HOME, BOUND_HOME),
    ],
)
async def test_flag_on_runs_the_chief_of_staff_in_home(
    seam, agent_mode, workspace_id, workspace
):
    enabled, _, bind, upsert = seam
    enabled.return_value = True
    assert await resolve_turn_route(
        USER, agent_mode, workspace_id, workspace
    ) == TurnRoute("ptc", HOME, role="chief_of_staff")
    bind.assert_awaited_once_with(USER)
    # The row the caller read is not upserted again.
    assert upsert.await_count == (0 if workspace else 1)


@pytest.mark.asyncio
async def test_a_caller_routing_before_its_gates_binds_home_itself(seam):
    """The message route asks before its credit gate, and binds once that passes."""
    enabled, _, bind, upsert = seam
    enabled.return_value = True
    assert await resolve_turn_route(
        USER, "flash", None, bind_home=False
    ) == TurnRoute("ptc", HOME, role="chief_of_staff")
    bind.assert_not_awaited()
    upsert.assert_not_awaited()


@pytest.mark.asyncio
async def test_flag_on_keeps_a_workspace_thread_in_its_workspace(seam):
    """A flash request continuing a thread that lives in a workspace runs there, not in Home."""
    enabled, get_workspace, bind, _ = seam
    enabled.return_value = True
    get_workspace.return_value = PROJECT
    assert await resolve_turn_route(USER, "flash", "proj-ws") == TurnRoute(
        "ptc", "proj-ws", role="analyst"
    )
    bind.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("flag", [False, True], ids=["Flash", "Home"])
async def test_a_flash_id_another_account_holds_is_forbidden(seam, flag):
    """An account merge carries the merged account's flash row onto the account
    it joins; a turn from the merged id is refused as the owner check refused it."""
    from fastapi import HTTPException

    from src.server.database.workspace import FlashWorkspaceTaken

    enabled, _, bind, upsert = seam
    enabled.return_value = flag
    upsert.side_effect = FlashWorkspaceTaken(HOME, USER)
    with pytest.raises(HTTPException) as refused:
        await resolve_turn_route(USER, "flash", None)
    assert refused.value.status_code == 403
    bind.assert_not_awaited()
