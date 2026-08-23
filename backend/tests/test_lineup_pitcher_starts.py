from app.lineup_helper import (
    build_fangraphs_pitcher_xfip_leaderboard,
    build_fangraphs_team_offense_ranks,
    build_lineup_recommendations,
    fetch_fangraphs_probable_matchups,
    fetch_fangraphs_xfip_for_probables,
    fetch_mlb_probable_date_options,
    fetch_mlb_probable_matchups,
    is_il_player,
    is_minor_league_player,
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


def test_milb_status_is_not_misclassified_as_injured_list():
    minor_leaguer = {"status": "MiLB", "mlb_team": "ATL AAA"}

    assert is_il_player(minor_leaguer) is False
    assert is_minor_league_player(minor_leaguer) is True
    assert is_il_player({"status": "15IL"}) is True
    assert is_il_player({"status": "60-Day IL"}) is True
    assert is_il_player({"status": "DL"}) is True


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

    assert result["matchups"]["DET"][0]["starting_pitcher"]["pitcher_key"] == "tarik skubal"
    assert result["matchups"]["DET"][0]["opposing_pitcher"]["pitcher_key"] == "gavin williams"


def test_probable_matchups_preserve_doubleheader_games_and_ignore_series_ordinal(monkeypatch):
    def pitcher(name, player_id):
        return {"name": name, "playerId": player_id, "UPURL": f"/players/{player_id}/stats"}

    monkeypatch.setattr(
        "app.lineup_helper.fetch_fangraphs_probables_grid_games",
        lambda: [
            {
                "gameDate": "2026-08-29",
                "abbName": "BOS",
                "dh": 2,
                "seriesGameNumber": 4,
                "team": {"sp": pitcher("Brayan Bello", 3)},
                "opponent": {"abbName": "NYY", "sp": pitcher("Carlos Rodon", 4)},
            },
            {
                "gameDate": "2026-08-29",
                "abbName": "NYY",
                "dh": 2,
                "seriesGameNumber": 4,
                "team": {"sp": pitcher("Carlos Rodon", 4)},
                "opponent": {"abbName": "BOS", "sp": pitcher("Brayan Bello", 3)},
            },
            {
                "gameDate": "2026-08-29",
                "abbName": "BOS",
                "dh": 1,
                "seriesGameNumber": 3,
                "team": {"sp": pitcher("Jake Bennett", 1)},
                "opponent": {"abbName": "NYY", "sp": pitcher("Elmer Rodriguez", 2)},
            },
            {
                "gameDate": "2026-08-29",
                "abbName": "NYY",
                "dh": 1,
                "seriesGameNumber": 3,
                "team": {"sp": pitcher("Elmer Rodriguez", 2)},
                "opponent": {"abbName": "BOS", "sp": pitcher("Jake Bennett", 1)},
            },
        ],
    )

    result = fetch_fangraphs_probable_matchups("2026-08-29")

    assert result["game_count"] == 2
    assert result["probable_starter_count"] == 4
    assert [row["game_number"] for row in result["matchups"]["BOS"]] == [1, 2]
    assert [row["game_key"] for row in result["matchups"]["BOS"]] == [
        "2026-08-29:BOS-NYY:1",
        "2026-08-29:BOS-NYY:2",
    ]
    assert [row["opposing_pitcher"]["pitcher_key"] for row in result["matchups"]["BOS"]] == [
        "elmer rodriguez",
        "carlos rodon",
    ]
    assert [row["game_key"] for row in result["matchups"]["NYY"]] == [
        "2026-08-29:BOS-NYY:1",
        "2026-08-29:BOS-NYY:2",
    ]


def test_probable_matchups_ignore_series_ordinal_for_an_ordinary_game(monkeypatch):
    monkeypatch.setattr(
        "app.lineup_helper.fetch_fangraphs_probables_grid_games",
        lambda: [
            {
                "gameDate": "2026-08-30",
                "abbName": "DET",
                "dh": 0,
                "seriesGameNumber": 3,
                "team": {"sp": {"name": "Tarik Skubal"}},
                "opponent": {"abbName": "CLE", "sp": {"name": "Gavin Williams"}},
            }
        ],
    )

    result = fetch_fangraphs_probable_matchups("2026-08-30")

    assert result["matchups"]["DET"][0]["game_number"] == 1
    assert result["matchups"]["DET"][0]["game_key"] == "2026-08-30:CLE-DET:1"


def test_xfip_refresh_collects_probables_from_every_game(monkeypatch):
    monkeypatch.setattr(
        "app.lineup_helper.fetch_probable_matchups",
        lambda _target_date: {
            "matchups": {
                "BOS": [
                    {
                        "opposing_pitcher": {
                            "pitcher_key": "elmer rodriguez",
                            "pitcher_name": "Elmer Rodriguez",
                        }
                    },
                    {
                        "opposing_pitcher": {
                            "pitcher_key": "carlos rodon",
                            "pitcher_name": "Carlos Rodon",
                        }
                    },
                ]
            }
        },
    )
    monkeypatch.setattr(
        "app.lineup_helper.fetch_fangraphs_probable_pitcher_ids",
        lambda: {
            "elmer rodriguez": {"fangraphs_id": "1", "fangraphs_url": "https://example.test/1"},
            "carlos rodon": {"fangraphs_id": "2", "fangraphs_url": "https://example.test/2"},
        },
    )
    monkeypatch.setattr(
        "app.lineup_helper.fetch_fangraphs_pitcher_xfip_minus",
        lambda player_id, _season, _url: {"1": 146.4, "2": 100.2}[str(player_id)],
    )

    result = fetch_fangraphs_xfip_for_probables("2026-08-29")

    assert result["probable_count"] == 2
    assert result["matched_count"] == 2
    assert {row["pitcher_name"] for row in result["entries"]} == {"Elmer Rodriguez", "Carlos Rodon"}


def test_mlb_fallback_preserves_doubleheader_games(monkeypatch):
    def game(game_pk, game_number, away_pitcher, home_pitcher):
        return {
            "gamePk": game_pk,
            "gameNumber": game_number,
            "teams": {
                "away": {
                    "team": {"name": "New York Yankees", "abbreviation": "NYY"},
                    "probablePitcher": {"id": game_pk * 10, "fullName": away_pitcher},
                },
                "home": {
                    "team": {"name": "Boston Red Sox", "abbreviation": "BOS"},
                    "probablePitcher": {"id": game_pk * 10 + 1, "fullName": home_pitcher},
                },
            },
        }

    monkeypatch.setattr(
        "app.lineup_helper.fetch_mlb_schedule",
        lambda _start, _end: {
            "dates": [
                {
                    "date": "2026-08-29",
                    "games": [
                        game(1001, 1, "Elmer Rodriguez", "Jake Bennett"),
                        game(1002, 2, "Carlos Rodon", "Brayan Bello"),
                    ],
                }
            ]
        },
    )

    result = fetch_mlb_probable_matchups("2026-08-29")

    assert result["game_count"] == 2
    assert result["probable_starter_count"] == 4
    assert [row["game_key"] for row in result["matchups"]["BOS"]] == ["1001", "1002"]
    assert [row["game_number"] for row in result["matchups"]["BOS"]] == [1, 2]
    assert [row["opposing_pitcher"]["pitcher_key"] for row in result["matchups"]["BOS"]] == [
        "elmer rodriguez",
        "carlos rodon",
    ]


def test_mlb_fallback_excludes_games_that_will_not_be_played(monkeypatch):
    def game(game_pk, away_code, home_code, detailed_state):
        return {
            "gamePk": game_pk,
            "status": {"abstractGameState": "Preview", "detailedState": detailed_state},
            "teams": {
                "away": {
                    "team": {"name": away_code, "abbreviation": away_code},
                    "probablePitcher": {"id": game_pk * 10, "fullName": f"{away_code} Starter"},
                },
                "home": {
                    "team": {"name": home_code, "abbreviation": home_code},
                    "probablePitcher": {"id": game_pk * 10 + 1, "fullName": f"{home_code} Starter"},
                },
            },
        }

    monkeypatch.setattr(
        "app.lineup_helper.fetch_mlb_schedule",
        lambda _start, _end: {
            "dates": [{
                "date": "2026-08-30",
                "games": [
                    game(2001, "NYY", "BOS", "Postponed"),
                    game(2002, "LAA", "SEA", "Scheduled"),
                ],
            }]
        },
    )

    date_options = fetch_mlb_probable_date_options("2026-08-30", days=1)
    matchups = fetch_mlb_probable_matchups("2026-08-30")

    assert date_options[0]["game_count"] == 1
    assert date_options[0]["probable_starter_count"] == 2
    assert matchups["game_count"] == 1
    assert matchups["probable_starter_count"] == 2
    assert sorted(matchups["matchups"]) == ["LAA", "SEA"]


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


def test_doubleheader_keeps_every_hitter_matchup_and_owned_pitcher_start(monkeypatch):
    probable_data = {
        "date": "2026-08-29",
        "game_count": 2,
        "probable_starter_count": 4,
        "matchups": {
            "BOS": [
                {
                    "game_key": "2026-08-29:BOS-NYY:1",
                    "game_number": 1,
                    "opponent_team": "NYY",
                    "opponent_name": "NYY",
                    "starting_pitcher": {"pitcher_key": "jake bennett", "pitcher_name": "Jake Bennett"},
                    "opposing_pitcher": {"pitcher_key": "elmer rodriguez", "pitcher_name": "Elmer Rodríguez"},
                },
                {
                    "game_key": "2026-08-29:BOS-NYY:2",
                    "game_number": 2,
                    "opponent_team": "NYY",
                    "opponent_name": "NYY",
                    "starting_pitcher": {"pitcher_key": "brayan bello", "pitcher_name": "Brayan Bello"},
                    "opposing_pitcher": {"pitcher_key": "carlos rodon", "pitcher_name": "Carlos Rodón"},
                },
            ]
        },
    }
    monkeypatch.setattr("app.lineup_helper.fetch_probable_matchups", lambda _target_date: probable_data)
    roster = [
        {
            "player_key": "willson contreras",
            "player_name": "Willson Contreras",
            "positions": "1B",
            "mlb_team": "BOS",
            "status": "",
            "section": "hitter",
            "salary": 12,
            "points": 700,
            "points_per_game": 6.69,
        },
        {
            "player_key": "jake bennett",
            "player_name": "Jake Bennett",
            "positions": "SP",
            "mlb_team": "BOS",
            "status": "",
            "section": "pitcher",
            "salary": 8,
            "points": 350,
            "points_per_ip": 5.03,
        },
        {
            "player_key": "brayan bello",
            "player_name": "Brayan Bello",
            "positions": "SP",
            "mlb_team": "BOS",
            "status": "",
            "section": "pitcher",
            "salary": 10,
            "points": 400,
            "points_per_ip": 4.9,
        },
    ]

    result = build_lineup_recommendations(
        roster_players=roster,
        pitcher_stats=[
            {"pitcher_key": "elmer rodriguez", "xfip_minus": 80.0},
            {"pitcher_key": "carlos rodon", "xfip_minus": 160.0},
        ],
        always_start_player_keys=set(),
        always_sit_player_keys=set(),
        target_date="2026-08-29",
    )

    hitter_row = result["rows"][0]
    assert hitter_row["plays_today"] is True
    assert [game["game_number"] for game in hitter_row["games"]] == [1, 2]
    assert [game["opposing_pitcher_key"] for game in hitter_row["games"]] == [
        "elmer rodriguez",
        "carlos rodon",
    ]
    assert hitter_row["opposing_pitcher_key"] == "elmer rodriguez"
    assert hitter_row["opposing_pitcher_xfip_minus"] == 80.0
    assert hitter_row["recommendation_code"] == "lean-start"
    starts_by_key = {row["player_key"]: row for row in result["pitcher_starts"]}
    assert set(starts_by_key) == {"jake bennett", "brayan bello"}
    assert starts_by_key["jake bennett"]["game_number"] == 1
    assert starts_by_key["brayan bello"]["game_number"] == 2


def test_hard_no_game_and_no_team_states_override_saved_preferences(monkeypatch):
    monkeypatch.setattr(
        "app.lineup_helper.fetch_probable_matchups",
        lambda _target_date: {
            "date": "2026-08-24",
            "game_count": 1,
            "probable_starter_count": 2,
            "matchups": {},
        },
    )
    roster = [
        {
            "player_key": "ronald acuna",
            "player_name": "Ronald Acuña Jr.",
            "positions": "OF",
            "mlb_team": "ATL",
            "status": "",
            "section": "hitter",
            "salary": 40,
            "points": 500,
            "points_per_game": 5.18,
        },
        {
            "player_key": "unassigned hitter",
            "player_name": "Unassigned Hitter",
            "positions": "OF",
            "mlb_team": None,
            "status": "",
            "section": "hitter",
            "salary": 1,
            "points": 0,
            "points_per_game": 0,
        },
    ]

    result = build_lineup_recommendations(
        roster_players=roster,
        pitcher_stats=[],
        always_start_player_keys={"ronald acuna"},
        always_sit_player_keys={"unassigned hitter"},
        target_date="2026-08-24",
    )

    rows = {row["player_key"]: row for row in result["rows"]}
    assert rows["ronald acuna"]["plays_today"] is False
    assert rows["ronald acuna"]["recommendation_code"] == "no-game"
    assert rows["unassigned hitter"]["plays_today"] is False
    assert rows["unassigned hitter"]["recommendation_code"] == "no-mlb-team"


def test_unavailable_probable_pitchers_are_not_actionable_starts(monkeypatch):
    monkeypatch.setattr(
        "app.lineup_helper.fetch_probable_matchups",
        lambda _target_date: {
            "date": "2026-08-25",
            "game_count": 1,
            "probable_starter_count": 1,
            "matchups": {
                "DET": [
                    {
                        "game_key": "2026-08-25:CLE-DET:1",
                        "game_number": 1,
                        "opponent_team": "CLE",
                        "opponent_name": "CLE",
                        "starting_pitcher": {"pitcher_key": "tarik skubal", "pitcher_name": "Tarik Skubal"},
                        "opposing_pitcher": None,
                    }
                ]
            },
        },
    )

    for status in ("15IL", "MiLB", "SUSP"):
        result = build_lineup_recommendations(
            roster_players=[
                {
                    "player_key": "tarik skubal",
                    "player_name": "Tarik Skubal",
                    "positions": "SP",
                    "mlb_team": "DET",
                    "status": status,
                    "section": "pitcher",
                    "salary": 45,
                    "points": 800,
                    "points_per_ip": 6.1,
                }
            ],
            pitcher_stats=[],
            always_start_player_keys=set(),
            always_sit_player_keys=set(),
            target_date="2026-08-25",
        )
        assert result["pitcher_starts"] == []
