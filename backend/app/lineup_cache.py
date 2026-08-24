from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from .db import (
    get_lineup_reference_cache,
    replace_lineup_date_cache,
    save_lineup_data_cache,
    save_lineup_reference_cache,
)
from .lineup_helper import (
    fangraphs_probable_pitcher,
    fetch_fangraphs_pitcher_xfip_leaderboard,
    fetch_fangraphs_probables_grid_games,
    fetch_fangraphs_team_offense_ranks,
)

LINEUP_CACHE_DAYS = 14
LINEUP_REFERENCE_MAX_AGE_HOURS = 20


def _reference_cache_is_fresh(cache: dict | None, season: int, now: datetime) -> bool:
    if not cache or int(cache.get("season") or 0) != season:
        return False
    try:
        fetched_at = datetime.fromisoformat(str(cache["fetched_at"]).replace("Z", "+00:00"))
    except (KeyError, TypeError, ValueError):
        return False
    if fetched_at.tzinfo is None:
        fetched_at = fetched_at.replace(tzinfo=timezone.utc)
    return timedelta(0) <= now - fetched_at <= timedelta(hours=LINEUP_REFERENCE_MAX_AGE_HOURS)


def _reference_cache_has_pitcher_workload(cache: dict | None) -> bool:
    pitcher_stats = cache.get("pitcher_stats") if cache else None
    if not isinstance(pitcher_stats, dict) or not pitcher_stats:
        return False
    return all(
        isinstance(row, dict)
        and (row.get("batters_faced") is not None or row.get("innings_pitched") is not None)
        for row in pitcher_stats.values()
    )


def refresh_lineup_data_cache(*, today: date | None = None, days: int = LINEUP_CACHE_DAYS) -> dict:
    start = today or date.today()
    end = start + timedelta(days=max(1, days) - 1)
    start_iso = start.isoformat()
    end_iso = end.isoformat()
    games = [
        game
        for game in fetch_fangraphs_probables_grid_games()
        if start_iso <= str(game.get("gameDate") or "")[:10] <= end_iso
    ]

    now = datetime.now(timezone.utc)
    generated_at = now.isoformat()
    season = start.year
    reference_cache = get_lineup_reference_cache(season)
    reference_refreshed = (
        not _reference_cache_is_fresh(reference_cache, season, now)
        or not _reference_cache_has_pitcher_workload(reference_cache)
    )
    reference_warning = None
    if reference_refreshed:
        try:
            pitcher_stats = fetch_fangraphs_pitcher_xfip_leaderboard(season)
            team_offense_ranks = fetch_fangraphs_team_offense_ranks(season)
            save_lineup_reference_cache(
                season,
                pitcher_stats,
                team_offense_ranks,
                source="FanGraphs via home worker",
                fetched_at=generated_at,
            )
        except Exception as exc:
            if not reference_cache:
                raise
            pitcher_stats = reference_cache["pitcher_stats"]
            team_offense_ranks = reference_cache["team_offense_ranks"]
            reference_refreshed = False
            reference_warning = f"Reference refresh failed; retained the stored data: {exc}"
    else:
        pitcher_stats = reference_cache["pitcher_stats"]
        team_offense_ranks = reference_cache["team_offense_ranks"]

    games_by_date: dict[str, list[dict]] = {}
    for game in games:
        game_date = str(game.get("gameDate") or "")[:10]
        games_by_date.setdefault(game_date, []).append(game)
    date_rows = [
        {
            "game_date": game_date,
            "game_count": max(1, round(len(date_games) / 2)),
            "probable_starter_count": sum(
                1
                for game in date_games
                if fangraphs_probable_pitcher(game.get("team") or {})
            ),
            "games": date_games,
            "source": "FanGraphs via home worker",
        }
        for game_date, date_games in sorted(games_by_date.items())
    ]
    date_cache = replace_lineup_date_cache(
        date_rows,
        start_date=start_iso,
        end_date=end_iso,
        fetched_at=generated_at,
    )
    saved = save_lineup_data_cache(
        {
            "season": season,
            "start_date": start_iso,
            "end_date": end_iso,
            "games": games,
            "pitcher_stats": pitcher_stats,
            "team_offense_ranks": team_offense_ranks,
            "source": "FanGraphs via home worker",
        },
        generated_at=generated_at,
    )
    return {
        "status": "success",
        "message": (
            f"Cached {len(games)} FanGraphs probable-team rows across {len(date_rows)} dates; "
            f"deleted {date_cache['deleted_past_count']} past dates. "
            f"{'Refreshed' if reference_refreshed else 'Reused'} "
            f"{len(pitcher_stats)} pitcher xFIP- rows and "
            f"{len(team_offense_ranks)} offense rankings."
        ),
        "cache": saved,
        "date_cache": date_cache,
        "reference_cache": {
            "season": season,
            "refreshed": reference_refreshed,
            "pitcher_count": len(pitcher_stats),
            "offense_team_count": len(team_offense_ranks),
            "warning": reference_warning,
        },
    }
