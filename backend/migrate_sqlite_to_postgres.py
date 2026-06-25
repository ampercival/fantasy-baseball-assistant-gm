"""One-time migration: apply the Supabase schema and copy the local SQLite data into it.

Usage (from the project root, with the virtualenv active and DATABASE_URL set in your
.env / environment):

    python backend/migrate_sqlite_to_postgres.py

Steps:
  1. Applies every SQL file in supabase/migrations/ (in filename order) - the canonical
     Postgres schema + RLS policies.
  2. Truncates all data tables (RESTART IDENTITY CASCADE) so re-runs are clean.
  3. Copies every table from the SQLite file into Postgres, preserving ids.
  4. Resets SERIAL sequences past the largest copied id.

Safe to re-run: the Postgres data ends up as an exact copy of the SQLite file.
"""

from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BACKEND_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from app.db import get_connection  # noqa: E402  (psycopg connection helper)

SQLITE_PATH = PROJECT_ROOT / "data" / "assistant_gm.sqlite3"
MIGRATIONS_DIR = PROJECT_ROOT / "supabase" / "migrations"

# Tables in foreign-key dependency order (parents before children).
TABLES_IN_ORDER = [
    "sources",
    "snapshots",
    "ranking_entries",
    "player_name_corrections",
    "fantasy_teams",
    "fantasy_leagues",
    "league_team_memberships",
    "team_snapshots",
    "team_roster_entries",
    "team_cap_penalties",
    "team_loans",
    "team_trade_block",
    "pitcher_xfip_stats",
    "lineup_always_start_players",
    "lineup_always_sit_players",
]

# Tables whose `id` is a SERIAL column whose sequence must be reset after inserting
# rows with explicit ids.
SERIAL_TABLES = [
    "snapshots",
    "ranking_entries",
    "player_name_corrections",
    "team_snapshots",
    "team_roster_entries",
    "team_cap_penalties",
    "team_loans",
    "team_trade_block",
]


def apply_migrations(pg) -> None:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"))
    if not files:
        raise SystemExit(f"No migration files found in {MIGRATIONS_DIR}")
    for path in files:
        print(f"  applying {path.name}")
        pg.executescript(path.read_text(encoding="utf-8"))


def table_columns(sqlite_conn: sqlite3.Connection, table: str) -> list[str]:
    rows = sqlite_conn.execute(f"PRAGMA table_info({table})").fetchall()
    return [row["name"] for row in rows]


def copy_table(sqlite_conn: sqlite3.Connection, pg, table: str) -> int:
    columns = table_columns(sqlite_conn, table)
    rows = sqlite_conn.execute(f"SELECT {', '.join(columns)} FROM {table}").fetchall()
    if not rows:
        return 0
    placeholders = ", ".join(["?"] * len(columns))
    column_list = ", ".join(columns)
    pg.executemany(
        f"INSERT INTO {table} ({column_list}) VALUES ({placeholders})",
        [tuple(row[col] for col in columns) for row in rows],
    )
    return len(rows)


def reset_sequence(pg, table: str) -> None:
    pg.execute(
        f"""
        SELECT setval(
            pg_get_serial_sequence('{table}', 'id'),
            GREATEST((SELECT COALESCE(MAX(id), 1) FROM {table}), 1)
        )
        """
    )


def main() -> None:
    if not SQLITE_PATH.exists():
        raise SystemExit(f"SQLite database not found at {SQLITE_PATH}")

    print(f"Source SQLite: {SQLITE_PATH}")
    sqlite_conn = sqlite3.connect(SQLITE_PATH)
    sqlite_conn.row_factory = sqlite3.Row

    try:
        with get_connection() as pg:
            print("Applying Supabase schema migrations...")
            apply_migrations(pg)

            print("Truncating destination tables...")
            pg.execute(
                "TRUNCATE TABLE "
                + ", ".join(TABLES_IN_ORDER)
                + " RESTART IDENTITY CASCADE"
            )

            total = 0
            print("Copying data...")
            for table in TABLES_IN_ORDER:
                count = copy_table(sqlite_conn, pg, table)
                total += count
                print(f"  {table:<30} {count:>7} rows")

            print("Resetting id sequences...")
            for table in SERIAL_TABLES:
                reset_sequence(pg, table)

            print(f"Done. Migrated {total} rows across {len(TABLES_IN_ORDER)} tables.")
    finally:
        sqlite_conn.close()


if __name__ == "__main__":
    main()
