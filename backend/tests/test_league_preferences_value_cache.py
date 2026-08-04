import pytest
from fastapi import HTTPException

from app import main


CURVE = {
    "parameters": {"c": 1.0, "A": 40.0, "m": 20.0, "s": 1.5, "g": 1.0, "D": 20.0, "k": 0.05},
    "player_count": 12,
    "rmse": 0.75,
}


def cached_curve(snapshot_id: int = 77, model_version: int = 1) -> dict:
    return {
        **CURVE,
        "league_uid": "ottoneu:1900",
        "source_snapshot_max_id": snapshot_id,
        "model_version": model_version,
        "generated_at": "2026-08-04T12:00:00+00:00",
    }


def test_current_league_value_curve_uses_fresh_cache(monkeypatch):
    monkeypatch.setattr(main, "get_league_roster_snapshot_max_id", lambda _league_uid: 77)
    monkeypatch.setattr(main, "get_league_value_curve", lambda _league_uid: cached_curve())
    monkeypatch.setattr(
        main,
        "rebuild_league_value_curve_cache",
        lambda *_args, **_kwargs: pytest.fail("fresh cache should not be rebuilt"),
    )

    result = main.current_league_value_curve("ottoneu:1900", [{"salary": 10}])

    assert result is not None
    assert result["source_snapshot_max_id"] == 77
    assert result["generated_at"] == "2026-08-04T12:00:00+00:00"


def test_current_league_value_curve_rebuilds_stale_cache(monkeypatch):
    players = [{"salary": 10}]
    monkeypatch.setattr(main, "get_league_roster_snapshot_max_id", lambda _league_uid: 78)
    monkeypatch.setattr(main, "get_league_value_curve", lambda _league_uid: cached_curve(snapshot_id=77))
    monkeypatch.setattr(
        main,
        "rebuild_league_value_curve_cache",
        lambda league_uid, *, players=None: {"league_uid": league_uid, "players": players},
    )

    result = main.current_league_value_curve("ottoneu:1900", players)

    assert result == {"league_uid": "ottoneu:1900", "players": players}


def test_rebuild_league_value_curve_cache_persists_model_metadata(monkeypatch):
    saved: dict = {}
    monkeypatch.setattr(main, "build_league_value_curve", lambda _players: CURVE)
    monkeypatch.setattr(main, "get_league_roster_snapshot_max_id", lambda _league_uid: 91)

    def fake_save(league_uid, curve, **metadata):
        saved.update({"league_uid": league_uid, "curve": curve, **metadata})
        return {"league_uid": league_uid, **curve, **metadata}

    monkeypatch.setattr(main, "save_league_value_curve", fake_save)

    result = main.rebuild_league_value_curve_cache(
        "ottoneu:1900",
        players=[{"salary": 10}],
        generated_at="2026-08-04T13:00:00+00:00",
    )

    assert saved["source_snapshot_max_id"] == 91
    assert saved["model_version"] == main.LEAGUE_VALUE_CURVE_MODEL_VERSION
    assert result is not None
    assert result["generated_at"] == "2026-08-04T13:00:00+00:00"


def test_update_league_my_team_validates_membership_and_persists(monkeypatch):
    writes: list[tuple[str, str | None]] = []
    monkeypatch.setattr(main, "get_league", lambda _league_uid: {"league_uid": "ottoneu:1900"})
    monkeypatch.setattr(
        main,
        "get_league_memberships",
        lambda _league_uid: [{"team_uid": "ottoneu:1900:12519"}],
    )
    monkeypatch.setattr(main, "set_league_my_team", lambda league_uid, team_uid: writes.append((league_uid, team_uid)))

    response = main.update_league_my_team(
        "ottoneu:1900",
        main.LeagueMyTeamRequest(team_uid="ottoneu:1900:12519"),
    )

    assert response["team_uid"] == "ottoneu:1900:12519"
    assert writes == [("ottoneu:1900", "ottoneu:1900:12519")]

    with pytest.raises(HTTPException) as error:
        main.update_league_my_team("ottoneu:1900", main.LeagueMyTeamRequest(team_uid="other-team"))
    assert error.value.status_code == 422
