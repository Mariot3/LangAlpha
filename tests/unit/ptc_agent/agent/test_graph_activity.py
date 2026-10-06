"""The role's harness blocks are read before the build, and only for that role.

An empty mapping is a build without the block, so the analyst does no
database round trip on a workspace turn. A None value is a read that did not
answer, which the baseline retries next turn; the two must not collapse.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from ptc_agent.agent.graph import _read_harness_blocks

HOME = "a0000001-0000-4000-8000-000000000001"


@pytest.mark.asyncio
async def test_the_analyst_reads_no_block():
    reader = AsyncMock(return_value="unused")
    with patch("src.tools.secretary.activity.read_activity", reader):
        assert await _read_harness_blocks("u", HOME, "t", None, "analyst") == {}
    reader.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_chief_of_staff_reads_activity_in_the_users_timezone():
    reader = AsyncMock(return_value="Recent threads, this one aside:")
    turn = SimpleNamespace(tool_timezone="Asia/Shanghai")
    with patch("src.tools.secretary.activity.read_activity", reader):
        blocks = await _read_harness_blocks("u", HOME, "t", turn, "chief_of_staff")
    assert blocks == {"activity": "Recent threads, this one aside:"}
    reader.assert_awaited_once_with(
        "u", home_id=HOME, thread_id="t", timezone="Asia/Shanghai"
    )


@pytest.mark.asyncio
async def test_a_read_that_did_not_answer_stays_a_hole():
    """The block is kept with no text, so the baseline marks the epoch
    incomplete and the next turn reads again, instead of losing the block."""
    with patch(
        "src.tools.secretary.activity.read_activity", AsyncMock(return_value=None)
    ):
        blocks = await _read_harness_blocks("u", HOME, "t", None, "chief_of_staff")
    assert blocks == {"activity": None}
