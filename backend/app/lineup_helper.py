from __future__ import annotations

import csv
import io
import json
import math
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
FANGRAPHS_TEAM_OFFENSE_URL = "https://www.fangraphs.com/api/leaders/major-league/data"
FANGRAPHS_TEAM_OFFENSE_PAGE_URL = (
    "https://www.fangraphs.com/leaders/major-league?team=0%2Cts&type=1&sortcol=19&sortdir=default&pagenum=1"
)
FANGRAPHS_PITCHING_PAGE_URL = "https://www.fangraphs.com/leaders/major-league?pos=all&stats=pit&type=1"
REQUEST_TIMEOUT_SECONDS = 30
USER_AGENT = "FantasyBaseballAssistantGM/0.1 (+local personal use)"
FANGRAPHS_HEADERS = {
    "User-Agent": "okhttp/4.12.0",
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
XFIP_FULL_CONFIDENCE_BATTERS_FACED = 110.0
ESTIMATED_BATTERS_PER_INNING = 4.3


def fetch_fangraphs_xfip_for_probables(target_date: str) -> dict:
    season = parse_iso_date(target_date).year
    probable_data = fetch_probable_matchups(target_date)
    probable_pitchers = {
        pitcher["pitcher_key"]: pitcher
        for team_matchups in probable_data["matchups"].values()
        for matchup in matchup_rows(team_matchups)
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
            executor.submit(fetch_fangraphs_pitcher_xfip_reference, pitcher["fangraphs_id"], season, pitcher["fangraphs_url"]): pitcher
            for pitcher in matched_pitchers
        }
        for future in as_completed(futures):
            pitcher = futures[future]
            try:
                reference = future.result()
            except Exception as exc:
                errors.append(f"{pitcher['pitcher_name']}: {exc}")
                continue
            if reference is None:
                errors.append(f"{pitcher['pitcher_name']}: no {season} MLB xFIP- row found.")
                continue
            entries.append(
                {
                    "pitcher_name": pitcher["pitcher_name"],
                    "season": season,
                    **reference,
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


def fetch_fangraphs_pitcher_xfip_reference(player_id: int | str, season: int, referer_url: str) -> dict | None:
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
    row = fangraphs_season_mlb_row(response.json(), season)
    if not row:
        return None
    xfip_minus = parse_optional_number(row.get("xFIP-"))
    if xfip_minus is None:
        return None
    return {
        "xfip_minus": xfip_minus,
        "innings_pitched": parse_baseball_innings(row.get("IP")),
        "batters_faced": parse_optional_number(row.get("TBF") if row.get("TBF") is not None else row.get("BF")),
    }


def fetch_fangraphs_pitcher_xfip_minus(player_id: int | str, season: int, referer_url: str) -> float | None:
    reference = fetch_fangraphs_pitcher_xfip_reference(player_id, season, referer_url)
    return reference.get("xfip_minus") if reference else None


def fetch_fangraphs_hitter_wrc_plus(player_id: int | str, season: int, referer_url: str) -> float | None:
    headers = {
        **FANGRAPHS_HEADERS,
        "Accept": "application/json,text/plain,*/*",
        "Referer": referer_url,
    }
    response = requests.get(
        FANGRAPHS_PLAYER_STATS_URL,
        params={"playerid": player_id, "position": "H", "season": season},
        headers=headers,
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    assert_not_cloudflare_challenge(response.text)
    return fangraphs_season_mlb_metric(response.json(), season, "wRC+")


def fetch_fangraphs_team_offense_ranks(season: int) -> dict[str, dict]:
    response = requests.get(
        FANGRAPHS_TEAM_OFFENSE_URL,
        params={
            "age": "",
            "pos": "all",
            "stats": "bat",
            "lg": "all",
            "qual": "0",
            "type": "1",
            "season": season,
            "season1": season,
            "ind": "0",
            "team": "0,ts",
            "rost": "0",
            "filter": "",
            "players": "0",
            "month": "0",
            "sortcol": "19",
            "sortdir": "default",
            "startdate": "",
            "enddate": "",
            "pageitems": "30",
            "pagenum": "1",
        },
        headers={
            **FANGRAPHS_HEADERS,
            "Accept": "application/json,text/plain,*/*",
            "Referer": FANGRAPHS_TEAM_OFFENSE_PAGE_URL,
        },
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    assert_not_cloudflare_challenge(response.text)
    try:
        payload = response.json()
    except ValueError as exc:
        raise ScrapeError("FanGraphs team offense payload could not be parsed.") from exc
    rankings = build_fangraphs_team_offense_ranks(payload, season)
    if not rankings:
        raise ScrapeError(f"FanGraphs did not return {season} team offense rows.")
    return rankings


def fetch_fangraphs_pitcher_xfip_leaderboard(season: int) -> dict[str, dict]:
    response = requests.get(
        FANGRAPHS_TEAM_OFFENSE_URL,
        params={
            "age": "",
            "pos": "all",
            "stats": "pit",
            "lg": "all",
            "qual": "0",
            "type": "1",
            "season": season,
            "season1": season,
            "ind": "0",
            "team": "0",
            "rost": "0",
            "filter": "",
            "players": "0",
            "month": "0",
            "sortcol": "19",
            "sortdir": "default",
            "startdate": "",
            "enddate": "",
            "pageitems": "2000",
            "pagenum": "1",
        },
        headers={
            **FANGRAPHS_HEADERS,
            "Accept": "application/json,text/plain,*/*",
            "Referer": FANGRAPHS_PITCHING_PAGE_URL,
        },
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    assert_not_cloudflare_challenge(response.text)
    try:
        payload = response.json()
    except ValueError as exc:
        raise ScrapeError("FanGraphs pitching leaderboard payload could not be parsed.") from exc
    stats = build_fangraphs_pitcher_xfip_leaderboard(payload, season)
    if not stats:
        raise ScrapeError(f"FanGraphs did not return {season} pitcher xFIP- rows.")
    return stats


def build_fangraphs_pitcher_xfip_leaderboard(payload: dict, season: int) -> dict[str, dict]:
    stats: dict[str, dict] = {}
    for row in payload.get("data", []):
        if row.get("Season") is not None and str(row.get("Season")) != str(season):
            continue
        pitcher_name = clean_player_name(str(row.get("PlayerName") or ""))
        xfip_minus = parse_float(row.get("xFIP-"))
        if not pitcher_name or xfip_minus is None or not math.isfinite(xfip_minus):
            continue
        pitcher_key = normalize_player_key(pitcher_name)
        stats[pitcher_key] = {
            "pitcher_key": pitcher_key,
            "pitcher_name": pitcher_name,
            "fangraphs_id": str(row.get("playerid") or "").strip() or None,
            "season": season,
            "xfip_minus": round(float(xfip_minus), 4),
            "innings_pitched": parse_baseball_innings(row.get("IP")),
            "batters_faced": parse_optional_number(row.get("TBF") if row.get("TBF") is not None else row.get("BF")),
            "source": "FanGraphs pitching leaderboard",
        }
    return stats


def build_fangraphs_team_offense_ranks(payload: dict, season: int) -> dict[str, dict]:
    metrics = ("wRC", "wRAA", "wOBA", "wRC+")
    values_by_team: dict[str, dict[str, float]] = {}
    for row in payload.get("data", []):
        if row.get("Season") is not None and str(row.get("Season")) != str(season):
            continue
        team_code = fangraphs_team_code(row.get("Team"))
        if not team_code:
            continue
        values: dict[str, float] = {}
        for metric in metrics:
            value = row.get(metric)
            parsed = float(value) if isinstance(value, (int, float)) else parse_float(value)
            if parsed is not None and math.isfinite(parsed):
                values[metric] = parsed
        if values:
            values_by_team[team_code] = values

    metric_ranks: dict[str, dict[str, int]] = {}
    for metric in metrics:
        ordered = sorted(
            (
                (team_code, values[metric])
                for team_code, values in values_by_team.items()
                if metric in values
            ),
            key=lambda item: (-item[1], item[0]),
        )
        ranks: dict[str, int] = {}
        previous_value: float | None = None
        previous_rank = 0
        for index, (team_code, value) in enumerate(ordered, start=1):
            rank = previous_rank if previous_value is not None and value == previous_value else index
            ranks[team_code] = rank
            previous_value = value
            previous_rank = rank
        metric_ranks[metric] = ranks

    rows: dict[str, dict] = {}
    team_count = len(values_by_team)
    for team_code, values in values_by_team.items():
        ranks = [metric_ranks[metric].get(team_code) for metric in metrics]
        available_ranks = [rank for rank in ranks if rank is not None]
        average_rank = sum(available_ranks) / len(available_ranks) if available_ranks else None
        rows[team_code] = {
            "team_code": team_code,
            "season": season,
            "team_count": team_count,
            "aggregate_rank": None,
            "average_rank": average_rank,
            "wrc_rank": metric_ranks["wRC"].get(team_code),
            "wraa_rank": metric_ranks["wRAA"].get(team_code),
            "woba_rank": metric_ranks["wOBA"].get(team_code),
            "wrc_plus_rank": metric_ranks["wRC+"].get(team_code),
            "wrc": values.get("wRC"),
            "wraa": values.get("wRAA"),
            "woba": values.get("wOBA"),
            "wrc_plus": values.get("wRC+"),
        }

    ordered_aggregate = sorted(
        (row for row in rows.values() if row["average_rank"] is not None),
        key=lambda row: (row["average_rank"], row["team_code"]),
    )
    previous_average: float | None = None
    previous_rank = 0
    for index, row in enumerate(ordered_aggregate, start=1):
        average_rank = row["average_rank"]
        rank = previous_rank if previous_average is not None and average_rank == previous_average else index
        row["aggregate_rank"] = rank
        previous_average = average_rank
        previous_rank = rank
    return rows


def fangraphs_team_code(value: object) -> str | None:
    if value is None:
        return None
    text = BeautifulSoup(str(value), "lxml").get_text(" ", strip=True)
    return normalize_mlb_team_code(text)


def fangraphs_season_mlb_row(payload: dict, season: int) -> dict | None:
    for row in payload.get("data", []):
        if (
            str(row.get("aseason")) == str(season)
            and str(row.get("type")) in {"0", "0.0"}
            and row.get("AbbLevel") == "MLB"
        ):
            return row
    return None


def fangraphs_season_mlb_metric(payload: dict, season: int, field: str) -> float | None:
    row = fangraphs_season_mlb_row(payload, season)
    return parse_optional_number(row.get(field)) if row else None


def parse_optional_number(value: object) -> float | None:
    parsed = float(value) if isinstance(value, (int, float)) else parse_float(value)
    return parsed if parsed is not None and math.isfinite(parsed) else None


def parse_baseball_innings(value: object) -> float | None:
    """Convert baseball IP notation (12.1 == 12 1/3) to decimal innings."""
    parsed = parse_optional_number(value)
    if parsed is None:
        return None
    whole = math.floor(parsed)
    digit = int(round((parsed - whole) * 10))
    if digit in (1, 2) and abs(parsed - (whole + digit / 10)) < 0.001:
        return round(whole + digit / 3, 4)
    return parsed


def xfip_sample_details(pitcher_stat: dict | None) -> tuple[float | None, float | None, str]:
    if not pitcher_stat:
        return None, None, "missing"
    batters_faced = parse_optional_number(pitcher_stat.get("batters_faced"))
    innings_pitched = parse_optional_number(pitcher_stat.get("innings_pitched"))
    sample_batters = batters_faced
    if sample_batters is None and innings_pitched is not None:
        sample_batters = innings_pitched * ESTIMATED_BATTERS_PER_INNING
    if sample_batters is None:
        return None, None, "missing"
    weight = max(0.0, min(1.0, sample_batters / XFIP_FULL_CONFIDENCE_BATTERS_FACED))
    confidence = "high" if weight >= 1 else "medium" if weight >= 0.5 else "low"
    return round(weight, 4), round(sample_batters, 1), confidence


def confidence_adjusted_xfip_minus(xfip_minus: object, pitcher_stat: dict | None) -> float | None:
    raw_xfip = parse_optional_number(xfip_minus)
    if raw_xfip is None:
        return None
    weight, _, _ = xfip_sample_details(pitcher_stat)
    # Preserve legacy/manual rows until a reference refresh supplies workload.
    if weight is None:
        return raw_xfip
    return round(100.0 + (raw_xfip - 100.0) * weight, 4)


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
    innings_header = find_header(header_map, ("ip", "innings", "innings pitched"))
    batters_faced_header = find_header(header_map, ("tbf", "bf", "batters faced"))
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
                "innings_pitched": parse_baseball_innings(row.get(innings_header)) if innings_header else None,
                "batters_faced": parse_optional_number(row.get(batters_faced_header)) if batters_faced_header else None,
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
        games = playable_schedule_games(item)
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

    matchups: dict[str, list[dict]] = {}
    matchup_counts: dict[tuple[str, str], int] = {}
    for game in games:
        team_code = normalize_mlb_team_code(game.get("abbName"))
        opponent = game.get("opponent") or {}
        opponent_code = normalize_mlb_team_code(opponent.get("abbName"))
        if is_off_team_code(team_code) or is_off_team_code(opponent_code):
            continue
        if not team_code or not opponent_code:
            continue
        count_key = (team_code, opponent_code)
        matchup_counts[count_key] = matchup_counts.get(count_key, 0) + 1
        game_key, game_number = probable_game_identity(
            game,
            target_date=target_date,
            team_code=team_code,
            opponent_code=opponent_code,
            fallback_number=matchup_counts[count_key],
        )
        matchups.setdefault(team_code, []).append({
            "game_key": game_key,
            "game_number": game_number,
            "opponent_team": opponent_code,
            "opponent_name": opponent_code,
            "starting_pitcher": fangraphs_probable_pitcher(game.get("team") or {}),
            "opposing_pitcher": fangraphs_probable_pitcher(opponent),
        })
    for team_matchups in matchups.values():
        team_matchups.sort(key=matchup_game_sort_key)
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
    games = playable_schedule_games(dates[0]) if dates else []
    matchups: dict[str, list[dict]] = {}
    matchup_counts: dict[tuple[str, str], int] = {}
    for game in games:
        away_team = schedule_team(game, "away")
        home_team = schedule_team(game, "home")
        if not away_team or not home_team:
            continue
        away_pitcher = schedule_probable_pitcher(game, "away")
        home_pitcher = schedule_probable_pitcher(game, "home")
        pair_key = tuple(sorted((away_team["team_code"], home_team["team_code"])))
        matchup_counts[pair_key] = matchup_counts.get(pair_key, 0) + 1
        game_key, game_number = probable_game_identity(
            game,
            target_date=target_date,
            team_code=away_team["team_code"],
            opponent_code=home_team["team_code"],
            fallback_number=matchup_counts[pair_key],
        )
        matchups.setdefault(away_team["team_code"], []).append({
            "game_key": game_key,
            "game_number": game_number,
            "opponent_team": home_team["team_code"],
            "opponent_name": home_team["team_name"],
            "starting_pitcher": away_pitcher,
            "opposing_pitcher": home_pitcher,
        })
        matchups.setdefault(home_team["team_code"], []).append({
            "game_key": game_key,
            "game_number": game_number,
            "opponent_team": away_team["team_code"],
            "opponent_name": away_team["team_name"],
            "starting_pitcher": home_pitcher,
            "opposing_pitcher": away_pitcher,
        })
    for team_matchups in matchups.values():
        team_matchups.sort(key=matchup_game_sort_key)
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


def probable_game_identity(
    game: dict,
    *,
    target_date: str,
    team_code: str,
    opponent_code: str,
    fallback_number: int,
) -> tuple[str, int]:
    game_number = fallback_number
    for raw_number in (game.get("dh"), game.get("gameNumber")):
        try:
            parsed_number = int(raw_number)
        except (TypeError, ValueError):
            continue
        if parsed_number > 0:
            game_number = parsed_number
            break

    raw_key = game.get("gamePk") or game.get("gameId")
    if raw_key is not None and str(raw_key).strip():
        return str(raw_key).strip(), game_number
    team_pair = "-".join(sorted((team_code, opponent_code)))
    return f"{target_date}:{team_pair}:{game_number}", game_number


def matchup_game_sort_key(matchup: dict) -> tuple[int, str]:
    try:
        game_number = int(matchup.get("game_number"))
    except (TypeError, ValueError):
        game_number = 999
    if game_number < 1:
        game_number = 999
    return game_number, str(matchup.get("game_key") or "")


def build_lineup_recommendations(
    *,
    roster_players: Iterable[dict],
    pitcher_stats: Iterable[dict],
    always_start_player_keys: set[str],
    always_sit_player_keys: set[str],
    target_date: str,
    team_offense_ranks: dict[str, dict] | None = None,
) -> dict:
    roster_rows = list(roster_players)
    probable_data = fetch_probable_matchups(target_date)
    matchups = probable_data["matchups"]
    offense_ranks = team_offense_ranks or {}
    stats_by_key = {row["pitcher_key"]: row for row in pitcher_stats}
    il_players = []
    minor_league_players = []
    suspended_players = []
    for player in roster_rows:
        if is_il_player(player):
            il_players.append(unavailable_lineup_player(player, availability_code="il"))
        elif is_minor_league_player(player):
            minor_league_players.append(unavailable_lineup_player(player, availability_code="minors"))
        elif is_suspended_player(player):
            suspended_players.append(unavailable_lineup_player(player, availability_code="suspended"))

    pitcher_starts = []
    for player in roster_rows:
        if player.get("section") != "pitcher":
            continue
        if is_il_player(player) or is_minor_league_player(player) or is_suspended_player(player):
            continue
        team_code = roster_mlb_team_code(player.get("mlb_team"))
        team_matchups = matchup_rows(matchups.get(team_code or ""))
        for matchup in team_matchups:
            starting_pitcher = matchup.get("starting_pitcher")
            if not starting_pitcher or starting_pitcher.get("pitcher_key") != player.get("player_key"):
                continue
            pitcher_starts.append(
                {
                    "player_key": player["player_key"],
                    "player_name": player["player_name"],
                    "positions": player.get("positions"),
                    "mlb_team": player.get("mlb_team"),
                    "status": player.get("status"),
                    "section": "pitcher",
                    "salary": player.get("salary"),
                    "points": player.get("points"),
                    "points_per_ip": player.get("points_per_ip"),
                    "game_key": matchup.get("game_key"),
                    "game_number": matchup.get("game_number"),
                    "opponent_team": matchup.get("opponent_team"),
                    "opponent_name": matchup.get("opponent_name"),
                    "opponent_offense_ranks": offense_ranks.get(matchup.get("opponent_team")),
                    "fangraphs_url": starting_pitcher.get("fangraphs_url"),
                }
            )
    pitcher_starts.sort(
        key=lambda row: (
            row["player_name"],
            int(row.get("game_number") or 0),
            str(row.get("game_key") or ""),
        )
    )

    rows = []

    for player in roster_rows:
        if player.get("section") != "hitter":
            continue
        if is_il_player(player) or is_minor_league_player(player) or is_suspended_player(player):
            continue
        team_code = roster_mlb_team_code(player.get("mlb_team"))
        team_matchups = matchup_rows(matchups.get(team_code or ""))
        games = [hitter_game_matchup(matchup, stats_by_key, index) for index, matchup in enumerate(team_matchups, start=1)]
        primary_game = games[0] if games else None
        always_sit = player["player_key"] in always_sit_player_keys
        always_start = player["player_key"] in always_start_player_keys and not always_sit
        recommendation_code, recommendation = lineup_recommendation_for_games(
            always_start=always_start,
            always_sit=always_sit,
            team_code=team_code,
            games=games,
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
                "plays_today": bool(games),
                "games": games,
                "opponent_team": primary_game.get("opponent_team") if primary_game else None,
                "opponent_name": primary_game.get("opponent_name") if primary_game else None,
                "opposing_pitcher_key": primary_game.get("opposing_pitcher_key") if primary_game else None,
                "opposing_pitcher_name": primary_game.get("opposing_pitcher_name") if primary_game else None,
                "opposing_pitcher_xfip_minus": primary_game.get("opposing_pitcher_xfip_minus") if primary_game else None,
                "opposing_pitcher_adjusted_xfip_minus": (
                    primary_game.get("opposing_pitcher_adjusted_xfip_minus") if primary_game else None
                ),
                "opposing_pitcher_innings_pitched": (
                    primary_game.get("opposing_pitcher_innings_pitched") if primary_game else None
                ),
                "opposing_pitcher_batters_faced": (
                    primary_game.get("opposing_pitcher_batters_faced") if primary_game else None
                ),
                "opposing_pitcher_xfip_sample_weight": (
                    primary_game.get("opposing_pitcher_xfip_sample_weight") if primary_game else None
                ),
                "opposing_pitcher_xfip_sample_batters": (
                    primary_game.get("opposing_pitcher_xfip_sample_batters") if primary_game else None
                ),
                "opposing_pitcher_xfip_sample_confidence": (
                    primary_game.get("opposing_pitcher_xfip_sample_confidence") if primary_game else "missing"
                ),
                "opposing_pitcher_xfip_provenance": (
                    primary_game.get("opposing_pitcher_xfip_provenance") if primary_game else "missing"
                ),
                "opposing_pitcher_xfip_confidence": (
                    primary_game.get("opposing_pitcher_xfip_confidence") if primary_game else "missing"
                ),
                "opposing_pitcher_xfip_source": (
                    primary_game.get("opposing_pitcher_xfip_source") if primary_game else None
                ),
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
        "suspended_players": sorted(suspended_players, key=unavailable_sort_key),
        "pitcher_starts": pitcher_starts,
        "rows": rows,
    }


def matchup_rows(value: object) -> list[dict]:
    if isinstance(value, list):
        rows = [row for row in value if isinstance(row, dict)]
    elif isinstance(value, dict):
        rows = [value]
    else:
        rows = []
    return sorted(rows, key=matchup_game_sort_key)


def hitter_game_matchup(matchup: dict, stats_by_key: dict[str, dict], fallback_number: int) -> dict:
    opposing_pitcher = matchup.get("opposing_pitcher")
    pitcher_key = opposing_pitcher.get("pitcher_key") if opposing_pitcher else None
    pitcher_stat = stats_by_key.get(pitcher_key or "")
    xfip_minus = pitcher_stat.get("xfip_minus") if pitcher_stat else None
    xfip_sample_weight, sample_batters, xfip_sample_confidence = xfip_sample_details(pitcher_stat)
    adjusted_xfip_minus = confidence_adjusted_xfip_minus(xfip_minus, pitcher_stat)
    if xfip_minus is None:
        xfip_provenance = "missing"
        xfip_confidence = "missing"
        xfip_source = None
    else:
        xfip_provenance = pitcher_stat.get("reference_provenance") or "saved-reference"
        xfip_confidence = pitcher_stat.get("reference_confidence") or "high"
        xfip_source = pitcher_stat.get("source") or None
    return {
        "game_key": matchup.get("game_key"),
        "game_number": matchup.get("game_number") or fallback_number,
        "opponent_team": matchup.get("opponent_team"),
        "opponent_name": matchup.get("opponent_name"),
        "opposing_pitcher_key": pitcher_key,
        "opposing_pitcher_name": opposing_pitcher.get("pitcher_name") if opposing_pitcher else None,
        "opposing_pitcher_xfip_minus": xfip_minus,
        "opposing_pitcher_adjusted_xfip_minus": adjusted_xfip_minus,
        "opposing_pitcher_innings_pitched": pitcher_stat.get("innings_pitched") if pitcher_stat else None,
        "opposing_pitcher_batters_faced": pitcher_stat.get("batters_faced") if pitcher_stat else None,
        "opposing_pitcher_xfip_sample_weight": xfip_sample_weight,
        "opposing_pitcher_xfip_sample_batters": sample_batters,
        "opposing_pitcher_xfip_sample_confidence": xfip_sample_confidence,
        "opposing_pitcher_xfip_provenance": xfip_provenance,
        "opposing_pitcher_xfip_confidence": xfip_confidence,
        "opposing_pitcher_xfip_source": xfip_source,
    }


def lineup_recommendation_for_games(
    *,
    always_start: bool,
    always_sit: bool,
    team_code: str | None,
    games: list[dict],
) -> tuple[str, str]:
    if not team_code:
        return "no-mlb-team", "No MLB team"
    if not games:
        return "no-game", "No game"
    all_probables_known = all(game.get("opposing_pitcher_name") for game in games)
    xfip_values = [game.get("opposing_pitcher_adjusted_xfip_minus") for game in games]
    all_xfip_known = all(value is not None for value in xfip_values)
    average_xfip = (
        sum(float(value) for value in xfip_values) / len(xfip_values)
        if all_xfip_known
        else None
    )
    return lineup_recommendation(
        always_start=always_start,
        always_sit=always_sit,
        team_code=team_code,
        matchup=games[0],
        opposing_pitcher={"pitcher_name": games[0].get("opposing_pitcher_name")} if all_probables_known else None,
        xfip_minus=average_xfip,
    )


def lineup_recommendation(
    *,
    always_start: bool,
    always_sit: bool,
    team_code: str | None,
    matchup: dict | None,
    opposing_pitcher: dict | None,
    xfip_minus: float | None,
) -> tuple[str, str]:
    if not team_code:
        return "no-mlb-team", "No MLB team"
    if not matchup:
        return "no-game", "No game"
    if always_sit:
        return "always-sit", "Sit"
    if always_start:
        return "always-start", "Always start"
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


def playable_schedule_games(date_row: dict) -> list[dict]:
    games = date_row.get("games", [])
    if not isinstance(games, list):
        return []
    playable_games = []
    for game in games:
        status_row = game.get("status") or {}
        status = " ".join(
            str(status_row.get(field) or "").lower()
            for field in ("abstractGameState", "detailedState", "reason")
        )
        if re.search(r"cancelled|canceled|postponed|suspended", status):
            continue
        playable_games.append(game)
    return playable_games


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
    return re.search(r"(?:^|[^A-Z])(?:IL|DL)(?:$|[^A-Z])", status) is not None


def is_minor_league_player(player: dict) -> bool:
    status = str(player.get("status") or "").upper()
    if "MILB" in status:
        return True
    return minor_league_level(player.get("mlb_team")) is not None


def is_suspended_player(player: dict) -> bool:
    return "SUSP" in str(player.get("status") or "").upper()


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
    if availability_code == "suspended":
        return str(player.get("status") or "SUSP")
    level = minor_league_level(player.get("mlb_team"))
    return level or "MiLB"


def unavailable_sort_key(player: dict) -> tuple[str, str]:
    return (str(player.get("section") or ""), str(player.get("player_name") or ""))


def parse_iso_date(value: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise ScrapeError("Date must use YYYY-MM-DD format.") from exc
