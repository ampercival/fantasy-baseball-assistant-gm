from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable

from .ottoneu import OttoneuLeagueSnapshot, OttoneuTeamSnapshot
from .player_keys import normalize_player_key
from .scrapers import RankingEntry
from .sources import SOURCES, RankingSource

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = PROJECT_ROOT / "data"
DB_PATH = DATA_DIR / "assistant_gm.sqlite3"


def get_connection() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS sources (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                short_name TEXT NOT NULL,
                ranking_type TEXT NOT NULL,
                url TEXT NOT NULL,
                scraper TEXT NOT NULL,
                access TEXT NOT NULL,
                notes TEXT NOT NULL,
                source_tag TEXT NOT NULL DEFAULT 'Updated',
                included INTEGER NOT NULL DEFAULT 1,
                can_update INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id TEXT NOT NULL REFERENCES sources(id),
                fetched_at TEXT NOT NULL,
                status TEXT NOT NULL,
                row_count INTEGER NOT NULL DEFAULT 0,
                message TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL,
                source_date TEXT,
                source_date_kind TEXT
            );

            CREATE TABLE IF NOT EXISTS ranking_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
                source_id TEXT NOT NULL REFERENCES sources(id),
                rank INTEGER NOT NULL,
                player_name TEXT NOT NULL,
                player_key TEXT NOT NULL,
                team TEXT,
                positions TEXT,
                age REAL
            );

            CREATE INDEX IF NOT EXISTS idx_snapshots_source_status
                ON snapshots(source_id, status, fetched_at DESC);

            CREATE INDEX IF NOT EXISTS idx_entries_snapshot
                ON ranking_entries(snapshot_id);

            CREATE INDEX IF NOT EXISTS idx_entries_player_key
                ON ranking_entries(player_key);

            CREATE TABLE IF NOT EXISTS player_name_corrections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
                original_name TEXT NOT NULL,
                original_player_key TEXT NOT NULL,
                corrected_name TEXT NOT NULL,
                corrected_player_key TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(source_id, original_player_key)
            );

            CREATE INDEX IF NOT EXISTS idx_player_name_corrections_source_key
                ON player_name_corrections(source_id, original_player_key);

            CREATE TABLE IF NOT EXISTS fantasy_teams (
                team_uid TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                league_id INTEGER NOT NULL,
                team_id INTEGER NOT NULL,
                league_name TEXT,
                team_name TEXT NOT NULL,
                owner TEXT,
                url TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS fantasy_leagues (
                league_uid TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                league_id INTEGER NOT NULL,
                league_name TEXT NOT NULL,
                url TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS league_team_memberships (
                league_uid TEXT NOT NULL REFERENCES fantasy_leagues(league_uid) ON DELETE CASCADE,
                team_uid TEXT NOT NULL REFERENCES fantasy_teams(team_uid) ON DELETE CASCADE,
                team_name TEXT NOT NULL,
                team_url TEXT NOT NULL,
                standings_rank INTEGER,
                points REAL,
                change REAL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (league_uid, team_uid)
            );

            CREATE TABLE IF NOT EXISTS team_snapshots (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                team_uid TEXT NOT NULL REFERENCES fantasy_teams(team_uid),
                fetched_at TEXT NOT NULL,
                status TEXT NOT NULL,
                roster_count INTEGER,
                roster_limit INTEGER,
                cap_used INTEGER,
                cap_limit INTEGER,
                salary_total INTEGER,
                penalty_total INTEGER,
                loans_in INTEGER,
                loans_out INTEGER,
                standings_rank TEXT,
                points REAL,
                last_transaction TEXT,
                trade_block_updated TEXT,
                trade_block_note TEXT,
                message TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS team_roster_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL REFERENCES team_snapshots(id) ON DELETE CASCADE,
                team_uid TEXT NOT NULL REFERENCES fantasy_teams(team_uid),
                section TEXT NOT NULL,
                ottoneu_player_id INTEGER,
                player_name TEXT NOT NULL,
                player_key TEXT NOT NULL,
                mlb_team TEXT,
                status TEXT,
                salary INTEGER NOT NULL,
                positions TEXT,
                games INTEGER,
                plate_appearances INTEGER,
                games_started INTEGER,
                innings_pitched REAL,
                points_per_game REAL,
                points_per_ip REAL,
                points REAL
            );

            CREATE TABLE IF NOT EXISTS team_cap_penalties (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL REFERENCES team_snapshots(id) ON DELETE CASCADE,
                team_uid TEXT NOT NULL REFERENCES fantasy_teams(team_uid),
                player_name TEXT NOT NULL,
                player_key TEXT NOT NULL,
                penalty INTEGER NOT NULL,
                cut_date TEXT
            );

            CREATE TABLE IF NOT EXISTS team_loans (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL REFERENCES team_snapshots(id) ON DELETE CASCADE,
                team_uid TEXT NOT NULL REFERENCES fantasy_teams(team_uid),
                direction TEXT NOT NULL,
                counterparty TEXT NOT NULL,
                amount INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS team_trade_block (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                snapshot_id INTEGER NOT NULL REFERENCES team_snapshots(id) ON DELETE CASCADE,
                team_uid TEXT NOT NULL REFERENCES fantasy_teams(team_uid),
                side TEXT NOT NULL,
                player_name TEXT NOT NULL,
                player_key TEXT NOT NULL,
                positions TEXT,
                salary INTEGER
            );

            CREATE TABLE IF NOT EXISTS pitcher_xfip_stats (
                pitcher_key TEXT PRIMARY KEY,
                pitcher_name TEXT NOT NULL,
                season INTEGER NOT NULL,
                xfip_minus REAL NOT NULL,
                source TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS lineup_always_start_players (
                league_uid TEXT NOT NULL REFERENCES fantasy_leagues(league_uid) ON DELETE CASCADE,
                team_uid TEXT NOT NULL REFERENCES fantasy_teams(team_uid) ON DELETE CASCADE,
                player_key TEXT NOT NULL,
                player_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (league_uid, team_uid, player_key)
            );

            CREATE TABLE IF NOT EXISTS lineup_always_sit_players (
                league_uid TEXT NOT NULL REFERENCES fantasy_leagues(league_uid) ON DELETE CASCADE,
                team_uid TEXT NOT NULL REFERENCES fantasy_teams(team_uid) ON DELETE CASCADE,
                player_key TEXT NOT NULL,
                player_name TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (league_uid, team_uid, player_key)
            );

            CREATE INDEX IF NOT EXISTS idx_team_snapshots_team_status
                ON team_snapshots(team_uid, status, fetched_at DESC);

            CREATE INDEX IF NOT EXISTS idx_team_roster_snapshot
                ON team_roster_entries(snapshot_id);

            CREATE INDEX IF NOT EXISTS idx_team_roster_player_key
                ON team_roster_entries(player_key);

            CREATE INDEX IF NOT EXISTS idx_pitcher_xfip_stats_season
                ON pitcher_xfip_stats(season, pitcher_name);
            """
        )
        ensure_column(conn, "snapshots", "source_date", "TEXT")
        ensure_column(conn, "snapshots", "source_date_kind", "TEXT")
        ensure_column(conn, "sources", "source_tag", "TEXT NOT NULL DEFAULT 'Updated'")
        ensure_column(conn, "sources", "included", "INTEGER NOT NULL DEFAULT 1")
        migrate_source_tags(conn)
        upsert_sources(conn, SOURCES)
        normalize_existing_player_keys(conn)


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    if column not in columns:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def migrate_source_tags(conn: sqlite3.Connection) -> None:
    conn.executemany(
        """
        UPDATE sources
        SET source_tag = ?
        WHERE source_tag = ?
        """,
        [
            ("Continuous", "2026 Continuous"),
            ("Updated", "2026 Updated"),
            ("Old/Pre-season", "2026 Pre-season"),
        ],
    )


def normalize_existing_player_keys(conn: sqlite3.Connection) -> None:
    for table in ("ranking_entries", "team_roster_entries", "team_cap_penalties", "team_trade_block"):
        rows = conn.execute(f"SELECT id, player_name, player_key FROM {table}").fetchall()
        updates = []
        for row in rows:
            player_key = normalize_player_key(row["player_name"])
            if player_key != row["player_key"]:
                updates.append((player_key, row["id"]))
        if updates:
            conn.executemany(f"UPDATE {table} SET player_key = ? WHERE id = ?", updates)


def upsert_sources(conn: sqlite3.Connection, sources: Iterable[RankingSource]) -> None:
    conn.executemany(
        """
        INSERT INTO sources (
            id, name, short_name, ranking_type, url, scraper, access, notes, source_tag, included, can_update
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
            name=excluded.name,
            short_name=excluded.short_name,
            ranking_type=excluded.ranking_type,
            url=excluded.url,
            scraper=excluded.scraper,
            access=excluded.access,
            notes=excluded.notes,
            can_update=excluded.can_update
        """,
        [
            (
                source.id,
                source.name,
                source.short_name,
                source.ranking_type,
                source.url,
                source.scraper,
                source.access,
                source.notes,
                source.default_tag,
                1,
                1 if source.can_update else 0,
            )
            for source in sources
        ],
    )


def update_source_tag(source_id: str, source_tag: str) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE sources
            SET source_tag = ?
            WHERE id = ?
            """,
            (source_tag, source_id),
        )
        return cursor.rowcount > 0


def update_source_included(source_id: str, included: bool) -> bool:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE sources
            SET included = ?
            WHERE id = ?
            """,
            (1 if included else 0, source_id),
        )
        return cursor.rowcount > 0


def list_player_name_corrections(source_id: str | None = None) -> list[dict]:
    params: list[str] = []
    source_clause = ""
    if source_id:
        source_clause = "WHERE c.source_id = ?"
        params.append(source_id)

    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT
                c.*,
                s.name AS source_name,
                s.short_name AS source_short_name
            FROM player_name_corrections c
            JOIN sources s ON s.id = c.source_id
            {source_clause}
            ORDER BY s.name, c.original_name
            """,
            params,
        ).fetchall()
    return [dict(row) for row in rows]


def upsert_player_name_correction(
    *,
    source_id: str,
    original_name: str,
    corrected_name: str,
    timestamp: str,
) -> dict:
    original_player_key = normalize_player_key(original_name)
    corrected_player_key = normalize_player_key(corrected_name)
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO player_name_corrections (
                source_id, original_name, original_player_key, corrected_name, corrected_player_key, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(source_id, original_player_key) DO UPDATE SET
                original_name=excluded.original_name,
                corrected_name=excluded.corrected_name,
                corrected_player_key=excluded.corrected_player_key,
                updated_at=excluded.updated_at
            RETURNING *
            """,
            (
                source_id,
                original_name,
                original_player_key,
                corrected_name,
                corrected_player_key,
                timestamp,
                timestamp,
            ),
        )
        row = cursor.fetchone()
    return dict(row)


def delete_player_name_correction(correction_id: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM player_name_corrections WHERE id = ?", (correction_id,))
        return cursor.rowcount > 0


def upsert_pitcher_xfip_stats(entries: Iterable[dict], *, timestamp: str) -> int:
    rows = []
    for entry in entries:
        pitcher_name = str(entry["pitcher_name"]).strip()
        rows.append(
            (
                normalize_player_key(pitcher_name),
                pitcher_name,
                int(entry["season"]),
                float(entry["xfip_minus"]),
                str(entry.get("source") or "FanGraphs CSV"),
                timestamp,
            )
        )
    if not rows:
        return 0

    with get_connection() as conn:
        conn.executemany(
            """
            INSERT INTO pitcher_xfip_stats (
                pitcher_key, pitcher_name, season, xfip_minus, source, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(pitcher_key) DO UPDATE SET
                pitcher_name=excluded.pitcher_name,
                season=excluded.season,
                xfip_minus=excluded.xfip_minus,
                source=excluded.source,
                updated_at=excluded.updated_at
            """,
            rows,
        )
    return len(rows)


def list_pitcher_xfip_stats() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM pitcher_xfip_stats
            ORDER BY season DESC, pitcher_name
            """
        ).fetchall()
    return [dict(row) for row in rows]


def list_lineup_always_start(league_uid: str, team_uid: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM lineup_always_start_players
            WHERE league_uid = ? AND team_uid = ?
            ORDER BY player_name
            """,
            (league_uid, team_uid),
        ).fetchall()
    return [dict(row) for row in rows]


def list_lineup_always_sit(league_uid: str, team_uid: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT *
            FROM lineup_always_sit_players
            WHERE league_uid = ? AND team_uid = ?
            ORDER BY player_name
            """,
            (league_uid, team_uid),
        ).fetchall()
    return [dict(row) for row in rows]


def set_lineup_always_start(
    *,
    league_uid: str,
    team_uid: str,
    player_key: str,
    player_name: str,
    always_start: bool,
    timestamp: str,
) -> dict | None:
    normalized_key = normalize_player_key(player_name) if not player_key.strip() else player_key.strip()
    clean_name = player_name.strip()
    if not always_start:
        with get_connection() as conn:
            conn.execute(
                """
                DELETE FROM lineup_always_start_players
                WHERE league_uid = ? AND team_uid = ? AND player_key = ?
                """,
                (league_uid, team_uid, normalized_key),
            )
        return None

    with get_connection() as conn:
        conn.execute(
            """
            DELETE FROM lineup_always_sit_players
            WHERE league_uid = ? AND team_uid = ? AND player_key = ?
            """,
            (league_uid, team_uid, normalized_key),
        )
        cursor = conn.execute(
            """
            INSERT INTO lineup_always_start_players (
                league_uid, team_uid, player_key, player_name, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(league_uid, team_uid, player_key) DO UPDATE SET
                player_name=excluded.player_name,
                updated_at=excluded.updated_at
            RETURNING *
            """,
            (league_uid, team_uid, normalized_key, clean_name, timestamp, timestamp),
        )
        row = cursor.fetchone()
    return dict(row) if row else None


def set_lineup_always_sit(
    *,
    league_uid: str,
    team_uid: str,
    player_key: str,
    player_name: str,
    always_sit: bool,
    timestamp: str,
) -> dict | None:
    normalized_key = normalize_player_key(player_name) if not player_key.strip() else player_key.strip()
    clean_name = player_name.strip()
    if not always_sit:
        with get_connection() as conn:
            conn.execute(
                """
                DELETE FROM lineup_always_sit_players
                WHERE league_uid = ? AND team_uid = ? AND player_key = ?
                """,
                (league_uid, team_uid, normalized_key),
            )
        return None

    with get_connection() as conn:
        conn.execute(
            """
            DELETE FROM lineup_always_start_players
            WHERE league_uid = ? AND team_uid = ? AND player_key = ?
            """,
            (league_uid, team_uid, normalized_key),
        )
        cursor = conn.execute(
            """
            INSERT INTO lineup_always_sit_players (
                league_uid, team_uid, player_key, player_name, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(league_uid, team_uid, player_key) DO UPDATE SET
                player_name=excluded.player_name,
                updated_at=excluded.updated_at
            RETURNING *
            """,
            (league_uid, team_uid, normalized_key, clean_name, timestamp, timestamp),
        )
        row = cursor.fetchone()
    return dict(row) if row else None


def save_snapshot(
    source: RankingSource,
    entries: list[RankingEntry],
    *,
    fetched_at: str,
    status: str = "success",
    message: str = "",
    source_date: str | None = None,
    source_date_kind: str | None = None,
) -> int:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO snapshots (
                source_id, fetched_at, status, row_count, message, source_url, source_date, source_date_kind
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (source.id, fetched_at, status, len(entries), message, source.url, source_date, source_date_kind),
        )
        snapshot_id = int(cursor.lastrowid)
        conn.executemany(
            """
            INSERT INTO ranking_entries (
                snapshot_id, source_id, rank, player_name, player_key, team, positions, age
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    snapshot_id,
                    source.id,
                    entry.rank,
                    entry.player_name,
                    normalize_player_key(entry.player_name),
                    entry.team,
                    entry.positions,
                    entry.age,
                )
                for entry in entries
            ],
        )
        return snapshot_id


def save_failed_snapshot(source: RankingSource, *, fetched_at: str, message: str) -> int:
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO snapshots (source_id, fetched_at, status, row_count, message, source_url, source_date, source_date_kind)
            VALUES (?, ?, 'error', 0, ?, ?, NULL, NULL)
            """,
            (source.id, fetched_at, message, source.url),
        )
        return int(cursor.lastrowid)


def update_latest_snapshot_source_date(source: RankingSource, *, source_date: str, source_date_kind: str) -> int | None:
    with get_connection() as conn:
        snapshot = conn.execute(
            """
            SELECT id
            FROM snapshots
            WHERE source_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (source.id,),
        ).fetchone()
        if not snapshot:
            return None
        snapshot_id = int(snapshot["id"])
        conn.execute(
            """
            UPDATE snapshots
            SET source_date = ?, source_date_kind = ?
            WHERE id = ?
            """,
            (source_date, source_date_kind, snapshot_id),
        )
        return snapshot_id


def list_sources_with_status() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                s.*,
                latest.id AS last_snapshot_id,
                latest.fetched_at AS last_fetched_at,
                latest.status AS last_status,
                latest.row_count AS last_row_count,
                latest.message AS last_message,
                latest.source_date AS last_source_date,
                latest.source_date_kind AS last_source_date_kind,
                COALESCE(corrections.correction_count, 0) AS correction_count
            FROM sources s
            LEFT JOIN (
                SELECT snapshots.*
                FROM snapshots
                INNER JOIN (
                    SELECT source_id, MAX(id) AS max_id
                    FROM snapshots
                    GROUP BY source_id
                ) latest_ids ON latest_ids.max_id = snapshots.id
            ) latest ON latest.source_id = s.id
            LEFT JOIN (
                SELECT source_id, COUNT(*) AS correction_count
                FROM player_name_corrections
                GROUP BY source_id
            ) corrections ON corrections.source_id = s.id
            ORDER BY s.name, s.ranking_type
            """
        ).fetchall()
    return [dict(row) for row in rows]


def latest_successful_snapshot_ids(
    conn: sqlite3.Connection,
    exclude_source_ids: set[str] | None = None,
    included_only: bool = True,
) -> list[int]:
    params: list[str] = []
    exclusion_clause = ""
    included_clause = "AND sources.included = 1" if included_only else ""
    if exclude_source_ids:
        placeholders = ",".join("?" for _ in exclude_source_ids)
        exclusion_clause = f"AND snapshots.source_id NOT IN ({placeholders})"
        params.extend(sorted(exclude_source_ids))

    rows = conn.execute(
        f"""
        SELECT MAX(snapshots.id) AS snapshot_id
        FROM snapshots
        JOIN sources ON sources.id = snapshots.source_id
        WHERE snapshots.status = 'success'
            AND snapshots.row_count > 0
            {included_clause}
            {exclusion_clause}
        GROUP BY snapshots.source_id
        """,
        params,
    ).fetchall()
    return [int(row["snapshot_id"]) for row in rows if row["snapshot_id"] is not None]


def save_team_snapshot(team: OttoneuTeamSnapshot, *, fetched_at: str, message: str = "") -> int:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO fantasy_teams (
                team_uid, platform, league_id, team_id, league_name, team_name, owner, url, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(team_uid) DO UPDATE SET
                platform=excluded.platform,
                league_id=excluded.league_id,
                team_id=excluded.team_id,
                league_name=excluded.league_name,
                team_name=excluded.team_name,
                owner=excluded.owner,
                url=excluded.url,
                updated_at=excluded.updated_at
            """,
            (
                team.team_uid,
                team.platform,
                team.league_id,
                team.team_id,
                team.league_name,
                team.team_name,
                team.owner,
                team.url,
                fetched_at,
                fetched_at,
            ),
        )
        upsert_league_from_team(conn, team, fetched_at=fetched_at)
        cursor = conn.execute(
            """
            INSERT INTO team_snapshots (
                team_uid, fetched_at, status, roster_count, roster_limit, cap_used, cap_limit,
                salary_total, penalty_total, loans_in, loans_out, standings_rank, points,
                last_transaction, trade_block_updated, trade_block_note, message, source_url
            )
            VALUES (?, ?, 'success', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                team.team_uid,
                fetched_at,
                team.roster_count,
                team.roster_limit,
                team.cap_used,
                team.cap_limit,
                team.salary_total,
                team.penalty_total,
                team.loans_in,
                team.loans_out,
                team.standings_rank,
                team.points,
                team.last_transaction,
                team.trade_block_updated,
                team.trade_block_note,
                message,
                team.url,
            ),
        )
        snapshot_id = int(cursor.lastrowid)
        conn.executemany(
            """
            INSERT INTO team_roster_entries (
                snapshot_id, team_uid, section, ottoneu_player_id, player_name, player_key, mlb_team, status,
                salary, positions, games, plate_appearances, games_started, innings_pitched,
                points_per_game, points_per_ip, points
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    snapshot_id,
                    team.team_uid,
                    entry.section,
                    entry.ottoneu_player_id,
                    entry.player_name,
                    entry.player_key,
                    entry.mlb_team,
                    entry.status,
                    entry.salary,
                    entry.positions,
                    entry.games,
                    entry.plate_appearances,
                    entry.games_started,
                    entry.innings_pitched,
                    entry.points_per_game,
                    entry.points_per_ip,
                    entry.points,
                )
                for entry in team.roster
            ],
        )
        conn.executemany(
            """
            INSERT INTO team_cap_penalties (snapshot_id, team_uid, player_name, player_key, penalty, cut_date)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            [
                (snapshot_id, team.team_uid, penalty.player_name, penalty.player_key, penalty.penalty, penalty.cut_date)
                for penalty in team.penalties
            ],
        )
        conn.executemany(
            """
            INSERT INTO team_loans (snapshot_id, team_uid, direction, counterparty, amount)
            VALUES (?, ?, ?, ?, ?)
            """,
            [(snapshot_id, team.team_uid, loan.direction, loan.counterparty, loan.amount) for loan in team.loans],
        )
        conn.executemany(
            """
            INSERT INTO team_trade_block (snapshot_id, team_uid, side, player_name, player_key, positions, salary)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    snapshot_id,
                    team.team_uid,
                    item.side,
                    item.player_name,
                    item.player_key,
                    item.positions,
                    item.salary,
                )
                for item in team.trade_block
            ],
        )
        return snapshot_id


def upsert_league_from_team(conn: sqlite3.Connection, team: OttoneuTeamSnapshot, *, fetched_at: str) -> None:
    league_uid = f"{team.platform}:{team.league_id}"
    league_name = team.league_name or f"League {team.league_id}"
    league_url = f"https://ottoneu.fangraphs.com/{team.league_id}/home"
    conn.execute(
        """
        INSERT INTO fantasy_leagues (league_uid, platform, league_id, league_name, url, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(league_uid) DO UPDATE SET
            league_name=excluded.league_name,
            url=excluded.url,
            updated_at=excluded.updated_at
        """,
        (league_uid, team.platform, team.league_id, league_name, league_url, fetched_at, fetched_at),
    )
    conn.execute(
        """
        INSERT INTO league_team_memberships (
            league_uid, team_uid, team_name, team_url, standings_rank, points, change, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(league_uid, team_uid) DO UPDATE SET
            team_name=excluded.team_name,
            team_url=excluded.team_url,
            updated_at=excluded.updated_at
        """,
        (league_uid, team.team_uid, team.team_name, team.url, None, team.points, None, fetched_at),
    )


def save_league_snapshot(league: OttoneuLeagueSnapshot, *, fetched_at: str) -> None:
    with get_connection() as conn:
        conn.execute(
            """
            INSERT INTO fantasy_leagues (league_uid, platform, league_id, league_name, url, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(league_uid) DO UPDATE SET
                platform=excluded.platform,
                league_id=excluded.league_id,
                league_name=excluded.league_name,
                url=excluded.url,
                updated_at=excluded.updated_at
            """,
            (
                league.league_uid,
                league.platform,
                league.league_id,
                league.league_name,
                league.url,
                fetched_at,
                fetched_at,
            ),
        )
        conn.executemany(
            """
            INSERT INTO fantasy_teams (
                team_uid, platform, league_id, team_id, league_name, team_name, owner, url, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
            ON CONFLICT(team_uid) DO UPDATE SET
                platform=excluded.platform,
                league_id=excluded.league_id,
                team_id=excluded.team_id,
                league_name=excluded.league_name,
                team_name=excluded.team_name,
                url=excluded.url,
                updated_at=excluded.updated_at
            """,
            [
                (
                    team.team_uid,
                    league.platform,
                    league.league_id,
                    team.team_id,
                    league.league_name,
                    team.team_name,
                    team.url,
                    fetched_at,
                    fetched_at,
                )
                for team in league.teams
            ],
        )
        conn.executemany(
            """
            INSERT INTO league_team_memberships (
                league_uid, team_uid, team_name, team_url, standings_rank, points, change, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(league_uid, team_uid) DO UPDATE SET
                team_name=excluded.team_name,
                team_url=excluded.team_url,
                standings_rank=excluded.standings_rank,
                points=excluded.points,
                change=excluded.change,
                updated_at=excluded.updated_at
            """,
            [
                (
                    league.league_uid,
                    team.team_uid,
                    team.team_name,
                    team.url,
                    team.standings_rank,
                    team.points,
                    team.change,
                    fetched_at,
                )
                for team in league.teams
            ],
        )


def list_teams_with_status() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                t.*,
                latest.id AS last_snapshot_id,
                latest.fetched_at AS last_fetched_at,
                latest.status AS last_status,
                latest.roster_count AS last_roster_count,
                latest.roster_limit AS last_roster_limit,
                latest.cap_used AS last_cap_used,
                latest.cap_limit AS last_cap_limit,
                latest.points AS last_points,
                latest.message AS last_message,
                membership.standings_rank,
                membership.points AS standings_points,
                membership.change AS standings_change
            FROM fantasy_teams t
            LEFT JOIN league_team_memberships membership ON membership.team_uid = t.team_uid
            LEFT JOIN (
                SELECT team_snapshots.*
                FROM team_snapshots
                INNER JOIN (
                    SELECT team_uid, MAX(id) AS max_id
                    FROM team_snapshots
                    GROUP BY team_uid
                ) latest_ids ON latest_ids.max_id = team_snapshots.id
            ) latest ON latest.team_uid = t.team_uid
            ORDER BY t.league_name, t.team_name
            """
        ).fetchall()
    return [dict(row) for row in rows]


def delete_team(team_uid: str) -> bool:
    with get_connection() as conn:
        team = conn.execute("SELECT team_uid FROM fantasy_teams WHERE team_uid = ?", (team_uid,)).fetchone()
        if not team:
            return False
        conn.execute("DELETE FROM team_roster_entries WHERE team_uid = ?", (team_uid,))
        conn.execute("DELETE FROM team_cap_penalties WHERE team_uid = ?", (team_uid,))
        conn.execute("DELETE FROM team_loans WHERE team_uid = ?", (team_uid,))
        conn.execute("DELETE FROM team_trade_block WHERE team_uid = ?", (team_uid,))
        conn.execute("DELETE FROM team_snapshots WHERE team_uid = ?", (team_uid,))
        conn.execute("DELETE FROM league_team_memberships WHERE team_uid = ?", (team_uid,))
        conn.execute("DELETE FROM fantasy_teams WHERE team_uid = ?", (team_uid,))
        return True


def list_leagues_with_status() -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                l.*,
                COUNT(DISTINCT m.team_uid) AS team_count,
                COUNT(DISTINCT latest_snapshots.id) AS loaded_team_count,
                COALESCE(SUM(latest_snapshots.roster_count), 0) AS rostered_player_count
            FROM fantasy_leagues l
            LEFT JOIN league_team_memberships m ON m.league_uid = l.league_uid
            LEFT JOIN (
                SELECT team_snapshots.*
                FROM team_snapshots
                INNER JOIN (
                    SELECT team_uid, MAX(id) AS max_id
                    FROM team_snapshots
                    WHERE status = 'success'
                    GROUP BY team_uid
                ) latest_ids ON latest_ids.max_id = team_snapshots.id
            ) latest_snapshots ON latest_snapshots.team_uid = m.team_uid
            GROUP BY l.league_uid
            ORDER BY l.league_name
            """
        ).fetchall()
    return [dict(row) for row in rows]


def get_league(league_uid: str) -> dict | None:
    with get_connection() as conn:
        league = conn.execute("SELECT * FROM fantasy_leagues WHERE league_uid = ?", (league_uid,)).fetchone()
    return dict(league) if league else None


def delete_league(league_uid: str) -> bool:
    with get_connection() as conn:
        league = conn.execute("SELECT league_uid FROM fantasy_leagues WHERE league_uid = ?", (league_uid,)).fetchone()
        if not league:
            return False
        conn.execute("DELETE FROM league_team_memberships WHERE league_uid = ?", (league_uid,))
        conn.execute("DELETE FROM fantasy_leagues WHERE league_uid = ?", (league_uid,))
        return True


def get_league_memberships(league_uid: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                m.*,
                t.owner,
                latest_snapshots.id AS last_snapshot_id,
                latest_snapshots.fetched_at AS last_fetched_at,
                latest_snapshots.roster_count AS last_roster_count,
                latest_snapshots.cap_used AS last_cap_used,
                latest_snapshots.cap_limit AS last_cap_limit
            FROM league_team_memberships m
            JOIN fantasy_teams t ON t.team_uid = m.team_uid
            LEFT JOIN (
                SELECT team_snapshots.*
                FROM team_snapshots
                INNER JOIN (
                    SELECT team_uid, MAX(id) AS max_id
                    FROM team_snapshots
                    WHERE status = 'success'
                    GROUP BY team_uid
                ) latest_ids ON latest_ids.max_id = team_snapshots.id
            ) latest_snapshots ON latest_snapshots.team_uid = m.team_uid
            WHERE m.league_uid = ?
            ORDER BY COALESCE(m.standings_rank, 999), m.team_name
            """,
            (league_uid,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_league_roster_map(league_uid: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                r.player_key,
                r.player_name,
                r.salary,
                r.positions,
                r.status,
                r.mlb_team,
                r.section,
                r.games,
                r.innings_pitched,
                r.points_per_game,
                r.points_per_ip,
                r.points,
                m.league_uid,
                m.team_uid,
                m.team_name,
                m.standings_rank
            FROM league_team_memberships m
            JOIN (
                SELECT team_snapshots.*
                FROM team_snapshots
                INNER JOIN (
                    SELECT team_uid, MAX(id) AS max_id
                    FROM team_snapshots
                    WHERE status = 'success'
                    GROUP BY team_uid
                ) latest_ids ON latest_ids.max_id = team_snapshots.id
            ) latest_snapshots ON latest_snapshots.team_uid = m.team_uid
            JOIN team_roster_entries r ON r.snapshot_id = latest_snapshots.id
            WHERE m.league_uid = ?
            ORDER BY m.team_name, r.player_name
            """,
            (league_uid,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_league_trade_block(league_uid: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            SELECT
                tb.side,
                tb.player_key,
                tb.player_name,
                COALESCE(tb.salary, r.salary, 0) AS salary,
                COALESCE(tb.positions, r.positions) AS positions,
                r.status,
                r.mlb_team,
                COALESCE(r.section, 'hitter') AS section,
                r.games,
                r.innings_pitched,
                r.points_per_game,
                r.points_per_ip,
                r.points,
                m.league_uid,
                m.team_uid,
                m.team_name,
                m.standings_rank
            FROM league_team_memberships m
            JOIN (
                SELECT team_snapshots.*
                FROM team_snapshots
                INNER JOIN (
                    SELECT team_uid, MAX(id) AS max_id
                    FROM team_snapshots
                    WHERE status = 'success'
                    GROUP BY team_uid
                ) latest_ids ON latest_ids.max_id = team_snapshots.id
            ) latest_snapshots ON latest_snapshots.team_uid = m.team_uid
            JOIN team_trade_block tb ON tb.snapshot_id = latest_snapshots.id
            LEFT JOIN team_roster_entries r ON r.snapshot_id = latest_snapshots.id AND r.player_key = tb.player_key
            WHERE m.league_uid = ?
            ORDER BY tb.side, m.team_name, tb.player_name
            """,
            (league_uid,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_league_available_player_stats(league_uid: str) -> list[dict]:
    with get_connection() as conn:
        rows = conn.execute(
            """
            WITH league_teams AS (
                SELECT team_uid
                FROM league_team_memberships
                WHERE league_uid = ?
            ),
            latest_snapshots AS (
                SELECT team_snapshots.*
                FROM team_snapshots
                INNER JOIN (
                    SELECT team_uid, MAX(id) AS max_id
                    FROM team_snapshots
                    WHERE status = 'success'
                    GROUP BY team_uid
                ) latest_ids ON latest_ids.max_id = team_snapshots.id
                WHERE team_snapshots.team_uid IN (SELECT team_uid FROM league_teams)
            ),
            current_roster AS (
                SELECT DISTINCT r.player_key
                FROM latest_snapshots s
                JOIN team_roster_entries r ON r.snapshot_id = s.id
            ),
            historical_rows AS (
                SELECT
                    r.*,
                    ROW_NUMBER() OVER (
                        PARTITION BY r.player_key
                        ORDER BY s.fetched_at DESC, r.snapshot_id DESC, r.id DESC
                    ) AS row_number
                FROM team_snapshots s
                JOIN team_roster_entries r ON r.snapshot_id = s.id
                WHERE s.status = 'success'
                    AND s.team_uid IN (SELECT team_uid FROM league_teams)
                    AND r.player_key NOT IN (SELECT player_key FROM current_roster)
            )
            SELECT
                player_key,
                player_name,
                positions,
                status,
                mlb_team,
                section,
                games,
                innings_pitched,
                points_per_game,
                points_per_ip,
                points
            FROM historical_rows
            WHERE row_number = 1
            ORDER BY player_name
            """,
            (league_uid,),
        ).fetchall()
    return [dict(row) for row in rows]


def get_team_detail(team_uid: str) -> dict | None:
    with get_connection() as conn:
        team = conn.execute("SELECT * FROM fantasy_teams WHERE team_uid = ?", (team_uid,)).fetchone()
        if not team:
            return None
        snapshot = conn.execute(
            """
            SELECT *
            FROM team_snapshots
            WHERE team_uid = ? AND status = 'success'
            ORDER BY id DESC
            LIMIT 1
            """,
            (team_uid,),
        ).fetchone()
        if not snapshot:
            return {"team": dict(team), "snapshot": None, "roster": [], "penalties": [], "loans": [], "trade_block": []}
        snapshot_id = int(snapshot["id"])
        roster = conn.execute(
            """
            SELECT *
            FROM team_roster_entries
            WHERE snapshot_id = ?
            ORDER BY
                CASE section WHEN 'hitter' THEN 0 ELSE 1 END,
                salary DESC,
                player_name
            """,
            (snapshot_id,),
        ).fetchall()
        penalties = conn.execute(
            """
            SELECT *
            FROM team_cap_penalties
            WHERE snapshot_id = ?
            ORDER BY penalty DESC, cut_date, player_name
            """,
            (snapshot_id,),
        ).fetchall()
        loans = conn.execute(
            """
            SELECT *
            FROM team_loans
            WHERE snapshot_id = ?
            ORDER BY direction, amount DESC, counterparty
            """,
            (snapshot_id,),
        ).fetchall()
        trade_block = conn.execute(
            """
            SELECT *
            FROM team_trade_block
            WHERE snapshot_id = ?
            ORDER BY CASE side WHEN 'have' THEN 0 ELSE 1 END, salary DESC, player_name
            """,
            (snapshot_id,),
        ).fetchall()
    return {
        "team": dict(team),
        "snapshot": dict(snapshot),
        "roster": [dict(row) for row in roster],
        "penalties": [dict(row) for row in penalties],
        "loans": [dict(row) for row in loans],
        "trade_block": [dict(row) for row in trade_block],
    }
