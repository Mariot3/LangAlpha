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
