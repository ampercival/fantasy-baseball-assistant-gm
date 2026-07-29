from app.lineup_helper import fangraphs_season_mlb_metric
from app.optimal_lineup import build_optimal_lineup_hitters


def hitter(
    name: str,
    ottoneu_id: int,
    *,
    positions: str = "OF",
    status: str | None = None,
    mlb_team: str = "ATL",
) -> dict:
    return {
        "section": "hitter",
        "ottoneu_player_id": ottoneu_id,
        "player_key": name.lower(),
        "player_name": name,
        "positions": positions,
        "status": status,
        "mlb_team": mlb_team,
        "salary": 5,
        "games": 80,
        "plate_appearances": 350,
        "points_per_game": 5.2,
        "points": 416.0,
    }


def test_fangraphs_metric_uses_current_standard_mlb_row():
    payload = {
        "data": [
            {"aseason": 2025, "type": 0, "AbbLevel": "MLB", "wRC+": 110},
            {"aseason": "2026", "type": "0", "AbbLevel": "MLB", "wRC+": "127.08"},
            {"aseason": 2026, "type": 1, "AbbLevel": "MLB", "wRC+": 140},
        ]
    }

    assert fangraphs_season_mlb_metric(payload, 2026, "wRC+") == 127.08
    assert fangraphs_season_mlb_metric(payload, 2024, "wRC+") is None


def test_optimal_lineup_includes_il_hitters_and_excludes_minor_leaguers(monkeypatch):
    roster = [
        hitter("Healthy Hitter", 1),
        hitter("Injured Hitter", 2, status="60IL"),
        hitter("Minor Hitter", 3, status="MiLB", mlb_team="ATL AAA"),
    ]
    monkeypatch.setattr("app.optimal_lineup.fetch_ottoneu_fangraphs_id_map", lambda: {1: "101", 2: "202", 3: "303"})
    monkeypatch.setattr(
        "app.optimal_lineup.fetch_fangraphs_hitter_wrc_plus",
        lambda player_id, season, referer_url: {"101": 115.0, "202": 130.0}[str(player_id)],
    )

    result = build_optimal_lineup_hitters(roster, season=2026)
    rows = {row["player_name"]: row for row in result["rows"]}

    assert set(rows) == {"Healthy Hitter", "Injured Hitter"}
    assert rows["Injured Hitter"]["status"] == "60IL"
    assert rows["Injured Hitter"]["wrc_plus"] == 130.0
    assert result["errors"] == []
