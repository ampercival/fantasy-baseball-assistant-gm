"""Local refresh worker: polls Supabase for refresh requests and runs the scrape.

Run this on the operator's machine (ideally auto-started at login). When the GitHub Pages site
enqueues a refresh request, this claims it, scrapes the sources/leagues (writing to Supabase),
and marks the request done - so the live site updates without you touching the PC directly.

    python backend/refresh_worker.py            # poll every 10s
    python backend/refresh_worker.py --interval 30
"""

from __future__ import annotations

import argparse
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

from app.db import get_connection, init_db  # noqa: E402
from app.main import update_all, update_all_leagues  # noqa: E402

STALE_RUNNING_SECONDS = 1800  # a 'running' request older than this is treated as crashed


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def recover_stale_running() -> None:
    """Requeue requests left 'running' by a previous crashed worker run."""
    cutoff = datetime.now(timezone.utc).timestamp() - STALE_RUNNING_SECONDS
    with get_connection() as conn:
        rows = conn.execute("SELECT id, started_at FROM refresh_requests WHERE status = 'running'").fetchall()
        for row in rows:
            try:
                started = datetime.fromisoformat(row["started_at"]).timestamp() if row["started_at"] else 0
            except ValueError:
                started = 0
            if started < cutoff:
                conn.execute("UPDATE refresh_requests SET status = 'pending' WHERE id = ?", (row["id"],))
                print(f"  requeued stale running request {row['id']}")


def claim_next_request() -> dict | None:
    """Atomically claim the oldest pending request by marking it 'running'."""
    with get_connection() as conn:
        row = conn.execute(
            """
            UPDATE refresh_requests
            SET status = 'running', started_at = ?
            WHERE id = (SELECT id FROM refresh_requests WHERE status = 'pending' ORDER BY id ASC LIMIT 1)
            RETURNING *
            """,
            (now_iso(),),
        ).fetchone()
    return dict(row) if row else None


def mark(request_id: int, status: str, message: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE refresh_requests SET status = ?, finished_at = ?, message = ? WHERE id = ?",
            (status, now_iso(), message[:500], request_id),
        )


def run_request(scope: str) -> str:
    parts: list[str] = []
    if scope in ("all", "continuous"):
        tag = "Continuous" if scope == "continuous" else ""
        results = update_all(source_tags=tag)["results"]
        ok = sum(1 for r in results if r["status"] == "success")
        err = sum(1 for r in results if r["status"] == "error")
        parts.append(f"{ok} sources updated" + (f", {err} failed" if err else ""))
    if scope in ("all", "leagues"):
        parts.append(str(update_all_leagues().get("message", "leagues updated")))
    return "; ".join(parts) or "Nothing to do."


def main() -> None:
    ap = argparse.ArgumentParser(description="Poll Supabase for refresh requests and scrape.")
    ap.add_argument("--interval", type=int, default=10, help="Seconds between polls (default 10).")
    args = ap.parse_args()

    print("Ensuring Supabase schema (init_db)...")
    init_db()
    recover_stale_running()
    print(f"Refresh worker running. Polling every {args.interval}s. Press Ctrl+C to stop.\n")

    try:
        while True:
            request = claim_next_request()
            if not request:
                time.sleep(args.interval)
                continue
            print(f"[{now_iso()[:19]}] claimed request {request['id']} (scope={request['scope']})...")
            try:
                message = run_request(request["scope"])
                mark(request["id"], "done", message)
                print(f"[{now_iso()[:19]}] done: {message}\n")
            except Exception as exc:  # noqa: BLE001
                mark(request["id"], "error", str(exc))
                print(f"[{now_iso()[:19]}] ERROR on request {request['id']}: {exc}")
                traceback.print_exc()
    except KeyboardInterrupt:
        print("\nWorker stopped.")


if __name__ == "__main__":
    main()
