"""Operator refresh: scrape ranking sources + Ottoneu leagues and write to Supabase.

Run this on your machine (home IP scrapes every source, including the ones a datacenter
would be blocked from). Because the backend now writes to Supabase, whatever this fetches is
immediately live on the GitHub Pages site.

Usage (from the project root, with the virtualenv + .env DATABASE_URL in place):
    python backend/refresh_supabase.py                # sources + leagues
    python backend/refresh_supabase.py --continuous   # only Continuous-tagged sources + leagues
    python backend/refresh_supabase.py --skip-leagues # sources only
    python backend/refresh_supabase.py --skip-sources # leagues only
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND_DIR))

from app.db import init_db  # noqa: E402
from app.main import update_all, update_all_leagues  # noqa: E402


def refresh_sources(continuous: bool) -> None:
    tag = "Continuous" if continuous else ""
    print(f"Updating ranking sources{' (Continuous only)' if tag else ''}...")
    results = update_all(source_tags=tag)["results"]
    for r in results:
        print(f"  {r['status']:<8} {r['source_id']:<38} rows={r.get('row_count', 0):<6} {str(r.get('message', ''))[:55]}")
    ok = sum(1 for r in results if r["status"] == "success")
    err = sum(1 for r in results if r["status"] == "error")
    skip = sum(1 for r in results if r["status"] == "skipped")
    print(f"  -> {ok} updated, {err} failed, {skip} skipped\n")


def refresh_leagues() -> None:
    print("Updating Ottoneu leagues/teams...")
    result = update_all_leagues()
    for league in result.get("results", []):
        print(f"  {league.get('status', ''):<8} {str(league.get('league_name', '')):<24} {str(league.get('message', ''))[:60]}")
    print(f"  -> {result.get('message', 'done')}\n")


def main() -> None:
    ap = argparse.ArgumentParser(description="Scrape sources + leagues and push to Supabase.")
    ap.add_argument("--continuous", action="store_true", help="Only refresh Continuous-tagged sources.")
    ap.add_argument("--skip-sources", action="store_true", help="Skip ranking-source scraping.")
    ap.add_argument("--skip-leagues", action="store_true", help="Skip Ottoneu league/team scraping.")
    args = ap.parse_args()

    print("Ensuring Supabase schema (init_db)...")
    init_db()

    if not args.skip_sources:
        refresh_sources(args.continuous)
    if not args.skip_leagues:
        refresh_leagues()

    print("Done. Supabase is updated - the live GitHub Pages site reflects the new data.")


if __name__ == "__main__":
    main()
