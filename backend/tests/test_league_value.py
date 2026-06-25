from app.league_value import build_league_value_curve, fitted_value, salary_rank_points


def test_salary_rank_points_assigns_unique_ranks_for_tied_salaries():
    rows = [
        {"player_name": "Player C", "team_name": "Team 2", "player_key": "c", "salary": 1},
        {"player_name": "Player A", "team_name": "Team 1", "player_key": "a", "salary": 5},
        {"player_name": "Player B", "team_name": "Team 1", "player_key": "b", "salary": 5},
    ]

    assert salary_rank_points(rows) == [(1, 5.0), (2, 5.0), (3, 1.0)]


def test_fitted_value_uses_composite_decay_formula():
    parameters = {"c": 1, "A": 41, "m": 10, "s": 2, "g": 1, "D": 20, "k": 0.5}

    assert round(fitted_value(1, parameters), 4) == round(1 + 40 / (1 + 0.1**2) + 20, 4)


def test_build_league_value_curve_fits_salary_distribution():
    rows = [
        {"player_name": f"Player {index}", "team_name": "Team", "player_key": str(index), "salary": salary}
        for index, salary in enumerate([80, 68, 55, 45, 38, 30, 24, 20, 16, 13, 10, 8, 6, 5, 4, 3, 2, 1], start=1)
    ]

    curve = build_league_value_curve(rows)

    assert curve is not None
    assert curve["player_count"] == 18
    assert curve["parameters"]["c"] >= 1
    assert fitted_value(1, curve["parameters"]) > fitted_value(18, curve["parameters"])
