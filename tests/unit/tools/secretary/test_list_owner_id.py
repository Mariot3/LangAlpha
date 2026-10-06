"""The workspace listing answers with a short row per workspace.

The tool reads the user from the run config, so the owner's user_id is never
something the model passes back, and a listing comes before every hand-off,
so the row's settings, artifacts and machine bindings stay out of it. The
workspace id the model does pass back stays.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest

from src.tools.secretary import tools

pytestmark = pytest.mark.asyncio

OWNER = "owner-5c81e2"


async def test_workspace_list_rows_carry_only_what_a_hand_off_reads():
    row = {
        "workspace_id": "ws-1",
        "user_id": OWNER,
        "name": "Semis",
        "description": "Chip makers",
        "sandbox_id": "sbx-1",
        "computer_id": "cmp-1",
        "dir_name": "semis",
        "previous_dir_names": ["chips"],
        "status": "running",
        "created_at": datetime(2026, 9, 30, 12, 0, tzinfo=timezone.utc),
        "last_activity_at": None,
        "config": {"mcp": {"servers": ["x"]}},
        "artifacts": [{"path": "report.md"}],
        "mcp_config_version": 4,
    }
    with patch(
        "src.server.database.workspace.get_workspaces_for_user",
        AsyncMock(return_value=([row], 1)),
    ):
        command = await tools.workspaces_list(OWNER, "call-1")
    content = command.update["messages"][0].content
    assert OWNER not in content
    listed = json.loads(content)["workspaces"]
    assert listed == [
        {
            "workspace_id": "ws-1",
            "name": "Semis",
            "description": "Chip makers",
            "dir_name": "semis",
            "status": "running",
            "created_at": "2026-09-30 12:00:00+00:00",
            "last_activity_at": None,
        }
    ]


async def test_the_chief_of_staff_sees_a_folder_only_on_homes_computer():
    """Home reads its siblings' folders on its own computer. A workspace on
    another computer has no folder there, so its row names none."""
    from src.server.database.home_workspace import get_flash_workspace_id
    from src.tools.secretary.chief_of_staff import chief_of_staff_workspaces

    rows = [
        {"workspace_id": "ws-here", "computer_id": "cmp-home", "dir_name": "semis"},
        {"workspace_id": "ws-there", "computer_id": "cmp-other", "dir_name": "macro"},
    ]
    read_home = AsyncMock(return_value={"computer_id": "cmp-home"})
    with patch(
        "src.server.database.workspace.get_workspaces_for_user",
        AsyncMock(return_value=(rows, 2)),
    ), patch("src.server.database.workspace.get_workspace", read_home):
        command = await chief_of_staff_workspaces.ainvoke(
            {
                "name": "manage_workspaces",
                "args": {"action": "list", "state": {}},
                "id": "call-1",
                "type": "tool_call",
            },
            config={"configurable": {"user_id": OWNER}},
        )
    listed = json.loads(command.update["messages"][0].content)["workspaces"]
    assert {ws["workspace_id"]: ws["dir_name"] for ws in listed} == {
        "ws-here": "semis",
        "ws-there": None,
    }
    read_home.assert_awaited_once_with(get_flash_workspace_id(OWNER))
