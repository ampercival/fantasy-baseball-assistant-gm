from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from .db import save_lineup_data_cache
from .lineup_helper import (
    fetch_fangraphs_pitcher_xfip_leaderboard,
    fetch_fangraphs_probables_grid_games,
    fetch_fangraphs_team_offense_ranks,
)

LINEUP_CACHE_DAYS = 14


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
    season = start.year
    pitcher_stats = fetch_fangraphs_pitcher_xfip_leaderboard(season)
    team_offense_ranks = fetch_fangraphs_team_offense_ranks(season)
    generated_at = datetime.now(timezone.utc).isoformat()
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
            f"Cached {len(games)} FanGraphs probable-team rows, "
            f"{len(pitcher_stats)} pitcher xFIP- rows, and "
            f"{len(team_offense_ranks)} offense rankings from the home worker."
        ),
        "cache": saved,
    }
