from app.lineup_helper import (
    build_fangraphs_pitcher_xfip_leaderboard,
    build_fangraphs_team_offense_ranks,
    build_lineup_recommendations,
    fetch_fangraphs_probable_matchups,
)


def test_team_offense_ranks_average_four_fangraphs_metrics():
    rankings = build_fangraphs_team_offense_ranks(
        {
            "data": [
                {"Season": 2026, "Team": '<a href="/team/1">DET</a>', "wRC": 90, "wRAA": 8, "wOBA": .320, "wRC+": 105},
                {"Season": 2026, "Team": '<a href="/team/2">CLE</a>', "wRC": 100, "wRAA": 4, "wOBA": .330, "wRC+": 110},
                {"Season": 2026, "Team": '<a href="/team/3">NYY</a>', "wRC": 80, "wRAA": 12, "wOBA": .310, "wRC+": 100},
            ]
        },
        2026,
    )

    assert rankings["CLE"]["wrc_rank"] == 1
    assert rankings["CLE"]["wraa_rank"] == 3
    assert rankings["CLE"]["woba_rank"] == 1
    assert rankings["CLE"]["wrc_plus_rank"] == 1
    assert rankings["CLE"]["average_rank"] == 1.5
    assert rankings["CLE"]["aggregate_rank"] == 1
    assert rankings["CLE"]["team_count"] == 3


def test_pitcher_xfip_leaderboard_builds_name_keyed_cache():
    stats = build_fangraphs_pitcher_xfip_leaderboard(
        {
            "data": [
                {
                    "Season": 2026,
                    "PlayerName": "Tarik Skubal",
                    "playerid": 18080,
                    "xFIP-": 74.12345,
                },
                {
                    "Season": 2025,
                    "PlayerName": "Old Season",
                    "playerid": 1,
                    "xFIP-": 99,
                },
                {
                    "Season": 2026,
                    "PlayerName": "Missing Stat",
                    "playerid": 2,
                    "xFIP-": None,
                },
            ]
        },
        2026,
    )

    assert stats == {
        "tarik skubal": {
            "pitcher_key": "tarik skubal",
            "pitcher_name": "Tarik Skubal",
            "fangraphs_id": "18080",
            "season": 2026,
            "xfip_minus": 74.1235,
            "source": "FanGraphs pitching leaderboard",
        }
    }


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
        team_offense_ranks={
            "CLE": {
                "team_code": "CLE",
                "season": 2026,
                "team_count": 30,
                "aggregate_rank": 7,
                "average_rank": 7.5,
                "wrc_rank": 8,
                "wraa_rank": 7,
                "woba_rank": 6,
                "wrc_plus_rank": 9,
            }
        },
    )

    assert [row["player_key"] for row in result["pitcher_starts"]] == ["tarik skubal"]
    assert result["pitcher_starts"][0]["opponent_team"] == "CLE"
    assert result["pitcher_starts"][0]["points_per_ip"] == 6.1
    assert result["pitcher_starts"][0]["opponent_offense_ranks"]["aggregate_rank"] == 7
