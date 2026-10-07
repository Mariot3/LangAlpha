"""Pins the markdown subset the report email renders and the recipient gate."""

import pytest

from src.server.services import email_delivery
from src.server.services.email_delivery import markdown_to_html


def test_renders_headings_tables_and_lists():
    html = markdown_to_html("## Title\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n- one\n- two\n")
    assert "<h3>Title</h3>" in html
    assert "<th>A</th>" in html and "<td>2</td>" in html
    assert "<ul><li>one</li><li>two</li></ul>" in html


def test_link_cannot_break_out_of_href():
    html = markdown_to_html('[x](https://a.test/"onmouseover="alert(1))')
    assert 'href="https://a.test/"onmouseover' not in html
    assert "&quot;" in html


def test_model_text_is_escaped():
    assert "<script>" not in markdown_to_html("<script>alert(1)</script>")


@pytest.mark.asyncio
async def test_refused_outside_single_user_mode(monkeypatch):
    from src.config import settings

    monkeypatch.setattr(settings, "HOST_MODE", "platform")
    result = await email_delivery.deliver_automation_email({"name": "x"}, "thread")
    assert result["success"] is False
    assert "single-user" in result["error"]
