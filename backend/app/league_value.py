from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Iterable


PARAMETER_NAMES = ("c", "A", "m", "s", "g", "D", "k")


@dataclass(frozen=True)
class ValueCurve:
    parameters: dict[str, float]
    player_count: int
    rmse: float


def build_league_value_curve(roster_rows: Iterable[dict]) -> dict | None:
    points = salary_rank_points(roster_rows)
    if len(points) < 8:
        return None
    parameters = fit_value_curve(points)
    errors = [fitted_value(rank, parameters) - salary for rank, salary in points]
    rmse = math.sqrt(sum(error * error for error in errors) / len(errors))
    return {
        "parameters": {name: round(parameters[name], 6) for name in PARAMETER_NAMES},
        "player_count": len(points),
        "rmse": round(rmse, 4),
    }


def salary_rank_points(roster_rows: Iterable[dict]) -> list[tuple[int, float]]:
    sorted_rows = sorted(
        (row for row in roster_rows if row.get("salary") is not None),
        key=lambda row: (
            -float(row["salary"]),
            str(row.get("team_name") or ""),
            str(row.get("player_name") or ""),
            str(row.get("player_key") or ""),
        ),
    )
    return [(index, float(row["salary"])) for index, row in enumerate(sorted_rows, start=1)]


def fitted_value(rank: float, parameters: dict[str, float]) -> float:
    c = parameters["c"]
    a = parameters["A"]
    m = parameters["m"]
    s = parameters["s"]
    g = parameters["g"]
    d = parameters["D"]
    k = parameters["k"]
    main_curve = c + (a - c) / ((1 + (rank / m) ** s) ** g)
    elite_bump = d * math.exp(-k * (rank - 1))
    return main_curve + elite_bump


def fit_value_curve(points: list[tuple[int, float]]) -> dict[str, float]:
    n = len(points)
    salaries = [salary for _, salary in points]
    min_salary = min(salaries)
    max_salary = max(salaries)
    starts = initial_vectors(salaries)
    best_vector = starts[0]
    best_score = math.inf
    for start in starts:
        vector, score = nelder_mead(
            lambda candidate: objective(candidate, points, n=n, min_salary=min_salary, max_salary=max_salary),
            start,
            step=(0.18, 0.35, 0.45, 0.28, 0.28, 0.55, 0.45),
            max_iter=650,
        )
        if score < best_score:
            best_vector = vector
            best_score = score
    return vector_to_parameters(best_vector)


def initial_vectors(salaries: list[float]) -> list[tuple[float, ...]]:
    n = len(salaries)
    min_salary = min(salaries)
    max_salary = max(salaries)
    c = max(0.25, min_salary)
    p10 = salaries[min(n - 1, max(0, int(n * 0.10) - 1))]
    p25 = salaries[min(n - 1, max(0, int(n * 0.25) - 1))]
    elite_bump = max(0.25, max_salary - p10)
    starts: list[tuple[float, ...]] = []
    for m_scale, steepness, tail_shape, bump_scale, decay in (
        (0.18, 1.2, 1.0, 0.7, 0.045),
        (0.28, 1.7, 1.0, 1.0, 0.070),
        (0.40, 2.2, 0.8, 0.5, 0.035),
        (0.55, 1.4, 1.4, 1.4, 0.095),
    ):
        m = max(1.0, n * m_scale)
        d = max(0.10, elite_bump * bump_scale)
        a = max(c + 0.25, max_salary - d)
        if a < p25:
            a = p25
        starts.append(parameters_to_vector({"c": c, "A": a, "m": m, "s": steepness, "g": tail_shape, "D": d, "k": decay}))
    return starts


def objective(vector: tuple[float, ...], points: list[tuple[int, float]], *, n: int, min_salary: float, max_salary: float) -> float:
    parameters = vector_to_parameters(vector)
    penalty = parameter_penalty(parameters, n=n, min_salary=min_salary, max_salary=max_salary)
    if penalty:
        return penalty
    try:
        errors = [fitted_value(rank, parameters) - salary for rank, salary in points]
    except (OverflowError, ValueError):
        return 1e12
    if any(not math.isfinite(error) for error in errors):
        return 1e12
    return sum(error * error for error in errors) / len(errors)


def parameter_penalty(parameters: dict[str, float], *, n: int, min_salary: float, max_salary: float) -> float:
    c = parameters["c"]
    a = parameters["A"]
    m = parameters["m"]
    s = parameters["s"]
    g = parameters["g"]
    d = parameters["D"]
    k = parameters["k"]
    if not all(math.isfinite(value) for value in parameters.values()):
        return 1e12
    floor = max(0.001, min_salary if min_salary > 0 else 0.001)
    if not (floor <= c <= max(5.0, max_salary * 2.0)):
        return 1e11 + abs(c) * 1e6
    if not (c <= a <= max_salary * 4.0 + 20):
        return 1e11 + abs(a) * 1e6
    if not (0.5 <= m <= n * 6.0):
        return 1e11 + abs(m) * 1e6
    if not (0.05 <= s <= 12.0):
        return 1e11 + abs(s) * 1e6
    if not (0.05 <= g <= 12.0):
        return 1e11 + abs(g) * 1e6
    if not (0.0 <= d <= max_salary * 4.0 + 20):
        return 1e11 + abs(d) * 1e6
    if not (0.0001 <= k <= 3.0):
        return 1e11 + abs(k) * 1e6
    return 0.0


def parameters_to_vector(parameters: dict[str, float]) -> tuple[float, ...]:
    c = max(parameters["c"], 1e-9)
    height = max(parameters["A"] - c, 1e-9)
    return (
        math.log(c),
        math.log(height),
        math.log(max(parameters["m"], 1e-9)),
        math.log(max(parameters["s"], 1e-9)),
        math.log(max(parameters["g"], 1e-9)),
        math.log(max(parameters["D"], 1e-9)),
        math.log(max(parameters["k"], 1e-9)),
    )


def vector_to_parameters(vector: tuple[float, ...]) -> dict[str, float]:
    c = safe_exp(vector[0])
    height = safe_exp(vector[1])
    return {
        "c": c,
        "A": c + height,
        "m": safe_exp(vector[2]),
        "s": safe_exp(vector[3]),
        "g": safe_exp(vector[4]),
        "D": safe_exp(vector[5]),
        "k": safe_exp(vector[6]),
    }


def safe_exp(value: float) -> float:
    if value > 50:
        return math.exp(50)
    if value < -50:
        return math.exp(-50)
    return math.exp(value)


def nelder_mead(
    func,
    start: tuple[float, ...],
    *,
    step: tuple[float, ...],
    max_iter: int,
    tolerance: float = 1e-7,
) -> tuple[tuple[float, ...], float]:
    dimension = len(start)
    simplex = [start]
    for index in range(dimension):
        candidate = list(start)
        candidate[index] += step[index]
        simplex.append(tuple(candidate))
    values = [func(candidate) for candidate in simplex]

    for _ in range(max_iter):
        order = sorted(range(len(simplex)), key=lambda index: values[index])
        simplex = [simplex[index] for index in order]
        values = [values[index] for index in order]
        if statistics.pstdev(values) < tolerance:
            break

        centroid = tuple(
            sum(vertex[axis] for vertex in simplex[:-1]) / dimension
            for axis in range(dimension)
        )
        worst = simplex[-1]
        reflected = tuple(centroid[axis] + (centroid[axis] - worst[axis]) for axis in range(dimension))
        reflected_value = func(reflected)

        if values[0] <= reflected_value < values[-2]:
            simplex[-1] = reflected
            values[-1] = reflected_value
            continue

        if reflected_value < values[0]:
            expanded = tuple(centroid[axis] + 2.0 * (reflected[axis] - centroid[axis]) for axis in range(dimension))
            expanded_value = func(expanded)
            if expanded_value < reflected_value:
                simplex[-1] = expanded
                values[-1] = expanded_value
            else:
                simplex[-1] = reflected
                values[-1] = reflected_value
            continue

        contracted = tuple(centroid[axis] + 0.5 * (worst[axis] - centroid[axis]) for axis in range(dimension))
        contracted_value = func(contracted)
        if contracted_value < values[-1]:
            simplex[-1] = contracted
            values[-1] = contracted_value
            continue

        best = simplex[0]
        simplex = [
            best,
            *[
                tuple(best[axis] + 0.5 * (vertex[axis] - best[axis]) for axis in range(dimension))
                for vertex in simplex[1:]
            ],
        ]
        values = [func(candidate) for candidate in simplex]

    best_index = min(range(len(simplex)), key=lambda index: values[index])
    return simplex[best_index], values[best_index]
