from app.pitcher_usage import classify_pitcher_usage, fallback_usage_row, fetch_fangraphs_pitcher_appearances


def pitcher(positions: str = "SP/RP", *, games: int | None = None, games_started: int | None = None) -> dict:
    return {
        "player_key": "test pitcher",
        "player_name": "Test Pitcher",
        "positions": positions,
        "games": games,
        "games_started": games_started,
    }


def test_dual_eligible_all_starts_classifies_as_sp():
    row = classify_pitcher_usage(pitcher(), [1, 1, 1, 1], fangraphs_id=123)

    assert row["bucket"] == "SP"
    assert row["role"] == "SP"
    assert row["season_starts"] == 4
    assert row["season_relief_appearances"] == 0


def test_dual_eligible_all_relief_classifies_as_rp():
    row = classify_pitcher_usage(pitcher(), [0, 0, 0])

    assert row["bucket"] == "RP"
    assert row["role"] == "RP"


def test_mixed_usage_uses_only_last_five_appearances():
    row = classify_pitcher_usage(pitcher(), [1, 0, 1, 0, 1, 0, 0, 0, 0])

    assert row["bucket"] == "SP"
    assert row["role"] == "Mixed - SP"
    assert row["last_five"] == ["SP", "RP", "SP", "RP", "SP"]


def test_mixed_usage_tie_defaults_to_rp():
    row = classify_pitcher_usage(pitcher(), [1, 0, 1, 0])

    assert row["bucket"] == "RP"
    assert row["role"] == "Mixed - RP"


def test_roster_fallback_keeps_pure_usage_when_game_log_fails():
    row = fallback_usage_row(pitcher(games=8, games_started=8), error="blocked")

    assert row["bucket"] == "SP"
    assert row["role"] == "SP"
    assert row["usage_source"] == "roster-fallback"
    assert row["error"] == "blocked"


def test_game_log_parser_excludes_total_and_sorts_newest_first(monkeypatch):
    class Response:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "mlb": [
                    {"gamedate": "2050-01-01", "G": 3, "GS": 2},
                    {"gamedate": "2026-04-02", "G": 1, "GS": 0, "dh": 0},
                    {"gamedate": "2026-04-03", "G": 1, "GS": 1, "dh": 0},
                ]
            }

    monkeypatch.setattr("app.pitcher_usage.requests.get", lambda *args, **kwargs: Response())

    assert fetch_fangraphs_pitcher_appearances(123, 2026) == [1, 0]
