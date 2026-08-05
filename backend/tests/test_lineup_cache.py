from datetime import date

from app.lineup_cache import refresh_lineup_data_cache


def test_refresh_lineup_cache_filters_dates_and_saves_normalized_payload(monkeypatch):
    games = [
        {"gameDate": "2026-08-05", "abbName": "DET"},
        {"gameDate": "2026-08-18", "abbName": "CLE"},
    ]
    captured = {}

    monkeypatch.setattr("app.lineup_cache.fetch_fangraphs_probables_grid_games", lambda: games)
    monkeypatch.setattr(
        "app.lineup_cache.fetch_fangraphs_pitcher_xfip_leaderboard",
        lambda season: {"tarik skubal": {"season": season, "xfip_minus": 74}},
    )
    monkeypatch.setattr(
        "app.lineup_cache.fetch_fangraphs_team_offense_ranks",
        lambda season: {"DET": {"season": season, "aggregate_rank": 1}},
    )

    def save(payload, *, generated_at):
        captured["payload"] = payload
        captured["generated_at"] = generated_at
        return {**payload, "generated_at": generated_at}

    monkeypatch.setattr("app.lineup_cache.save_lineup_data_cache", save)

    result = refresh_lineup_data_cache(today=date(2026, 8, 5), days=10)

    assert captured["payload"]["start_date"] == "2026-08-05"
    assert captured["payload"]["end_date"] == "2026-08-14"
    assert captured["payload"]["games"] == [games[0]]
    assert captured["payload"]["pitcher_stats"]["tarik skubal"]["xfip_minus"] == 74
    assert captured["payload"]["team_offense_ranks"]["DET"]["aggregate_rank"] == 1
    assert result["status"] == "success"
    assert "1 FanGraphs probable-team rows" in result["message"]
