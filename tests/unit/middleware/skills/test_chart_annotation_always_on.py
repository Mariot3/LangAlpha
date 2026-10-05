"""The chart annotation tools are bound without loading a skill; their skill is guidance only.

Pins the shape that replaced skill gating: no registry skill hides the tools
from a model request, Flash binds them unless the skill is switched off, only
main-agent prompts name them, and loading the now tool-less skill does not
promise tools it never unlocked.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from ptc_agent.agent.middleware.skills.middleware import SkillsMiddleware
from ptc_agent.agent.middleware.skills.registry import (
    SKILL_REGISTRY,
    get_all_skill_tool_names,
    list_skills,
)
from ptc_agent.agent.prompts import get_loader
from tests.unit.ptc_agent.agent.prompts.test_lean_subset_invariant import (
    SUBAGENTS,
    _render_pair,
)

ANNOTATION_TOOLS = {"draw_chart_annotation", "manage_chart_annotations"}


def test_no_skill_gates_the_annotation_tools():
    # _filter_tools hides exactly these names until a skill loads.
    assert not ANNOTATION_TOOLS & get_all_skill_tool_names()


def test_the_skill_lists_the_tools_its_switch_removes():
    from ptc_agent.agent.flash.agent import CHART_ANNOTATION_TOOLS

    skill = SKILL_REGISTRY["chart-annotation"]
    assert set(skill.switched_tools) == {t.name for t in CHART_ANNOTATION_TOOLS}
    (listed,) = [s for s in list_skills() if s["name"] == "chart-annotation"]
    assert set(listed["tools"]) == ANNOTATION_TOOLS


@pytest.mark.parametrize("enabled", [True, False])
def test_flash_binds_the_annotation_tools_unless_switched_off(enabled):
    from ptc_agent.agent.flash.agent import FlashAgent

    agent = FlashAgent.__new__(FlashAgent)
    agent.config = SimpleNamespace(search_api=None, search_depth=None)
    with patch(
        "ptc_agent.agent.flash.agent.get_web_search_tool",
        return_value=MagicMock(name="WebSearch"),
    ):
        tools = agent._build_tools(chart_annotation=enabled)
    names = {getattr(t, "name", None) for t in tools}

    assert ANNOTATION_TOOLS & names == (ANNOTATION_TOOLS if enabled else set())


@pytest.mark.parametrize("enabled", [True, False])
def test_main_prompts_name_the_tool_only_when_bound(enabled):
    loader = get_loader()
    ptc = loader.get_system_prompt(
        subagent_summary="STUB", chart_annotation_enabled=enabled
    )
    flash = loader.render(
        "flash_system.md.j2", tools=[], chart_annotation_enabled=enabled
    )

    assert ("draw_chart_annotation" in ptc) is enabled
    assert ("draw_chart_annotation" in flash) is enabled


@pytest.mark.parametrize("subagent", SUBAGENTS)
def test_subagent_prompts_never_name_the_tool(subagent):
    # Subagents never bind it, though the prompt default is on.
    for prompt in _render_pair(subagent):
        assert "draw_chart_annotation" not in prompt


@pytest.mark.asyncio
async def test_loading_a_guidance_only_skill_lists_no_tools():
    mw = SkillsMiddleware(mode="flash", skill_dirs=[])
    with patch(
        "ptc_agent.agent.middleware.skills.middleware.load_skill_content",
        return_value="GUIDE BODY",
    ):
        result = await mw._build_skill_result(SKILL_REGISTRY["chart-annotation"])

    assert "GUIDE BODY" in result
    assert "Available tools" not in result
    assert "use these tools" not in result
