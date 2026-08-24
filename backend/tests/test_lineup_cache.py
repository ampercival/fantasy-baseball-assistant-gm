from datetime import date, datetime, timezone

from app.db import replace_lineup_date_cache
from app.lineup_cache import refresh_lineup_data_cache


def _legacy_save(captured):
    def save(payload, *, generated_at):
        captured["payload"] = payload
        return {**payload, "generated_at": generated_at}

    return save


def test_refresh_lineup_cache_stores_dates_and_new_reference_data(monkeypatch):
    games = [
        {
            "gameDate": "2026-08-05",
            "abbName": "DET",
            "team": {"sp": {"name": "Tarik Skubal", "playerId": 18000}},
        },
        {"gameDate": "2026-08-05", "abbName": "CLE", "team": {}},
        {"gameDate": "2026-08-18", "abbName": "NYY"},
    ]
    captured = {}

    monkeypatch.setattr("app.lineup_cache.fetch_fangraphs_probables_grid_games", lambda: games)
    monkeypatch.setattr("app.lineup_cache.get_lineup_reference_cache", lambda season: None)
    monkeypatch.setattr(
        "app.lineup_cache.fetch_fangraphs_pitcher_xfip_leaderboard",
        lambda season: {"tarik skubal": {"season": season, "xfip_minus": 74}},
    )
    monkeypatch.setattr(
        "app.lineup_cache.fetch_fangraphs_team_offense_ranks",
        lambda season: {"DET": {"season": season, "aggregate_rank": 1}},
    )
    monkeypatch.setattr(
        "app.lineup_cache.save_lineup_reference_cache",
        lambda season, pitcher_stats, team_offense_ranks, **kwargs: captured.update(
            reference={
                "season": season,
                "pitcher_stats": pitcher_stats,
                "team_offense_ranks": team_offense_ranks,
                **kwargs,
            }
        ),
    )

    def replace(rows, **kwargs):
        captured["date_rows"] = rows
        captured["date_args"] = kwargs
        return {"deleted_past_count": 2, "stored_date_count": len(rows), **kwargs}

    monkeypatch.setattr("app.lineup_cache.replace_lineup_date_cache", replace)
    monkeypatch.setattr("app.lineup_cache.save_lineup_data_cache", _legacy_save(captured))

    result = refresh_lineup_data_cache(today=date(2026, 8, 5), days=10)

    assert captured["date_args"]["start_date"] == "2026-08-05"
    assert captured["date_args"]["end_date"] == "2026-08-14"
    assert captured["date_rows"][0]["game_date"] == "2026-08-05"
    assert captured["date_rows"][0]["game_count"] == 1
    assert captured["date_rows"][0]["probable_starter_count"] == 1
    assert captured["date_rows"][0]["games"] == games[:2]
    assert captured["payload"]["games"] == games[:2]
    assert captured["reference"]["season"] == 2026
    assert result["reference_cache"]["refreshed"] is True
    assert "deleted 2 past dates" in result["message"]


def test_refresh_lineup_cache_reuses_fresh_reference_data(monkeypatch):
    fetched_at = datetime.now(timezone.utc).isoformat()
    reference = {
        "season": 2026,
        "pitcher_stats": {
            "tarik skubal": {
                "season": 2026,
                "xfip_minus": 74,
                "innings_pitched": 145,
                "batters_faced": 550,
            }
        },
        "team_offense_ranks": {"DET": {"season": 2026, "aggregate_rank": 1}},
        "fetched_at": fetched_at,
    }
    captured = {}
    monkeypatch.setattr(
        "app.lineup_cache.fetch_fangraphs_probables_grid_games",
        lambda: [{"gameDate": "2026-08-05", "abbName": "DET"}],
    )
    monkeypatch.setattr("app.lineup_cache.get_lineup_reference_cache", lambda season: reference)
    monkeypatch.setattr(
        "app.lineup_cache.fetch_fangraphs_pitcher_xfip_leaderboard",
        lambda season: (_ for _ in ()).throw(AssertionError("pitcher reference data was refetched")),
    )
    monkeypatch.setattr(
        "app.lineup_cache.fetch_fangraphs_team_offense_ranks",
        lambda season: (_ for _ in ()).throw(AssertionError("offense reference data was refetched")),
    )
    monkeypatch.setattr(
        "app.lineup_cache.save_lineup_reference_cache",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("fresh reference data was rewritten")),
    )
    monkeypatch.setattr(
        "app.lineup_cache.replace_lineup_date_cache",
        lambda rows, **kwargs: {
            "deleted_past_count": 1,
            "stored_date_count": len(rows),
            **kwargs,
        },
    )
    monkeypatch.setattr("app.lineup_cache.save_lineup_data_cache", _legacy_save(captured))

    result = refresh_lineup_data_cache(today=date(2026, 8, 5), days=10)

    assert result["reference_cache"]["refreshed"] is False
    assert result["reference_cache"]["pitcher_count"] == 1
    assert captured["payload"]["pitcher_stats"] == reference["pitcher_stats"]
    assert "Reused 1 pitcher xFIP- rows" in result["message"]


def test_refresh_lineup_cache_replaces_fresh_legacy_reference_without_workload(monkeypatch):
    reference = {
        "season": 2026,
        "pitcher_stats": {"tarik skubal": {"season": 2026, "xfip_minus": 74}},
        "team_offense_ranks": {"DET": {"season": 2026, "aggregate_rank": 1}},
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    captured = {}
    refreshed_pitchers = {
        "tarik skubal": {
            "season": 2026,
            "xfip_minus": 74,
            "innings_pitched": 145,
            "batters_faced": 550,
        }
    }
    monkeypatch.setattr("app.lineup_cache.fetch_fangraphs_probables_grid_games", lambda: [])
    monkeypatch.setattr("app.lineup_cache.get_lineup_reference_cache", lambda season: reference)
    monkeypatch.setattr("app.lineup_cache.fetch_fangraphs_pitcher_xfip_leaderboard", lambda season: refreshed_pitchers)
    monkeypatch.setattr("app.lineup_cache.fetch_fangraphs_team_offense_ranks", lambda season: reference["team_offense_ranks"])
    monkeypatch.setattr(
        "app.lineup_cache.save_lineup_reference_cache",
        lambda season, pitcher_stats, team_offense_ranks, **kwargs: captured.update(pitcher_stats=pitcher_stats),
    )
    monkeypatch.setattr(
        "app.lineup_cache.replace_lineup_date_cache",
        lambda rows, **kwargs: {"deleted_past_count": 0, "stored_date_count": 0, **kwargs},
    )
    monkeypatch.setattr("app.lineup_cache.save_lineup_data_cache", _legacy_save(captured))

    result = refresh_lineup_data_cache(today=date(2026, 8, 5), days=10)

    assert result["reference_cache"]["refreshed"] is True
    assert captured["pitcher_stats"] == refreshed_pitchers
    assert "Refreshed 1 pitcher xFIP- rows" in result["message"]


def test_replace_lineup_date_cache_deletes_past_and_replaces_window(monkeypatch):
    class Cursor:
        def __init__(self, rowcount=0):
            self.rowcount = rowcount

    class FakeConnection:
        def __init__(self):
            self.executed = []
            self.inserted = []

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def execute(self, sql, params):
            self.executed.append((sql, params))
            return Cursor(3 if "game_date < ?" in sql else 0)

        def executemany(self, sql, rows):
            self.inserted.extend(rows)

    connection = FakeConnection()
    monkeypatch.setattr("app.db.get_connection", lambda: connection)

    result = replace_lineup_date_cache(
        [
            {
                "game_date": "2026-08-05",
                "game_count": 1,
                "probable_starter_count": 1,
                "games": [{"gameDate": "2026-08-05"}],
                "source": "FanGraphs via home worker",
            }
        ],
        start_date="2026-08-05",
        end_date="2026-08-14",
        fetched_at="2026-08-05T12:00:00+00:00",
    )

    assert "game_date < ?" in connection.executed[0][0]
    assert connection.executed[0][1] == ("2026-08-05",)
    assert "game_date BETWEEN ? AND ?" in connection.executed[1][0]
    assert connection.executed[1][1] == ("2026-08-05", "2026-08-14")
    assert len(connection.inserted) == 1
    assert result["deleted_past_count"] == 3
