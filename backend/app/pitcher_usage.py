from __future__ import annotations

import csv
import io
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Iterable

import requests

from .lineup_helper import fetch_fangraphs_pitcher_xfip_minus
from .scrapers import ScrapeError

OTTONEU_AVERAGE_VALUES_URL = "https://ottoneu.fangraphs.com/averageValues?export=csv"
FANGRAPHS_GAME_LOG_URL = "https://www.fangraphs.com/api/players/game-log"
REQUEST_TIMEOUT_SECONDS = 30
DATA_USER_AGENT = "okhttp/4.12.0"
DATA_HEADERS = {"User-Agent": DATA_USER_AGENT, "Accept": "application/json,text/csv,*/*"}


def build_pitcher_usage(roster_players: Iterable[dict], *, season: int) -> dict:
    pitchers = [player for player in roster_players if player.get("section") == "pitcher"]
    errors: list[str] = []
    id_map_error: str | None = None
    try:
        id_map = fetch_ottoneu_fangraphs_id_map()
    except Exception as exc:
        id_map = {}
        id_map_error = f"Ottoneu/FanGraphs player-ID mapping failed: {exc}"
        if any(is_dual_eligible(player.get("positions")) for player in pitchers):
            errors.append(id_map_error)

    rows: list[dict] = []
    with ThreadPoolExecutor(max_workers=4) as executor:
        futures = {
            executor.submit(build_pitcher_usage_row, player, id_map, id_map_error, season): player
            for player in pitchers
        }
        for future in as_completed(futures):
            row, usage_error = future.result()
            if usage_error:
                errors.append(usage_error)
            rows.append(row)

    rows.sort(key=lambda row: (row["bucket"], row["player_name"]))
    return {
        "rows": rows,
        "errors": errors,
        "source": "Ottoneu player-ID export + FanGraphs pitching game logs and player-page xFIP-",
    }


def build_pitcher_usage_row(
    player: dict,
    id_map: dict[int, str],
    id_map_error: str | None,
    season: int,
) -> tuple[dict, str | None]:
    ottoneu_id = int(player["ottoneu_player_id"]) if player.get("ottoneu_player_id") is not None else None
    fangraphs_id = id_map.get(ottoneu_id) if ottoneu_id is not None else None
    usage_error = None
    if not is_dual_eligible(player.get("positions")):
        bucket = "RP" if "RP" in position_tokens(player.get("positions")) else "SP"
        row = usage_row(
            player,
            bucket=bucket,
            role=bucket,
            fangraphs_id=fangraphs_id,
            usage_source="eligibility",
        )
    elif not fangraphs_id:
        usage_error = f"No FanGraphs player ID found for {player['player_name']}."
        row = fallback_usage_row(player, error=usage_error)
    else:
        try:
            appearances = fetch_fangraphs_pitcher_appearances(fangraphs_id, season)
            row = classify_pitcher_usage(player, appearances, fangraphs_id=fangraphs_id)
        except Exception as exc:
            usage_error = f"{player['player_name']}: {exc}"
            row = fallback_usage_row(player, fangraphs_id=fangraphs_id, error=str(exc))

    xfip_minus = None
    xfip_error = id_map_error if not fangraphs_id else None
    if not fangraphs_id and not xfip_error:
        xfip_error = f"No FanGraphs player ID found for {player['player_name']}."
    elif fangraphs_id:
        try:
            xfip_minus = fetch_fangraphs_pitcher_xfip_minus(fangraphs_id, season, row["fangraphs_url"])
            if xfip_minus is None:
                xfip_error = f"No {season} MLB xFIP- row found."
        except Exception as exc:
            xfip_error = str(exc)
    return {**row, "xfip_minus": xfip_minus, "xfip_error": xfip_error}, usage_error


def is_dual_eligible(positions: object) -> bool:
    tokens = position_tokens(positions)
    return "SP" in tokens and "RP" in tokens


def classify_pitcher_usage(player: dict, appearance_starts: Iterable[int], *, fangraphs_id: str | int | None = None) -> dict:
    starts = [1 if int(value) > 0 else 0 for value in appearance_starts]
    season_starts = sum(starts)
    season_appearances = len(starts)
    season_relief = season_appearances - season_starts

    if season_appearances == 0:
        return usage_row(
            player,
            bucket="SP",
            role="No season usage",
            season_appearances=0,
            season_starts=0,
            season_relief_appearances=0,
            fangraphs_id=fangraphs_id,
            usage_source="fangraphs-game-log",
        )
    if season_relief == 0:
        bucket = role = "SP"
    elif season_starts == 0:
        bucket = role = "RP"
    else:
        recent = starts[:5]
        recent_starts = sum(recent)
        bucket = "SP" if recent_starts > len(recent) - recent_starts else "RP"
        role = f"Mixed - {bucket}"

    return usage_row(
        player,
        bucket=bucket,
        role=role,
        season_appearances=season_appearances,
        season_starts=season_starts,
        season_relief_appearances=season_relief,
        last_five=["SP" if value else "RP" for value in starts[:5]],
        fangraphs_id=fangraphs_id,
        usage_source="fangraphs-game-log",
    )


def fallback_usage_row(player: dict, *, fangraphs_id: str | int | None = None, error: str) -> dict:
    games = integer_or_none(player.get("games"))
    starts = integer_or_none(player.get("games_started"))
    if games is None or starts is None or games <= 0:
        return usage_row(
            player,
            bucket="SP",
            role="Usage unavailable",
            season_appearances=games,
            season_starts=starts,
            season_relief_appearances=None if games is None or starts is None else max(0, games - starts),
            fangraphs_id=fangraphs_id,
            usage_source="roster-fallback",
            error=error,
        )

    relief = max(0, games - starts)
    if relief == 0:
        bucket = role = "SP"
    elif starts == 0:
        bucket = role = "RP"
    else:
        bucket = "SP" if starts > relief else "RP"
        role = "Usage unavailable"
    return usage_row(
        player,
        bucket=bucket,
        role=role,
        season_appearances=games,
        season_starts=starts,
        season_relief_appearances=relief,
        fangraphs_id=fangraphs_id,
        usage_source="roster-fallback",
        error=error,
    )


def usage_row(
    player: dict,
    *,
    bucket: str,
    role: str,
    season_appearances: int | None = None,
    season_starts: int | None = None,
    season_relief_appearances: int | None = None,
    last_five: list[str] | None = None,
    fangraphs_id: str | int | None = None,
    usage_source: str,
    error: str | None = None,
) -> dict:
    fg_id = str(fangraphs_id) if fangraphs_id is not None else None
    return {
        "player_key": player["player_key"],
        "player_name": player["player_name"],
        "positions": player.get("positions"),
        "bucket": bucket,
        "role": role,
        "season_appearances": season_appearances,
        "season_starts": season_starts,
        "season_relief_appearances": season_relief_appearances,
        "last_five": last_five or [],
        "fangraphs_id": fg_id,
        "fangraphs_url": (
            f"https://www.fangraphs.com/players/{player_slug(player['player_name'])}/{fg_id}/game-log?position=P"
            if fg_id
            else None
        ),
        "usage_source": usage_source,
        "error": error,
    }


def fetch_ottoneu_fangraphs_id_map() -> dict[int, str]:
    response = requests.get(OTTONEU_AVERAGE_VALUES_URL, headers=DATA_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    reader = csv.DictReader(io.StringIO(response.text.lstrip("\ufeff")))
    if not reader.fieldnames or "OttoneuID" not in reader.fieldnames or "FG MajorLeagueID" not in reader.fieldnames:
        raise ScrapeError("Ottoneu player-ID export did not contain the expected columns.")
    result: dict[int, str] = {}
    for row in reader:
        ottoneu_id = integer_or_none(row.get("OttoneuID"))
        fangraphs_id = str(row.get("FG MajorLeagueID") or "").strip()
        if ottoneu_id is not None and fangraphs_id:
            result[ottoneu_id] = fangraphs_id
    if not result:
        raise ScrapeError("Ottoneu player-ID export did not contain any FanGraphs IDs.")
    return result


def fetch_fangraphs_pitcher_appearances(player_id: str | int, season: int) -> list[int]:
    response = requests.get(
        FANGRAPHS_GAME_LOG_URL,
        params={"playerid": player_id, "position": "P", "type": 0, "season": season},
        headers=DATA_HEADERS,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    rows = payload.get("mlb", []) if isinstance(payload, dict) else []
    appearances = [
        row
        for row in rows
        if str(row.get("gamedate") or "") != "2050-01-01" and number_or_none(row.get("G")) not in {None, 0}
    ]
    appearances.sort(key=lambda row: (str(row.get("gamedate") or ""), integer_or_none(row.get("dh")) or 0), reverse=True)
    return [1 if (number_or_none(row.get("GS")) or 0) > 0 else 0 for row in appearances]


def position_tokens(value: object) -> set[str]:
    return {token for token in re.split(r"[^A-Z0-9+]+", str(value or "").upper()) if token}


def player_slug(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "player"


def integer_or_none(value: object) -> int | None:
    try:
        return int(float(str(value).strip()))
    except (TypeError, ValueError):
        return None


def number_or_none(value: object) -> float | None:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None
