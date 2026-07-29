from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterable

from .lineup_helper import fetch_fangraphs_hitter_wrc_plus, is_minor_league_player
from .pitcher_usage import fetch_ottoneu_fangraphs_id_map, player_slug


def build_optimal_lineup_hitters(roster_players: Iterable[dict], *, season: int) -> dict:
    hitters = [
        player
        for player in roster_players
        if player.get("section") == "hitter" and not is_minor_league_player(player)
    ]
    errors: list[str] = []
    try:
        id_map = fetch_ottoneu_fangraphs_id_map()
    except Exception as exc:
        id_map = {}
        errors.append(f"Ottoneu/FanGraphs player-ID mapping failed: {exc}")

    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            executor.submit(build_hitter_metric_row, player, id_map, season): player
            for player in hitters
        }
        for future in as_completed(futures):
            row = future.result()
            if row["wrc_error"]:
                errors.append(f"{row['player_name']}: {row['wrc_error']}")
            rows.append(row)

    rows.sort(key=lambda row: row["player_name"])
    return {
        "rows": rows,
        "errors": errors,
        "source": "Ottoneu roster scoring + FanGraphs player-page wRC+",
    }


def build_hitter_metric_row(player: dict, id_map: dict[int, str], season: int) -> dict:
    ottoneu_id = int(player["ottoneu_player_id"]) if player.get("ottoneu_player_id") is not None else None
    fangraphs_id = id_map.get(ottoneu_id) if ottoneu_id is not None else None
    fangraphs_url = (
        f"https://www.fangraphs.com/players/{player_slug(player['player_name'])}/{fangraphs_id}/stats?position=H"
        if fangraphs_id
        else None
    )
    wrc_plus = None
    wrc_error = None
    if not fangraphs_id:
        wrc_error = f"No FanGraphs player ID found for {player['player_name']}."
    else:
        try:
            wrc_plus = fetch_fangraphs_hitter_wrc_plus(fangraphs_id, season, fangraphs_url)
            if wrc_plus is None:
                wrc_error = f"No {season} MLB wRC+ row found."
        except Exception as exc:
            wrc_error = str(exc)

    return {
        "player_key": player["player_key"],
        "player_name": player["player_name"],
        "positions": player.get("positions"),
        "status": player.get("status"),
        "mlb_team": player.get("mlb_team"),
        "salary": player.get("salary"),
        "games": player.get("games"),
        "plate_appearances": player.get("plate_appearances"),
        "points_per_game": player.get("points_per_game"),
        "points": player.get("points"),
        "fangraphs_id": fangraphs_id,
        "fangraphs_url": fangraphs_url,
        "wrc_plus": wrc_plus,
        "wrc_error": wrc_error,
    }
