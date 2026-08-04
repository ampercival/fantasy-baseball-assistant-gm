import random

from app.ottoneu import OttoneuLeagueDirectoryEntry, parse_ottoneu_league_directory, parse_ottoneu_roster_export_salaries
from app.platform_value import aggregate_salary_rank_points, build_platform_value_curve, sample_platform_leagues


def directory_entry(league_id: int) -> OttoneuLeagueDirectoryEntry:
    return OttoneuLeagueDirectoryEntry(
        league_id=league_id,
        league_name=f"League {league_id}",
        game_type="FanGraphs Points",
        opl_valid=True,
        created_by="tester",
    )


def test_ottoneu_directory_and_roster_export_parsers():
    directory = parse_ottoneu_league_directory(
        [{"ID": "1900", "LeagueName": "Aspromonte", "GameType": "FanGraphs Points", "OPLValid": True, "CreatedBy": "jflippers"}]
    )
    salaries = parse_ottoneu_roster_export_salaries(
        'TeamID,"Team Name",Name,Salary\n1,Test,Juan Soto,$65\n1,Test,Prospect,$1\n'
    )

    assert directory[0].league_id == 1900
    assert directory[0].league_name == "Aspromonte"
    assert salaries == [65.0, 1.0]


def test_aggregate_salary_rank_points_equal_weights_leagues():
    points, observation_count = aggregate_salary_rank_points([[10, 5, 1], [20, 4]])

    assert points == [
        {"rank": 1, "salary": 15.0, "sample_count": 2},
        {"rank": 2, "salary": 4.5, "sample_count": 2},
        {"rank": 3, "salary": 1.0, "sample_count": 1},
    ]
    assert observation_count == 5


def test_build_platform_value_curve_fits_aggregate_points():
    curve = build_platform_value_curve([
        [80, 68, 55, 45, 38, 30, 24, 20, 16, 13, 10, 8, 6, 5, 4, 3, 2, 1],
        [75, 65, 52, 44, 36, 29, 23, 19, 15, 12, 9, 7, 6, 5, 4, 3, 2, 1],
    ])

    assert curve is not None
    assert curve["rank_count"] == 18
    assert curve["observation_count"] == 36
    assert curve["points"][0]["salary"] == 77.5


def test_sampler_resamples_and_replaces_failed_candidates():
    directory = [directory_entry(value) for value in range(1, 6)]
    calls: list[int] = []

    def fetch_salaries(league_id: int) -> list[float]:
        calls.append(league_id)
        if league_id == 3:
            raise RuntimeError("temporary failure")
        return [50, 40, 30, 20, 15, 10, 5, 1]

    result = sample_platform_leagues(directory, 3, fetch_salaries, rng=random.Random(4))

    assert result["successful_league_count"] == 3
    assert len(result["sampled_leagues"]) == 3
    assert result["attempted_league_count"] == len(calls)
    assert all(row["league_id"] != 3 for row in result["sampled_leagues"])


def test_sampler_draws_a_new_random_set_for_each_run():
    directory = [directory_entry(value) for value in range(1, 7)]
    fetch_salaries = lambda _league_id: [50, 40, 30, 20, 15, 10, 5, 1]

    first = sample_platform_leagues(directory, 2, fetch_salaries, rng=random.Random(1))
    second = sample_platform_leagues(directory, 2, fetch_salaries, rng=random.Random(7))

    first_ids = [row["league_id"] for row in first["sampled_leagues"]]
    second_ids = [row["league_id"] for row in second["sampled_leagues"]]
    assert first_ids != second_ids