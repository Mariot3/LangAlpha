"""The report-back pair a turn takes over from an interrupted summary."""

from __future__ import annotations


async def carried_pair(request, thread_id: str) -> dict:
    """START metadata naming the pair this turn releases for the summary before it.

    A summary that ends interrupted (an approval card, a question) is waiting on
    the user and releases nothing, and the turn that answers it is a public
    request stripped of the pair. So whichever turn follows on the thread, a
    resume or a message past the interrupt, stamps the summary's pair: it
    releases it when it ends and carries it on when it is interrupted too. The
    dispatch generation travels with it, so the release spares a pair
    dispatched again since. A summary names its own pair and takes none.
    """
    if getattr(request, "report_back_ptc_thread_id", None):
        return {}
    from src.server.database.runs import lifecycle as tl_db

    # A read failure fails the turn start: a turn stamped without the pair
    # would leave it held until its origin expires.
    prev = await tl_db.get_latest_attempt(thread_id)
    if prev is None or prev.get("status") != "interrupted":
        return {}
    meta = prev.get("metadata") or {}
    if not meta.get("report_back_ptc_thread_id"):
        return {}
    return {
        "report_back_ptc_thread_id": meta["report_back_ptc_thread_id"],
        "origin_dispatch_gen": meta.get("origin_dispatch_gen"),
    }
