"""Generate parity fixtures for the aggregate-board TypeScript port.

For each parameter combination we dump, from Supabase:
  - the exact raw `sources` and `entries` rows that `build_aggregate_board` consumes
    (same two queries, same order), and
  - the board JSON that the Python implementation produces (the oracle).

The TypeScript `buildAggregateBoard` logic is fed the same sources+entries and must
reproduce the board byte-for-byte. Fixtures land in:
    supabase/functions/aggregate-board/__fixtures__/<name>.json

Run from the project root with DATABASE_URL set:
    python backend/dump_board_fixture.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.aggregate import build_aggregate_board  # noqa: E402
from app.db import get_connection, latest_successful_snapshot_ids  # noqa: E402

FIXTURE_DIR = PROJECT_ROOT / "supabase" / "functions" / "aggregate-board" / "__fixtures__"

# Source ids that the format toggles exclude (mirrors main.py).
TDG_OBP = "tdg_2026_obp_top_500"
TDG_POINTS = "tdg_2026_points_top_500"
FANTRAX_ROTO = "fantrax_2026_top_500"
FANTRAX_POINTS = "fantrax_2026_top_500_points"

SOURCES_SQL = """
    SELECT
        s.*,
        snap.id AS snapshot_id,
        snap.fetched_at,
        snap.row_count,
        snap.source_date,
        snap.source_date_kind
    FROM snapshots snap
    JOIN sources s ON s.id = snap.source_id
    WHERE snap.id IN ({placeholders})
    ORDER BY s.name, s.ranking_type
"""

ENTRIES_SQL = """
    SELECT
        e.*,
        s.short_name,
        s.source_tag,
        c.id AS correction_id,
        c.corrected_name,
        c.corrected_player_key
    FROM ranking_entries e
    JOIN sources s ON s.id = e.source_id
    LEFT JOIN player_name_corrections c
        ON c.source_id = e.source_id
        AND c.original_player_key = e.player_key
    WHERE e.snapshot_id IN ({placeholders})
    ORDER BY e.rank
"""

# name -> (exclude_source_ids, included_tags or None, included_only)
CASES = {
    "default_obp_roto": ({TDG_POINTS, FANTRAX_POINTS}, None, True),
    "points_formats": ({TDG_OBP, FANTRAX_ROTO}, None, True),
    "tag_updated_only": ({TDG_POINTS, FANTRAX_POINTS}, ["Updated"], True),
    "all_sources": ({TDG_POINTS, FANTRAX_POINTS}, None, False),
}


def fetch_raw(exclude_source_ids, included_only):
    with get_connection() as conn:
        snapshot_ids = latest_successful_snapshot_ids(
            conn, exclude_source_ids=exclude_source_ids, included_only=included_only
        )
        if not snapshot_ids:
            return [], []
        placeholders = ",".join("?" for _ in snapshot_ids)
        sources = [dict(r) for r in conn.execute(SOURCES_SQL.format(placeholders=placeholders), snapshot_ids).fetchall()]
        entries = [dict(r) for r in conn.execute(ENTRIES_SQL.format(placeholders=placeholders), snapshot_ids).fetchall()]
    return sources, entries


def main() -> None:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    for name, (exclude, tags, included_only) in CASES.items():
        sources, entries = fetch_raw(exclude, included_only)
        board = build_aggregate_board(
            exclude_source_ids=exclude,
            included_source_tags=tags,
            included_sources_only=included_only,
        )
        payload = {
            "params": {
                "excludeSourceIds": sorted(exclude),
                "includedTags": tags,
                "includedOnly": included_only,
            },
            "sources": sources,
            "entries": entries,
            "board": board,
        }
        out = FIXTURE_DIR / f"{name}.json"
        out.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        print(f"  {name:<22} sources={len(sources):>3} entries={len(entries):>7} players={len(board['players']):>5} -> {out.name}")


if __name__ == "__main__":
    main()
