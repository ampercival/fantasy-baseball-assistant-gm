from __future__ import annotations

import random
from collections import defaultdict
from typing import Callable, Iterable

from .league_value import fit_value_curve, fitted_value
from .ottoneu import OttoneuLeagueDirectoryEntry
from .scrapers import ScrapeError


PLATFORM_VALUE_CURVE_MODEL_VERSION = 1


def aggregate_salary_rank_points(
    league_salaries: Iterable[Iterable[float]],
) -> tuple[list[dict], int]:
    """Average each salary rank across leagues, giving every league equal weight."""
    salaries_by_rank: dict[int, list[float]] = defaultdict(list)
    observation_count = 0
    for salaries in league_salaries:
        ranked = sorted((float(value) for value in salaries), reverse=True)
        observation_count += len(ranked)
        for rank, salary in enumerate(ranked, start=1):
            salaries_by_rank[rank].append(salary)
    points = [
        {
            "rank": rank,
            "salary": round(sum(values) / len(values), 4),
            "sample_count": len(values),
        }
        for rank, values in sorted(salaries_by_rank.items())
    ]
    return points, observation_count


def build_platform_value_curve(league_salaries: Iterable[Iterable[float]]) -> dict | None:
    points, observation_count = aggregate_salary_rank_points(league_salaries)
    if len(points) < 8:
        return None
    fit_points = [(int(point["rank"]), float(point["salary"])) for point in points]
    parameters = fit_value_curve(fit_points)
    errors = [fitted_value(rank, parameters) - salary for rank, salary in fit_points]
    rmse = (sum(error * error for error in errors) / len(errors)) ** 0.5
    return {
        "parameters": {name: round(value, 6) for name, value in parameters.items()},
        "points": points,
        "rank_count": len(points),
        "observation_count": observation_count,
        "rmse": round(rmse, 4),
    }


def sample_platform_leagues(
    directory: Iterable[OttoneuLeagueDirectoryEntry],
    sample_size: int,
    fetch_salaries: Callable[[int], list[float]],
    *,
    rng: random.Random | random.SystemRandom | None = None,
) -> dict:
    """Shuffle the directory on every run and keep drawing until N usable leagues succeed."""
    if sample_size < 1:
        raise ValueError("sample_size must be at least 1")
    candidates = list(directory)
    if sample_size > len(candidates):
        raise ScrapeError(f"Requested {sample_size} leagues, but Ottoneu currently lists only {len(candidates)}.")
    (rng or random.SystemRandom()).shuffle(candidates)
    sampled: list[dict] = []
    failed: list[dict] = []
    league_salaries: list[list[float]] = []
    for league in candidates:
        if len(sampled) >= sample_size:
            break
        try:
            salaries = [float(value) for value in fetch_salaries(league.league_id)]
            if len(salaries) < 8:
                raise ScrapeError("Roster export contained fewer than eight salary rows.")
        except Exception as exc:  # noqa: BLE001 - failed candidates are replaced from the shuffled pool
            failed.append({"league_id": league.league_id, "league_name": league.league_name, "message": str(exc)})
            continue
        sampled.append(
            {
                "league_id": league.league_id,
                "league_name": league.league_name,
                "game_type": league.game_type,
                "player_count": len(salaries),
                "url": f"https://ottoneu.fangraphs.com/{league.league_id}/home",
            }
        )
        league_salaries.append(salaries)
    if len(sampled) < sample_size:
        raise ScrapeError(
            f"Only {len(sampled)} of {sample_size} required Ottoneu leagues returned usable roster exports."
        )
    curve = build_platform_value_curve(league_salaries)
    if not curve:
        raise ScrapeError("The sampled Ottoneu salaries could not produce a value curve.")
    return {
        **curve,
        "sampled_leagues": sampled,
        "failed_leagues": failed,
        "sample_size": sample_size,
        "successful_league_count": len(sampled),
        "attempted_league_count": len(sampled) + len(failed),
    }
