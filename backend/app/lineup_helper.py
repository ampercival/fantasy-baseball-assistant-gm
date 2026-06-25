from __future__ import annotations

import csv
import io
import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta
from typing import Iterable

import requests
from bs4 import BeautifulSoup

from .player_keys import clean_player_name, normalize_player_key
from .scrapers import ScrapeError, find_header, normalize_header, parse_float

MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule"
FANGRAPHS_PROBABLES_URL = "https://www.fangraphs.com/roster-resource/probables-grid"
FANGRAPHS_PLAYER_STATS_URL = "https://www.fangraphs.com/api/players/stats"
REQUEST_TIMEOUT_SECONDS = 30
USER_AGENT = "FantasyBaseballAssistantGM/0.1 (+local personal use)"
FANGRAPHS_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}

MLB_TO_OTTONEU_TEAM_CODES = {
    "CWS": "CHW",
    "KC": "KCR",
    "SD": "SDP",
    "SF": "SFG",
    "TB": "TBR",
    "WSH": "WSN",
}

MINOR_LEVEL_TOKENS = {"A", "A+", "AA", "AAA", "CPX", "ROK"}


def fetch_fangraphs_xfip_for_probables(target_date: str) -> dict:
    season = parse_iso_date(target_date).year
    probable_data = fetch_probable_matchups(target_date)
    probable_pitchers = {
        pitcher["pitcher_key"]: pitcher
        for matchup in probable_data["matchups"].values()
        for pitcher in [matchup.get("opposing_pitcher")]
        if pitcher and pitcher.get("pitcher_key")
    }
    if not probable_pitchers:
        return {"entries": [], "errors": [], "probable_count": 0, "matched_count": 0}

    fangraphs_ids = fetch_fangraphs_probable_pitcher_ids()
    enriched_pitchers = [
        {
            **pitcher,
            **fangraphs_ids.get(pitcher["pitcher_key"], {}),
        }
        for pitcher in probable_pitchers.values()
    ]
    matched_pitchers = [
        pitcher
        for pitcher in enriched_pitchers
        if pitcher.get("fangraphs_id") and pitcher.get("fangraphs_url")
    ]
    errors = [
        f"No FanGraphs probable link found for {pitcher['pitcher_name']}."
        for pitcher in enriched_pitchers
        if not pitcher.get("fangraphs_id") or not pitcher.get("fangraphs_url")
    ]

    entries: list[dict] = []
    with ThreadPoolExecutor(max_workers=6) as executor:
        futures = {
            executor.submit(fetch_fangraphs_pitcher_xfip_minus, pitcher["fangraphs_id"], season, pitcher["fangraphs_url"]): pitcher
            for pitcher in matched_pitchers
        }
        for future in as_completed(futures):
            pitcher = futures[future]
            try:
                xfip_minus = future.result()
            except Exception as exc:
                errors.append(f"{pitcher['pitcher_name']}: {exc}")
                continue
            if xfip_minus is None:
                errors.append(f"{pitcher['pitcher_name']}: no {season} MLB xFIP- row found.")
                continue
            entries.append(
                {
                    "pitcher_name": pitcher["pitcher_name"],
                    "season": season,
                    "xfip_minus": xfip_minus,
                    "source": "FanGraphs player page",
                }
            )

    return {
        "entries": entries,
        "errors": errors,
        "probable_count": len(probable_pitchers),
        "matched_count": len(matched_pitchers),
    }


def fetch_fangraphs_probable_pitcher_ids() -> dict[str, dict]:
    pitcher_ids: dict[str, dict] = {}
    for game in fetch_fangraphs_probables_grid_games():
        for container_name in ("team", "opponent"):
            pitcher = fangraphs_probable_pitcher(game.get(container_name) or {})
            if not pitcher or not pitcher.get("fangraphs_id") or not pitcher.get("fangraphs_url"):
                continue
            pitcher_ids[pitcher["pitcher_key"]] = {
                "fangraphs_id": pitcher["fangraphs_id"],
                "fangraphs_url": pitcher["fangraphs_url"],
            }
    if not pitcher_ids:
        raise ScrapeError("No FanGraphs probable pitcher links were found.")
    return pitcher_ids


def fetch_fangraphs_probables_grid_games() -> list[dict]:
    response = requests.get(FANGRAPHS_PROBABLES_URL, headers=FANGRAPHS_HEADERS, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    assert_not_cloudflare_challenge(response.text)

    soup = BeautifulSoup(response.text, "lxml")
    next_data = soup.find("script", id="__NEXT_DATA__")
    if not next_data or not next_data.string:
        raise ScrapeError("FanGraphs probables grid payload was not found.")
    try:
        payload = json.loads(next_data.string)
    except json.JSONDecodeError as exc:
        raise ScrapeError("FanGraphs probables grid payload could not be parsed.") from exc

    queries = payload.get("props", {}).get("pageProps", {}).get("dehydratedState", {}).get("queries", [])
    for query in queries:
        if query.get("queryKey") != ["roster-resource/probables-grid/data"]:
            continue
        games = query.get("state", {}).get("data", {}).get("games", [])
        if isinstance(games, list) and games:
            return games
    raise ScrapeError("FanGraphs probables grid did not contain game data.")


def fetch_fangraphs_pitcher_xfip_minus(player_id: int | str, season: int, referer_url: str) -> float | None:
    headers = {
        **FANGRAPHS_HEADERS,
        "Accept": "application/json,text/plain,*/*",
        "Referer": referer_url,
    }
    response = requests.get(
        FANGRAPHS_PLAYER_STATS_URL,
        params={"playerid": player_id, "position": "P", "season": season},
        headers=headers,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    assert_not_cloudflare_challenge(response.text)
    payload = response.json()
    for row in payload.get("data", []):
        if row.get("aseason") == season and row.get("type") == 0 and row.get("AbbLevel") == "MLB":
            value = row.get("xFIP-")
            return float(value) if isinstance(value, (int, float)) else parse_float(value)
    return None


def clean_probable_pitcher_link_text(value: str) -> str:
    text = clean_player_name(value)
    text = re.sub(r"^(?:OP|PP):\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s+\([LR]\)$", "", text, flags=re.IGNORECASE)
    return clean_player_name(text)


def assert_not_cloudflare_challenge(text: str) -> None:
    if "Just a moment" in text or "__cf_chl" in text:
        raise ScrapeError("FanGraphs returned a Cloudflare challenge.")


def parse_pitcher_xfip_csv(csv_text: str, *, season: int, source: str = "FanGraphs CSV") -> list[dict]:
    reader = csv.DictReader(io.StringIO(csv_text.strip()))
    if not reader.fieldnames:
        raise ScrapeError("Pitcher xFIP- CSV needs a header row.")

    header_map = {normalize_header(header): header for header in reader.fieldnames}
    pitcher_header = find_header(header_map, ("name", "player", "player name", "pitcher", "pitcher name"))
    xfip_header = find_header(header_map, ("xfip", "xfip minus", "xfip minus value", "xfip index", "xfip index value"))
    if not pitcher_header or not xfip_header:
        raise ScrapeError("Pitcher xFIP- CSV needs Name and xFIP- columns.")

    entries: list[dict] = []
    seen: set[str] = set()
    for row in reader:
        pitcher_name = clean_player_name(row.get(pitcher_header, ""))
        xfip_minus = parse_float(str(row.get(xfip_header, "")).replace("%", ""))
        if not pitcher_name or xfip_minus is None:
            continue
        pitcher_key = normalize_player_key(pitcher_name)
        if pitcher_key in seen:
            continue
        seen.add(pitcher_key)
        entries.append(
            {
                "pitcher_name": pitcher_name,
                "season": season,
                "xfip_minus": xfip_minus,
                "source": source,
            }
        )

    if not entries:
        raise ScrapeError("Pitcher xFIP- CSV did not contain any valid rows.")
    return entries


def fetch_probable_date_options(start_date: str | None = None, *, days: int = 10) -> list[dict]:
    try:
        return fetch_fangraphs_probable_date_options(start_date, days=days)
    except ScrapeError:
        return fetch_mlb_probable_date_options(start_date, days=days)


def fetch_fangraphs_probable_date_options(start_date: str | None = None, *, days: int = 10) -> list[dict]:
    start = parse_iso_date(start_date) if start_date else date.today()
    end = start + timedelta(days=max(1, min(days, 31)) - 1)
    games = fetch_fangraphs_probables_grid_games()
    dates: dict[str, list[dict]] = {}
    for game in games:
        game_date = game.get("gameDate")
        if not game_date:
            continue
        parsed_date = parse_iso_date(game_date)
        if not (start <= parsed_date <= end):
            continue
        dates.setdefault(game_date, []).append(game)

    options = []
    for game_date in sorted(dates):
        date_games = dates[game_date]
        options.append(
            {
                "date": game_date,
                "game_count": max(1, round(len(date_games) / 2)),
                "probable_starter_count": sum(1 for game in date_games if fangraphs_probable_pitcher(game.get("team") or {})),
                "source": "FanGraphs probables grid",
            }
        )
    return options


def fetch_mlb_probable_date_options(start_date: str | None = None, *, days: int = 10) -> list[dict]:
    start = parse_iso_date(start_date) if start_date else date.today()
    end = start + timedelta(days=max(1, min(days, 31)) - 1)
    payload = fetch_mlb_schedule(start, end)
    options = []
    for item in payload.get("dates", []):
        games = item.get("games", [])
        options.append(
            {
                "date": item.get("date"),
                "game_count": len(games),
                "probable_starter_count": count_probable_starters(games),
                "source": "MLB Stats API schedule",
            }
        )
    return [option for option in options if option["date"]]


def fetch_probable_matchups(target_date: str) -> dict:
    try:
        return fetch_fangraphs_probable_matchups(target_date)
    except ScrapeError:
        return fetch_mlb_probable_matchups(target_date)


def fetch_fangraphs_probable_matchups(target_date: str) -> dict:
    parse_iso_date(target_date)
    games = [game for game in fetch_fangraphs_probables_grid_games() if game.get("gameDate") == target_date]
    if not games:
        raise ScrapeError(f"No FanGraphs probable starter rows found for {target_date}.")

    matchups: dict[str, dict] = {}
    for game in games:
        team_code = normalize_mlb_team_code(game.get("abbName"))
        opponent = game.get("opponent") or {}
        opponent_code = normalize_mlb_team_code(opponent.get("abbName"))
        if is_off_team_code(team_code) or is_off_team_code(opponent_code):
            continue
        if not team_code or not opponent_code:
            continue
        matchups[team_code] = {
            "opponent_team": opponent_code,
            "opponent_name": opponent_code,
            "opposing_pitcher": fangraphs_probable_pitcher(opponent),
        }
    return {
        "date": target_date,
        "game_count": max(1, round(len(games) / 2)),
        "probable_starter_count": sum(1 for game in games if fangraphs_probable_pitcher(game.get("team") or {})),
        "matchups": matchups,
    }


def fetch_mlb_probable_matchups(target_date: str) -> dict:
    parsed_date = parse_iso_date(target_date)
    payload = fetch_mlb_schedule(parsed_date, parsed_date)
    dates = payload.get("dates", [])
    games = dates[0].get("games", []) if dates else []
    matchups: dict[str, dict] = {}
    for game in games:
        away_team = schedule_team(game, "away")
        home_team = schedule_team(game, "home")
        if not away_team or not home_team:
            continue
        away_pitcher = schedule_probable_pitcher(game, "away")
        home_pitcher = schedule_probable_pitcher(game, "home")
        matchups[away_team["team_code"]] = {
            "opponent_team": home_team["team_code"],
            "opponent_name": home_team["team_name"],
            "opposing_pitcher": home_pitcher,
        }
        matchups[home_team["team_code"]] = {
            "opponent_team": away_team["team_code"],
            "opponent_name": away_team["team_name"],
            "opposing_pitcher": away_pitcher,
        }
    return {
        "date": target_date,
        "game_count": len(games),
        "probable_starter_count": count_probable_starters(games),
        "matchups": matchups,
    }


def fangraphs_probable_pitcher(container: dict) -> dict | None:
    pitcher = container.get("sp") or container.get("primaryPitcher") or container.get("opener")
    if not pitcher:
        return None
    pitcher_name = clean_player_name(pitcher.get("name") or "")
    if not pitcher_name:
        return None
    player_id = pitcher.get("playerId")
    player_url = pitcher.get("UPURL")
    fangraphs_id = str(player_id).strip() if player_id is not None else None
    if not fangraphs_id:
        fangraphs_id = None
    return {
        "fangraphs_id": fangraphs_id,
        "fangraphs_url": f"https://www.fangraphs.com{player_url}" if player_url and str(player_url).startswith("/") else player_url,
        "pitcher_name": pitcher_name,
        "pitcher_key": normalize_player_key(pitcher_name),
    }


def build_lineup_recommendations(
    *,
    roster_players: Iterable[dict],
    pitcher_stats: Iterable[dict],
    always_start_player_keys: set[str],
    always_sit_player_keys: set[str],
    target_date: str,
) -> dict:
    roster_rows = list(roster_players)
    probable_data = fetch_probable_matchups(target_date)
    matchups = probable_data["matchups"]
    stats_by_key = {row["pitcher_key"]: row for row in pitcher_stats}
    il_players = []
    minor_league_players = []
    for player in roster_rows:
        if is_il_player(player):
            il_players.append(unavailable_lineup_player(player, availability_code="il"))
        elif is_minor_league_player(player):
            minor_league_players.append(unavailable_lineup_player(player, availability_code="minors"))

    rows = []

    for player in roster_rows:
        if player.get("section") != "hitter":
            continue
        if is_il_player(player) or is_minor_league_player(player):
            continue
        team_code = roster_mlb_team_code(player.get("mlb_team"))
        matchup = matchups.get(team_code or "")
        opposing_pitcher = matchup.get("opposing_pitcher") if matchup else None
        pitcher_key = opposing_pitcher.get("pitcher_key") if opposing_pitcher else None
        pitcher_stat = stats_by_key.get(pitcher_key or "")
        xfip_minus = pitcher_stat.get("xfip_minus") if pitcher_stat else None
        always_sit = player["player_key"] in always_sit_player_keys
        always_start = player["player_key"] in always_start_player_keys and not always_sit
        recommendation_code, recommendation = lineup_recommendation(
            always_start=always_start,
            always_sit=always_sit,
            team_code=team_code,
            matchup=matchup,
            opposing_pitcher=opposing_pitcher,
            xfip_minus=xfip_minus,
        )
        rows.append(
            {
                "player_key": player["player_key"],
                "player_name": player["player_name"],
                "positions": player.get("positions"),
                "mlb_team": player.get("mlb_team"),
                "status": player.get("status"),
                "section": player.get("section"),
                "salary": player.get("salary"),
                "points": player.get("points"),
                "points_per_game": player.get("points_per_game"),
                "opponent_team": matchup.get("opponent_team") if matchup else None,
                "opponent_name": matchup.get("opponent_name") if matchup else None,
                "opposing_pitcher_key": pitcher_key,
                "opposing_pitcher_name": opposing_pitcher.get("pitcher_name") if opposing_pitcher else None,
                "opposing_pitcher_xfip_minus": xfip_minus,
                "recommendation": recommendation,
                "recommendation_code": recommendation_code,
                "always_start": always_start,
                "always_sit": always_sit,
            }
        )

    rows.sort(key=lineup_sort_key)
    return {
        **probable_data,
        "pitcher_stats_count": len(stats_by_key),
        "il_players": sorted(il_players, key=unavailable_sort_key),
        "minor_league_players": sorted(minor_league_players, key=unavailable_sort_key),
        "rows": rows,
    }


def lineup_recommendation(
    *,
    always_start: bool,
    always_sit: bool,
    team_code: str | None,
    matchup: dict | None,
    opposing_pitcher: dict | None,
    xfip_minus: float | None,
) -> tuple[str, str]:
    if always_sit:
        return "always-sit", "Sit"
    if always_start:
        return "always-start", "Always start"
    if not team_code:
        return "no-mlb-team", "No MLB team"
    if not matchup:
        return "no-game", "No game"
    if not opposing_pitcher:
        return "no-probable", "No probable"
    if xfip_minus is None:
        return "no-xfip", "No xFIP-"
    if xfip_minus < 90:
        return "lean-sit", "Lean sit"
    if xfip_minus > 110:
        return "lean-start", "Lean start"
    return "neutral", "Neutral"


def lineup_sort_key(row: dict) -> tuple[int, float, str]:
    order = {
        "always-start": 0,
        "lean-start": 1,
        "neutral": 2,
        "no-xfip": 3,
        "no-probable": 4,
        "lean-sit": 5,
        "always-sit": 6,
        "no-game": 7,
        "no-mlb-team": 8,
    }
    return (
        order.get(row["recommendation_code"], 99),
        -(float(row.get("salary") or 0)),
        row["player_name"],
    )


def fetch_mlb_schedule(start: date, end: date) -> dict:
    response = requests.get(
        MLB_SCHEDULE_URL,
        params={
            "sportId": 1,
            "startDate": start.isoformat(),
            "endDate": end.isoformat(),
            "hydrate": "probablePitcher,team",
        },
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    return response.json()


def schedule_team(game: dict, side: str) -> dict | None:
    team = game.get("teams", {}).get(side, {}).get("team")
    if not team:
        return None
    team_code = normalize_mlb_team_code(team.get("abbreviation") or team.get("fileCode") or team.get("teamCode"))
    if not team_code:
        return None
    return {
        "team_code": team_code,
        "team_name": team.get("name") or team.get("teamName") or team_code,
    }


def schedule_probable_pitcher(game: dict, side: str) -> dict | None:
    pitcher = game.get("teams", {}).get(side, {}).get("probablePitcher")
    if not pitcher:
        return None
    pitcher_name = clean_player_name(pitcher.get("fullName", ""))
    if not pitcher_name:
        return None
    return {
        "mlb_id": pitcher.get("id"),
        "pitcher_name": pitcher_name,
        "pitcher_key": normalize_player_key(pitcher_name),
    }


def count_probable_starters(games: Iterable[dict]) -> int:
    return sum(
        1
        for game in games
        for side in ("away", "home")
        if game.get("teams", {}).get(side, {}).get("probablePitcher")
    )


def normalize_mlb_team_code(value: object) -> str | None:
    if value is None:
        return None
    team_code = str(value).strip().upper()
    if not team_code:
        return None
    return MLB_TO_OTTONEU_TEAM_CODES.get(team_code, team_code)


def is_off_team_code(value: object) -> bool:
    return str(value or "").strip().upper() in {"OFF", "NO GAME", "NONE"}


def roster_mlb_team_code(value: object) -> str | None:
    if value is None:
        return None
    parts = str(value).strip().upper().split()
    if not parts:
        return None
    if len(parts) > 1 and parts[1] in MINOR_LEVEL_TOKENS:
        return None
    return normalize_mlb_team_code(parts[0])


def is_il_player(player: dict) -> bool:
    status = str(player.get("status") or "").upper()
    return "IL" in status or "DL" in status


def is_minor_league_player(player: dict) -> bool:
    status = str(player.get("status") or "").upper()
    if "MILB" in status:
        return True
    return minor_league_level(player.get("mlb_team")) is not None


def minor_league_level(value: object) -> str | None:
    if value is None:
        return None
    parts = str(value).strip().upper().split()
    if len(parts) > 1 and parts[1] in MINOR_LEVEL_TOKENS:
        return parts[1]
    return None


def unavailable_lineup_player(player: dict, *, availability_code: str) -> dict:
    return {
        "player_key": player["player_key"],
        "player_name": player["player_name"],
        "positions": player.get("positions"),
        "mlb_team": player.get("mlb_team"),
        "status": player.get("status"),
        "section": player.get("section"),
        "salary": player.get("salary"),
        "points": player.get("points"),
        "points_per_game": player.get("points_per_game"),
        "points_per_ip": player.get("points_per_ip"),
        "availability_code": availability_code,
        "availability_label": roster_availability_label(player, availability_code),
    }


def roster_availability_label(player: dict, availability_code: str) -> str:
    if availability_code == "il":
        return str(player.get("status") or "IL")
    level = minor_league_level(player.get("mlb_team"))
    return level or "MiLB"


def unavailable_sort_key(player: dict) -> tuple[str, str]:
    return (str(player.get("section") or ""), str(player.get("player_name") or ""))


def parse_iso_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ScrapeError("Date must use YYYY-MM-DD format.") from exc
