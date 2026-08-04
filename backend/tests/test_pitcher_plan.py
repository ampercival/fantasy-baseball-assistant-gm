from app.main import PitcherPlanData, PitcherPlanRequest, save_pitcher_plan


def test_pitcher_plan_save_normalizes_targets_and_player_lists(monkeypatch):
    monkeypatch.setattr(
        "app.main.get_league_memberships",
        lambda _league_uid: [{"team_uid": "ottoneu:1900:12519"}],
    )
    captured = {}

    def fake_upsert(**kwargs):
        captured.update(kwargs)
        return {
            **kwargs,
            "created_at": kwargs["timestamp"],
            "updated_at": kwargs["timestamp"],
        }

    monkeypatch.setattr("app.main.upsert_pitcher_plan", fake_upsert)
    request = PitcherPlanRequest(
        league_uid="ottoneu:1900",
        team_uid="ottoneu:1900:12519",
        plan=PitcherPlanData(
            spTarget=25,
            bubbleTarget=22,
            rpTarget=-4,
            selectedSpKeys=["starter-1", "starter-1", "starter-2"],
            bubbleSpKeys=["starter-1", "bubble-1", "bubble-1"],
            selectedRpKeys=["reliever-1", "reliever-1"],
            usageOverrides={
                "starter-1": "SP",
                "dual-1": "Mixed - RP",
                "bad-role": "Closer",
                " ": "RP",
            },
        ),
    )

    response = save_pitcher_plan(request)

    assert captured["sp_target"] == 20
    assert captured["bubble_target"] == 20
    assert captured["rp_target"] == 0
    assert captured["selected_sp_keys"] == ["starter-1", "starter-2"]
    assert captured["bubble_sp_keys"] == ["bubble-1"]
    assert captured["selected_rp_keys"] == ["reliever-1"]
    assert response["plan"]["selectedSpKeys"] == ["starter-1", "starter-2"]
    assert captured["usage_overrides"] == {"starter-1": "SP", "dual-1": "Mixed - RP"}
    assert response["plan"]["usageOverrides"] == {"starter-1": "SP", "dual-1": "Mixed - RP"}
