from app.lineup_helper import build_lineup_recommendations, fetch_fangraphs_probable_matchups


def test_probable_matchups_keep_each_teams_starting_pitcher(monkeypatch):
    monkeypatch.setattr(
        "app.lineup_helper.fetch_fangraphs_probables_grid_games",
        lambda: [
            {
                "gameDate": "2026-07-27",
                "abbName": "DET",
                "team": {"sp": {"name": "Tarik Skubal", "playerId": 18080, "UPURL": "/players/tarik-skubal/18080/stats"}},
                "opponent": {
                    "abbName": "CLE",
                    "sp": {"name": "Gavin Williams", "playerId": 29461, "UPURL": "/players/gavin-williams/29461/stats"},
                },
            }
        ],
    )

    result = fetch_fangraphs_probable_matchups("2026-07-27")

    assert result["matchups"]["DET"]["starting_pitcher"]["pitcher_key"] == "tarik skubal"
    assert result["matchups"]["DET"]["opposing_pitcher"]["pitcher_key"] == "gavin williams"


def test_lineup_recommendations_include_probable_pitchers_from_roster(monkeypatch):
    monkeypatch.setattr(
        "app.lineup_helper.fetch_probable_matchups",
        lambda _target_date: {
            "date": "2026-07-27",
            "game_count": 1,
            "probable_starter_count": 2,
            "matchups": {
                "DET": {
                    "opponent_team": "CLE",
                    "opponent_name": "Cleveland Guardians",
                    "starting_pitcher": {
                        "pitcher_key": "tarik skubal",
                        "pitcher_name": "Tarik Skubal",
                        "fangraphs_url": "https://www.fangraphs.com/players/tarik-skubal/18080/stats",
                    },
                    "opposing_pitcher": {
                        "pitcher_key": "gavin williams",
                        "pitcher_name": "Gavin Williams",
                    },
                }
            },
        },
    )
    roster = [
        {
            "player_key": "tarik skubal",
            "player_name": "Tarik Skubal",
            "positions": "SP",
            "mlb_team": "DET",
            "status": "",
            "section": "pitcher",
            "salary": 45,
            "points": 800,
            "points_per_ip": 6.1,
        },
        {
            "player_key": "jack flaherty",
            "player_name": "Jack Flaherty",
            "positions": "SP",
            "mlb_team": "DET",
            "status": "",
            "section": "pitcher",
            "salary": 12,
            "points": 500,
            "points_per_ip": 4.8,
        },
    ]

    result = build_lineup_recommendations(
        roster_players=roster,
        pitcher_stats=[],
        always_start_player_keys=set(),
        always_sit_player_keys=set(),
        target_date="2026-07-27",
    )

    assert [row["player_key"] for row in result["pitcher_starts"]] == ["tarik skubal"]
    assert result["pitcher_starts"][0]["opponent_team"] == "CLE"
    assert result["pitcher_starts"][0]["points_per_ip"] == 6.1
