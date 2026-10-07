"""Email delivery for automation results.

Sends the run's final assistant message over SMTP. The subject is the report's
own first heading (e.g. "MSFT Trading Day Update — Tuesday, October 6") because
the model dates it correctly, falling back to the automation name, behind a
fixed source prefix.
"""

import asyncio
import html
import logging
import re
import smtplib
from email.message import EmailMessage
from typing import Any, Dict

from psycopg.rows import dict_row

from src.server.database import pool

logger = logging.getLogger(__name__)

# Marks mail as automation output so it's recognisable (and filterable) in an inbox.
SUBJECT_PREFIX = "[LangAlpha]"

_HEADING_RE = re.compile(r"^\s{0,3}#{1,3}\s+(.+?)\s*#*\s*$", re.M)


async def _final_report_text(thread_id: str, run_id: str | None = None) -> str:
    """Last non-empty main-agent text message of the run (default: the thread's latest).

    Earlier text chunks in a run are progress narration before tool calls;
    only the last one is the report.
    """
    async with pool.get_db_connection() as conn:
        async with conn.cursor(row_factory=dict_row) as cur:
            await cur.execute(
                """
                SELECT ev->'data'->>'content' AS content
                FROM (
                    SELECT sse_events FROM conversation_responses
                    WHERE conversation_thread_id = %s AND sse_events IS NOT NULL
                      AND (%s::uuid IS NULL OR conversation_response_id = %s::uuid)
                    ORDER BY run_seq DESC LIMIT 1
                ) r, jsonb_array_elements(r.sse_events) WITH ORDINALITY AS t(ev, n)
                WHERE ev->>'event' = 'message_chunk'
                  AND ev->'data'->>'content_type' = 'text'
                  AND ev->'data'->>'role' = 'assistant'
                  AND COALESCE(ev->'data'->>'content', '') <> ''
                  AND ev->'data'->>'agent' LIKE 'model:%%'
                ORDER BY n DESC LIMIT 1
                """,
                (thread_id, run_id, run_id),
            )
            row = await cur.fetchone()
    return (row or {}).get("content") or ""


def _inline(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\w)", r"<em>\1</em>", text)
    return re.sub(r"\[([^\]]+)\]\((https?://[^)\s]+)\)", r'<a href="\2">\1</a>', text)


def _table(lines: list[str]) -> str:
    def cells(line: str) -> list[str]:
        return [c.strip() for c in line.strip().strip("|").split("|")]

    head, *body = [cells(ln) for ln in lines if not re.fullmatch(r"[\s|:-]+", ln)]
    th = "".join(f"<th>{_inline(c)}</th>" for c in head)
    rows = "".join(
        "<tr>" + "".join(f"<td>{_inline(c)}</td>" for c in r) + "</tr>" for r in body
    )
    return f"<table><thead><tr>{th}</tr></thead><tbody>{rows}</tbody></table>"


def markdown_to_html(md: str) -> str:
    """Small markdown subset (headings, lists, tables, emphasis, links, rules).

    Hand-rolled rather than adding a dependency: a new package would bust the
    backend image's dependency layer, and reports only use this subset.
    """
    out: list[str] = []
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
        elif m := re.match(r"^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$", line):
            level = min(len(m.group(1)) + 1, 4)
            out.append(f"<h{level}>{_inline(m.group(2))}</h{level}>")
            i += 1
        elif re.fullmatch(r"\s*([-*_])(\s*\1){2,}\s*", line):
            out.append("<hr>")
            i += 1
        elif "|" in line and i + 1 < len(lines) and re.fullmatch(r"[\s|:-]+", lines[i + 1]) and "-" in lines[i + 1]:
            j = i
            while j < len(lines) and "|" in lines[j]:
                j += 1
            out.append(_table(lines[i:j]))
            i = j
        elif re.match(r"^\s*([-*•]|\d+[.)])\s+", line):
            ordered = bool(re.match(r"^\s*\d", line))
            items = []
            while i < len(lines) and (m := re.match(r"^\s*(?:[-*•]|\d+[.)])\s+(.*)", lines[i])):
                items.append(f"<li>{_inline(m.group(1))}</li>")
                i += 1
            tag = "ol" if ordered else "ul"
            out.append(f"<{tag}>{''.join(items)}</{tag}>")
        else:
            para = []
            while i < len(lines) and lines[i].strip() and not re.match(r"^\s{0,3}#{1,6}\s|^\s*([-*•]|\d+[.)])\s+", lines[i]):
                para.append(_inline(lines[i]))
                i += 1
            out.append(f"<p>{'<br>'.join(para)}</p>")
    style = (
        "font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;"
        "line-height:1.5;color:#1a1a1a;max-width:720px"
    )
    css = (
        "<style>table{border-collapse:collapse}th,td{border:1px solid #ddd;padding:4px 8px;"
        "text-align:left}th{background:#f5f5f5}code{background:#f2f2f2;padding:1px 4px}</style>"
    )
    return f'<html><body style="{style}">{css}{"".join(out)}</body></html>'


def _send(msg: EmailMessage) -> None:
    from src.config import settings

    if settings.SMTP_PORT == 465:  # implicit TLS; 587 upgrades with STARTTLS
        smtp_cm = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30)
    else:
        smtp_cm = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30)
    with smtp_cm as smtp:
        if settings.SMTP_PORT != 465:
            smtp.starttls()
        smtp.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
        smtp.send_message(msg)


async def deliver_automation_email(
    automation: Dict[str, Any], thread_id: str | None, run_id: str | None = None
) -> Dict[str, Any]:
    """Email the finished report. Never raises; returns a delivery_result row."""
    from src.config import settings

    result: Dict[str, Any] = {"method": "email", "success": False}
    # One operator-configured recipient list: in a multi-user deployment any
    # user choosing "Email" would mail their report to it.
    if settings.HOST_MODE != "oss":
        result["error"] = "email delivery is only available in single-user (HOST_MODE=oss) deployments"
        logger.warning(f"[EMAIL] refused: {result['error']}")
        return result
    recipients = [a.strip() for a in settings.AUTOMATION_EMAIL_TO.split(",") if a.strip()]
    if not (settings.SMTP_USER and settings.SMTP_PASSWORD and recipients):
        result["error"] = "SMTP_USER, SMTP_PASSWORD and AUTOMATION_EMAIL_TO must be set"
        logger.warning(f"[EMAIL] not configured, skipping: {result['error']}")
        return result
    try:
        body = await _final_report_text(thread_id, run_id) if thread_id else ""
        if not body.strip():
            result["error"] = "run produced no report text"
            return result
        heading = _HEADING_RE.search(body)
        subject = (heading.group(1) if heading else automation.get("name") or "Automation update")
        subject = re.sub(r"[*_`]", "", subject).strip()

        msg = EmailMessage()
        msg["Subject"] = f"{SUBJECT_PREFIX} {subject}"
        msg["From"] = settings.SMTP_FROM or settings.SMTP_USER
        msg["To"] = ", ".join(recipients)
        msg.set_content(body)
        msg.add_alternative(markdown_to_html(body), subtype="html")
        await asyncio.to_thread(_send, msg)
        result["success"] = True
        logger.info(f"[EMAIL] sent '{subject}' to {len(recipients)} recipient(s)")
    except Exception as e:
        logger.error(f"[EMAIL] delivery failed: {e}")
        result["error"] = str(e)
    return result
