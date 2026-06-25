from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .aggregate import aggregate_to_csv, build_aggregate_board
from .db import (
    delete_player_name_correction,
    delete_league,
    delete_team,
    get_league,
    get_league_available_player_stats,
    get_league_memberships,
    get_league_roster_map,
    get_league_trade_block,
    get_team_detail,
    init_db,
    list_lineup_always_start,
    list_lineup_always_sit,
    list_leagues_with_status,
    list_pitcher_xfip_stats,
    list_player_name_corrections,
    list_sources_with_status,
    list_teams_with_status,
    save_failed_snapshot,
    save_league_snapshot,
    save_snapshot,
    save_team_snapshot,
    set_lineup_always_start,
    set_lineup_always_sit,
    upsert_pitcher_xfip_stats,
    upsert_player_name_correction,
    update_latest_snapshot_source_date,
    update_source_included,
    update_source_tag,
)
from .league_value import build_league_value_curve
from .lineup_helper import (
    build_lineup_recommendations,
    fetch_fangraphs_xfip_for_probables,
    fetch_probable_date_options,
    parse_pitcher_xfip_csv,
)
from .ottoneu import scrape_ottoneu_league, scrape_ottoneu_team
from .scrapers import ScrapeError, parse_csv_import, scrape_source_date, scrape_source_with_metadata
from .sources import SOURCE_BY_ID, SOURCE_TAGS, get_source

app = FastAPI(title="Fantasy Baseball Assistant GM", version="0.1.0")

TDG_OBP_SOURCE_ID = "tdg_2026_obp_top_500"
TDG_POINTS_SOURCE_ID = "tdg_2026_points_top_500"
FANTRAX_ROTO_SOURCE_ID = "fantrax_2026_top_500"
FANTRAX_POINTS_SOURCE_ID = "fantrax_2026_top_500_points"

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CsvImportRequest(BaseModel):
    csv_text: str


class TeamImportRequest(BaseModel):
    url: str


class LeagueImportRequest(BaseModel):
    url: str


class SourceTagRequest(BaseModel):
    source_tag: str


class SourceIncludedRequest(BaseModel):
    included: bool


class PlayerNameCorrectionRequest(BaseModel):
    source_id: str
    original_name: str
    corrected_name: str


class PitcherXfipImportRequest(BaseModel):
    csv_text: str
    season: int | None = None
    source: str = "FanGraphs CSV"


class LineupAlwaysStartRequest(BaseModel):
    league_uid: str
    team_uid: str
    player_key: str
    player_name: str
    always_start: bool


class LineupAlwaysSitRequest(BaseModel):
    league_uid: str
    team_uid: str
    player_key: str
    player_name: str
    always_sit: bool


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict:
    return {"ok": True}


@app.get("/api/sources")
def sources() -> list[dict]:
    return list_sources_with_status()


@app.get("/api/player-name-corrections")
def player_name_corrections(source_id: str = "") -> list[dict]:
    return list_player_name_corrections(source_id.strip() or None)


@app.get("/api/rankings")
def rankings(
    tdg_format: str = "obp",
    fantrax_format: str = "roto",
    included_source_tags: str = "",
    included_sources_only: bool = True,
) -> dict:
    return build_aggregate_board(
        exclude_source_ids=format_exclusions(tdg_format, fantrax_format),
        included_source_tags=parse_included_source_tags(included_source_tags),
        included_sources_only=included_sources_only,
    )


@app.get("/api/rankings/export.csv")
def export_rankings(tdg_format: str = "obp", fantrax_format: str = "roto", included_source_tags: str = "") -> Response:
    board = build_aggregate_board(
        exclude_source_ids=format_exclusions(tdg_format, fantrax_format),
        included_source_tags=parse_included_source_tags(included_source_tags),
    )
    csv_text = aggregate_to_csv(board)
    return Response(
        content=csv_text,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="dynasty-rankings-aggregate.csv"'},
    )


@app.post("/api/sources/{source_id}/tag")
def tag_source(source_id: str, request: SourceTagRequest) -> dict:
    source = require_source(source_id)
    source_tag = request.source_tag.strip()
    if source_tag not in SOURCE_TAGS:
        raise HTTPException(status_code=422, detail=f"source_tag must be one of: {', '.join(SOURCE_TAGS)}.")
    if not update_source_tag(source.id, source_tag):
        raise HTTPException(status_code=404, detail="Unknown source.")
    return {"source_id": source.id, "source_tag": source_tag, "status": "success"}


@app.post("/api/sources/{source_id}/included")
def set_source_included(source_id: str, request: SourceIncludedRequest) -> dict:
    source = require_source(source_id)
    if not update_source_included(source.id, request.included):
        raise HTTPException(status_code=404, detail="Unknown source.")
    return {"source_id": source.id, "included": request.included, "status": "success"}


@app.post("/api/player-name-corrections")
def save_player_name_correction(request: PlayerNameCorrectionRequest) -> dict:
    source = require_source(request.source_id)
    original_name = request.original_name.strip()
    corrected_name = request.corrected_name.strip()
    if not original_name or not corrected_name:
        raise HTTPException(status_code=422, detail="Both original_name and corrected_name are required.")
    correction = upsert_player_name_correction(
        source_id=source.id,
        original_name=original_name,
        corrected_name=corrected_name,
        timestamp=utc_now(),
    )
    return {"status": "success", "correction": correction}


@app.delete("/api/player-name-corrections/{correction_id}")
def remove_player_name_correction(correction_id: int) -> dict:
    if not delete_player_name_correction(correction_id):
        raise HTTPException(status_code=404, detail="Unknown player name correction.")
    return {"status": "success", "correction_id": correction_id}


@app.post("/api/sources/{source_id}/update")
def update_source(source_id: str) -> dict:
    source = require_source(source_id)
    fetched_at = utc_now()
    try:
        scraped = scrape_source_with_metadata(source)
        snapshot_id = save_snapshot(
            source,
            scraped.entries,
            fetched_at=fetched_at,
            message=f"Updated {len(scraped.entries)} rankings.",
            source_date=scraped.source_date,
            source_date_kind=scraped.source_date_kind,
        )
        return {
            "source_id": source.id,
            "snapshot_id": snapshot_id,
            "status": "success",
            "row_count": len(scraped.entries),
            "message": f"Updated {len(scraped.entries)} rankings.",
            "source_date": scraped.source_date,
            "source_date_kind": scraped.source_date_kind,
        }
    except Exception as exc:
        message = str(exc)
        snapshot_id = save_failed_snapshot(source, fetched_at=fetched_at, message=message)
        if isinstance(exc, ScrapeError):
            raise HTTPException(status_code=422, detail={"snapshot_id": snapshot_id, "message": message}) from exc
        raise HTTPException(status_code=502, detail={"snapshot_id": snapshot_id, "message": message}) from exc


@app.post("/api/update-all")
def update_all() -> dict:
    results: list[dict] = []
    for source in SOURCE_BY_ID.values():
        if not source.can_update:
            source_date = None
            snapshot_id = None
            try:
                source_date = scrape_source_date(source)
                if source_date:
                    snapshot_id = update_latest_snapshot_source_date(
                        source,
                        source_date=source_date.value,
                        source_date_kind=source_date.kind,
                    )
            except Exception:
                source_date = None
            results.append(
                {
                    "source_id": source.id,
                    "snapshot_id": snapshot_id,
                    "status": "skipped",
                    "row_count": 0,
                    "message": skipped_source_message(source_date is not None, snapshot_id is not None),
                    "source_date": source_date.value if source_date else None,
                    "source_date_kind": source_date.kind if source_date else None,
                }
            )
            continue
        fetched_at = utc_now()
        try:
            scraped = scrape_source_with_metadata(source)
            snapshot_id = save_snapshot(
                source,
                scraped.entries,
                fetched_at=fetched_at,
                message=f"Updated {len(scraped.entries)} rankings.",
                source_date=scraped.source_date,
                source_date_kind=scraped.source_date_kind,
            )
            results.append(
                {
                    "source_id": source.id,
                    "snapshot_id": snapshot_id,
                    "status": "success",
                    "row_count": len(scraped.entries),
                    "message": f"Updated {len(scraped.entries)} rankings.",
                    "source_date": scraped.source_date,
                    "source_date_kind": scraped.source_date_kind,
                }
            )
        except Exception as exc:
            snapshot_id = save_failed_snapshot(source, fetched_at=fetched_at, message=str(exc))
            results.append(
                {
                    "source_id": source.id,
                    "snapshot_id": snapshot_id,
                    "status": "error",
                    "row_count": 0,
                    "message": str(exc),
                }
            )
    return {"results": results}


@app.post("/api/sources/{source_id}/import")
def import_source(source_id: str, request: CsvImportRequest) -> dict:
    source = require_source(source_id)
    try:
        entries = parse_csv_import(request.csv_text)
    except ScrapeError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    source_date = None
    try:
        source_date = scrape_source_date(source)
    except Exception:
        source_date = None
    snapshot_id = save_snapshot(
        source,
        entries,
        fetched_at=utc_now(),
        message=f"Imported {len(entries)} rankings.",
        source_date=source_date.value if source_date else None,
        source_date_kind=source_date.kind if source_date else None,
    )
    return {
        "source_id": source.id,
        "snapshot_id": snapshot_id,
        "status": "success",
        "row_count": len(entries),
        "message": f"Imported {len(entries)} rankings.",
        "source_date": source_date.value if source_date else None,
        "source_date_kind": source_date.kind if source_date else None,
    }


@app.get("/api/import-template.csv", response_class=PlainTextResponse)
def import_template() -> str:
    return "rank,player,team,position,age\n1,Shohei Ohtani,LAD,UT/P,31.6\n2,Juan Soto,NYM,OF,27.3\n"


@app.get("/api/lineup/dates")
def lineup_dates(start_date: str = "", days: int = 10) -> dict:
    if days < 1 or days > 31:
        raise HTTPException(status_code=422, detail="days must be between 1 and 31.")
    try:
        dates = fetch_probable_date_options(start_date.strip() or None, days=days)
    except ScrapeError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)}) from exc
    return {"dates": dates}


@app.get("/api/lineup/recommendations")
def lineup_recommendations(league_uid: str, team_uid: str, date: str) -> dict:
    league = get_league(league_uid)
    if not league:
        raise HTTPException(status_code=404, detail="Unknown league.")
    roster = [player for player in get_league_roster_map(league_uid) if player["team_uid"] == team_uid]
    if not roster:
        raise HTTPException(status_code=404, detail="No loaded roster found for that team in this league.")

    always_start_keys = {row["player_key"] for row in list_lineup_always_start(league_uid, team_uid)}
    always_sit_keys = {row["player_key"] for row in list_lineup_always_sit(league_uid, team_uid)}
    xfip_refresh = {"row_count": 0, "error_count": 0, "message": "No FanGraphs xFIP- refresh attempted."}
    try:
        refreshed = fetch_fangraphs_xfip_for_probables(date)
        row_count = upsert_pitcher_xfip_stats(refreshed["entries"], timestamp=utc_now()) if refreshed["entries"] else 0
        xfip_refresh = {
            "row_count": row_count,
            "error_count": len(refreshed["errors"]),
            "message": f"Refreshed {row_count}/{refreshed['probable_count']} probable-starter xFIP- rows from FanGraphs.",
            "errors": refreshed["errors"][:8],
        }
        recommendation = build_lineup_recommendations(
            roster_players=roster,
            pitcher_stats=list_pitcher_xfip_stats(),
            always_start_player_keys=always_start_keys,
            always_sit_player_keys=always_sit_keys,
            target_date=date,
        )
    except ScrapeError as exc:
        recommendation = build_lineup_recommendations(
            roster_players=roster,
            pitcher_stats=list_pitcher_xfip_stats(),
            always_start_player_keys=always_start_keys,
            always_sit_player_keys=always_sit_keys,
            target_date=date,
        )
        xfip_refresh = {
            "row_count": 0,
            "error_count": 1,
            "message": f"FanGraphs xFIP- refresh failed: {exc}. Using saved xFIP- rows only.",
            "errors": [str(exc)],
        }
    except Exception as exc:
        recommendation = build_lineup_recommendations(
            roster_players=roster,
            pitcher_stats=list_pitcher_xfip_stats(),
            always_start_player_keys=always_start_keys,
            always_sit_player_keys=always_sit_keys,
            target_date=date,
        )
        xfip_refresh = {
            "row_count": 0,
            "error_count": 1,
            "message": f"FanGraphs xFIP- refresh failed: {exc}. Using saved xFIP- rows only.",
            "errors": [str(exc)],
        }
    return {
        "league": league,
        "team_uid": team_uid,
        "source": "FanGraphs probables grid + FanGraphs player-page xFIP-",
        "xfip_refresh": xfip_refresh,
        **recommendation,
    }


@app.get("/api/lineup/pitcher-stats")
def lineup_pitcher_stats() -> list[dict]:
    return list_pitcher_xfip_stats()


@app.post("/api/lineup/pitcher-stats/import")
def import_pitcher_xfip_stats(request: PitcherXfipImportRequest) -> dict:
    season = request.season or datetime.now().year
    try:
        entries = parse_pitcher_xfip_csv(request.csv_text, season=season, source=request.source.strip() or "FanGraphs CSV")
    except ScrapeError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    count = upsert_pitcher_xfip_stats(entries, timestamp=utc_now())
    return {
        "status": "success",
        "row_count": count,
        "season": season,
        "message": f"Imported {count} pitcher xFIP- rows.",
    }


@app.post("/api/lineup/always-start")
def set_lineup_always_start_player(request: LineupAlwaysStartRequest) -> dict:
    if not get_league(request.league_uid):
        raise HTTPException(status_code=404, detail="Unknown league.")
    if not request.player_key.strip() and not request.player_name.strip():
        raise HTTPException(status_code=422, detail="player_key or player_name is required.")
    entry = set_lineup_always_start(
        league_uid=request.league_uid,
        team_uid=request.team_uid,
        player_key=request.player_key,
        player_name=request.player_name,
        always_start=request.always_start,
        timestamp=utc_now(),
    )
    return {
        "status": "success",
        "always_start": request.always_start,
        "entry": entry,
    }


@app.post("/api/lineup/always-sit")
def set_lineup_always_sit_player(request: LineupAlwaysSitRequest) -> dict:
    if not get_league(request.league_uid):
        raise HTTPException(status_code=404, detail="Unknown league.")
    if not request.player_key.strip() and not request.player_name.strip():
        raise HTTPException(status_code=422, detail="player_key or player_name is required.")
    entry = set_lineup_always_sit(
        league_uid=request.league_uid,
        team_uid=request.team_uid,
        player_key=request.player_key,
        player_name=request.player_name,
        always_sit=request.always_sit,
        timestamp=utc_now(),
    )
    return {
        "status": "success",
        "always_sit": request.always_sit,
        "entry": entry,
    }


@app.get("/api/teams")
def teams() -> list[dict]:
    return list_teams_with_status()


@app.get("/api/leagues")
def leagues() -> list[dict]:
    return list_leagues_with_status()


@app.post("/api/leagues/import")
def import_league(request: LeagueImportRequest) -> dict:
    return import_or_update_league(request.url)


@app.post("/api/leagues/{league_uid}/update")
def update_league(league_uid: str) -> dict:
    league = get_league(league_uid)
    if not league:
        raise HTTPException(status_code=404, detail="Unknown league.")
    return import_or_update_league(league["url"])


@app.post("/api/leagues/update-all")
def update_all_leagues() -> dict:
    results: list[dict] = []
    for league in list_leagues_with_status():
        try:
            results.append(import_or_update_league(league["url"]))
        except HTTPException as exc:
            results.append(
                {
                    "league_uid": league["league_uid"],
                    "league_name": league["league_name"],
                    "status": "error",
                    "team_count": 0,
                    "updated_team_count": 0,
                    "error_count": 1,
                    "message": str(exc.detail),
                    "results": [],
                }
            )
    successes = len([result for result in results if result.get("status") in {"success", "partial"}])
    errors = len([result for result in results if result.get("status") == "error"])
    return {
        "results": results,
        "message": f"Updated {successes} leagues{f', {errors} failed' if errors else ''}.",
    }


@app.get("/api/leagues/{league_uid}")
def league_detail(league_uid: str) -> dict:
    league = get_league(league_uid)
    if not league:
        raise HTTPException(status_code=404, detail="Unknown league.")
    return {"league": league, "teams": get_league_memberships(league_uid)}


@app.get("/api/leagues/{league_uid}/roster-map")
def league_roster_map(league_uid: str) -> dict:
    league = get_league(league_uid)
    if not league:
        raise HTTPException(status_code=404, detail="Unknown league.")
    players = get_league_roster_map(league_uid)
    return {
        "league": league,
        "players": players,
        "trade_block": get_league_trade_block(league_uid),
        "available_player_stats": get_league_available_player_stats(league_uid),
        "value_curve": build_league_value_curve(players),
    }


@app.delete("/api/leagues/{league_uid}")
def remove_league(league_uid: str) -> dict:
    if not delete_league(league_uid):
        raise HTTPException(status_code=404, detail="Unknown league.")
    return {"league_uid": league_uid, "status": "success", "message": "League removed."}


@app.post("/api/teams/import")
def import_team(request: TeamImportRequest) -> dict:
    try:
        team = scrape_ottoneu_team(request.url)
    except ScrapeError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)}) from exc
    snapshot_id = save_team_snapshot(
        team,
        fetched_at=utc_now(),
        message=f"Imported {len(team.roster)} roster players.",
    )
    return {
        "team_uid": team.team_uid,
        "snapshot_id": snapshot_id,
        "status": "success",
        "row_count": len(team.roster),
        "message": f"Imported {team.team_name}: {len(team.roster)} roster players.",
    }


@app.post("/api/teams/{team_uid}/update")
def update_team(team_uid: str) -> dict:
    detail = get_team_detail(team_uid)
    if not detail:
        raise HTTPException(status_code=404, detail="Unknown team.")
    try:
        team = scrape_ottoneu_team(detail["team"]["url"])
    except ScrapeError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)}) from exc
    snapshot_id = save_team_snapshot(
        team,
        fetched_at=utc_now(),
        message=f"Updated {len(team.roster)} roster players.",
    )
    return {
        "team_uid": team.team_uid,
        "snapshot_id": snapshot_id,
        "status": "success",
        "row_count": len(team.roster),
        "message": f"Updated {team.team_name}: {len(team.roster)} roster players.",
    }


@app.get("/api/teams/{team_uid}")
def team_detail(team_uid: str, tdg_format: str = "obp", fantrax_format: str = "roto") -> dict:
    detail = get_team_detail(team_uid)
    if not detail:
        raise HTTPException(status_code=404, detail="Unknown team.")
    return enrich_team_with_rankings(detail, tdg_format=tdg_format, fantrax_format=fantrax_format)


@app.delete("/api/teams/{team_uid}")
def remove_team(team_uid: str) -> dict:
    if not delete_team(team_uid):
        raise HTTPException(status_code=404, detail="Unknown team.")
    return {"team_uid": team_uid, "status": "success", "message": "Team removed."}


def import_or_update_league(url: str) -> dict:
    try:
        league = scrape_ottoneu_league(url)
    except ScrapeError as exc:
        raise HTTPException(status_code=422, detail={"message": str(exc)}) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc)}) from exc

    fetched_at = utc_now()
    save_league_snapshot(league, fetched_at=fetched_at)
    results: list[dict] = []
    for league_team in league.teams:
        try:
            team = scrape_ottoneu_team(league_team.url)
            snapshot_id = save_team_snapshot(
                team,
                fetched_at=fetched_at,
                message=f"Imported from {league.league_name}: {len(team.roster)} roster players.",
            )
            results.append(
                {
                    "team_uid": team.team_uid,
                    "team_name": team.team_name,
                    "snapshot_id": snapshot_id,
                    "status": "success",
                    "row_count": len(team.roster),
                    "message": f"Updated {team.team_name}: {len(team.roster)} roster players.",
                }
            )
        except Exception as exc:
            results.append(
                {
                    "team_uid": league_team.team_uid,
                    "team_name": league_team.team_name,
                    "status": "error",
                    "row_count": 0,
                    "message": str(exc),
                }
            )
    successes = len([result for result in results if result["status"] == "success"])
    errors = len(results) - successes
    return {
        "league_uid": league.league_uid,
        "league_name": league.league_name,
        "status": "success" if errors == 0 else "partial",
        "team_count": len(league.teams),
        "updated_team_count": successes,
        "error_count": errors,
        "message": f"Imported {league.league_name}: {successes} teams updated{f', {errors} failed' if errors else ''}.",
        "results": results,
    }


def require_source(source_id: str):
    try:
        return get_source(source_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def skipped_source_message(date_detected: bool, date_saved: bool) -> str:
    if date_saved:
        return "Import-only source; source date refreshed."
    if date_detected:
        return "Import-only source; source date detected but no imported snapshot exists."
    return "Import-only source."


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def format_exclusions(tdg_format: str, fantrax_format: str) -> set[str]:
    return tdg_exclusions(tdg_format) | fantrax_exclusions(fantrax_format)


def parse_included_source_tags(value: str) -> set[str]:
    if not value.strip():
        return set(SOURCE_TAGS)
    tags = {item.strip() for item in value.split(",") if item.strip()}
    invalid = tags - set(SOURCE_TAGS)
    if invalid:
        raise HTTPException(status_code=422, detail=f"Unknown source tag: {', '.join(sorted(invalid))}.")
    if not tags:
        raise HTTPException(status_code=422, detail="At least one source tag must be included.")
    return tags


def tdg_exclusions(tdg_format: str) -> set[str]:
    mode = tdg_format.lower()
    if mode == "obp":
        return {TDG_POINTS_SOURCE_ID}
    if mode in {"pts", "points"}:
        return {TDG_OBP_SOURCE_ID}
    raise HTTPException(status_code=422, detail="tdg_format must be 'obp' or 'points'.")


def fantrax_exclusions(fantrax_format: str) -> set[str]:
    mode = fantrax_format.lower()
    if mode == "roto":
        return {FANTRAX_POINTS_SOURCE_ID}
    if mode in {"pts", "points"}:
        return {FANTRAX_ROTO_SOURCE_ID}
    raise HTTPException(status_code=422, detail="fantrax_format must be 'roto' or 'points'.")


def enrich_team_with_rankings(detail: dict, *, tdg_format: str, fantrax_format: str) -> dict:
    board = build_aggregate_board(exclude_source_ids=format_exclusions(tdg_format, fantrax_format))
    ranking_lookup = {
        player["player_key"]: {
            "aggregate_rank": player["aggregate_rank"],
            "avg_rank": player["avg_rank"],
            "median_rank": player["median_rank"],
            "source_count": player["source_count"],
        }
        for player in board["players"]
    }
    detail = dict(detail)
    detail["roster"] = [
        {
            **player,
            "ranking": ranking_lookup.get(player["player_key"]),
        }
        for player in detail["roster"]
    ]
    return detail


FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
