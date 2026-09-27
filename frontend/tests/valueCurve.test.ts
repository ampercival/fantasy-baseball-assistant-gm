import { describe, expect, test } from "vitest";
import { fittedValue as fitterValue } from "../../supabase/functions/_shared/value-curve";
import type { FantasyLeague, LeagueValueCurve, PlatformValueCurve } from "../src/types";
import {
  buildLeagueValueCurveExport,
  fittedFantasyValue,
  LEAGUE_VALUE_CURVE_EXPORT_FORMAT,
  leagueValueCurveExportFilename,
  parseLeagueValueCurveExport
} from "../src/valueCurve";

const parameters = { c: 1, A: 51, m: 100, s: 2, g: 1, D: 10, k: 0.1 };

const curve: LeagueValueCurve = {
  parameters,
  player_count: 3,
  rmse: 0.5,
  source_snapshot_max_id: 42,
  model_version: 1,
  generated_at: "2026-09-27T09:15:00+00:00"
};

const platformCurve = {
  parameters: { c: 0.5, A: 60, m: 80, s: 1.5, g: 1.2, D: 5, k: 0.05 },
  points: [{ rank: 1, salary: 60, sample_count: 12 }],
  sampled_leagues: [],
  failed_leagues: [],
  sample_size: 12,
  successful_league_count: 12,
  attempted_league_count: 12,
  rank_count: 480,
  observation_count: 5000,
  rmse: 0.8,
  model_version: 1,
  generated_at: "2026-09-27T07:00:00+00:00"
} satisfies PlatformValueCurve;

const league = {
  league_uid: "ottoneu:1900",
  league_name: "Aspromonte",
  url: "https://ottoneu.fangraphs.com/1900/home",
  my_team_uid: "ottoneu:1900:12519",
  team_count: 12
} as FantasyLeague;

const fitPoints = [
  { rank: 1, observedSalary: 62, playerName: "Shohei Ohtani", teamName: "Team, One" },
  { rank: 2, observedSalary: 55, playerName: "Juan Soto", teamName: "Team Two" },
  { rank: 3, observedSalary: 49, playerName: "Bobby Witt Jr.", teamName: "Team Three" }
];

describe("fittedFantasyValue", () => {
  test("evaluates the curve formula", () => {
    // Rank 1: 1 + 50 / (1 + 0.01^2) + 10 * e^0. Rank 100: 1 + 50 / 2 + 10 * e^-9.9.
    expect(fittedFantasyValue(1, curve)).toBeCloseTo(11 + 50 / 1.0001, 9);
    expect(fittedFantasyValue(100, curve)).toBeCloseTo(26 + 10 * Math.exp(-9.9), 9);
  });

  test("matches the evaluator the fitter optimizes", () => {
    for (const rank of [1, 2, 10, 50, 120, 300, 480]) {
      expect(fittedFantasyValue(rank, curve)).toBeCloseTo(fitterValue(rank, parameters), 9);
      expect(fittedFantasyValue(rank, platformCurve)).toBeCloseTo(fitterValue(rank, platformCurve.parameters), 9);
    }
  });
});

describe("league value curve export", () => {
  const exported = buildLeagueValueCurveExport({
    curve,
    exportedAt: "2026-09-27T12:00:00.000Z",
    fitPoints,
    league,
    platformCurve
  });

  test("carries the fit, its data, and the platform benchmark without unrelated league fields", () => {
    expect(exported).toEqual({
      format: LEAGUE_VALUE_CURVE_EXPORT_FORMAT,
      format_version: 1,
      exported_at: "2026-09-27T12:00:00.000Z",
      formula: "value(rank) = c + (A - c) / (1 + (rank / m)^s)^g + D * exp(-k * (rank - 1))",
      league: { league_uid: "ottoneu:1900", league_name: "Aspromonte", url: "https://ottoneu.fangraphs.com/1900/home" },
      curve,
      fit_points: [
        { rank: 1, salary: 62, player_name: "Shohei Ohtani", team_name: "Team, One" },
        { rank: 2, salary: 55, player_name: "Juan Soto", team_name: "Team Two" },
        { rank: 3, salary: 49, player_name: "Bobby Witt Jr.", team_name: "Team Three" }
      ],
      platform_curve: {
        parameters: platformCurve.parameters,
        rank_count: 480,
        rmse: 0.8,
        successful_league_count: 12,
        model_version: 1,
        generated_at: "2026-09-27T07:00:00+00:00"
      }
    });
  });

  test("round-trips through a file and reproduces the same dollar values", () => {
    const uploaded = parseLeagueValueCurveExport(JSON.stringify(exported, null, 2));

    expect(uploaded).toEqual(exported);
    for (const rank of [1, 25, 250, 480]) {
      expect(fittedFantasyValue(rank, uploaded.curve)).toBe(fittedFantasyValue(rank, curve));
    }
  });

  test("exports a league with no platform curve", () => {
    const withoutPlatform = buildLeagueValueCurveExport({ curve, fitPoints, league, platformCurve: null });

    expect(withoutPlatform.platform_curve).toBeNull();
    expect(parseLeagueValueCurveExport(JSON.stringify(withoutPlatform)).platform_curve).toBeNull();
  });

  test("rejects files that are not a usable curve export", () => {
    const withParameters = (curveParameters: unknown) =>
      JSON.stringify({ ...exported, curve: { ...exported.curve, parameters: curveParameters } });

    expect(() => parseLeagueValueCurveExport("rank,value")).toThrow("not valid JSON");
    expect(() => parseLeagueValueCurveExport(JSON.stringify({ ...exported, format: "other" }))).toThrow(
      "not a league value curve export"
    );
    expect(() => parseLeagueValueCurveExport(JSON.stringify({ ...exported, format_version: 2 }))).toThrow(
      "Unsupported league value curve export version: 2"
    );
    expect(() => parseLeagueValueCurveExport(withParameters({ ...parameters, k: "0.1" }))).toThrow("league curve");
    expect(() => parseLeagueValueCurveExport(withParameters({ c: 1, A: 51 }))).toThrow("league curve");
    expect(() => parseLeagueValueCurveExport(JSON.stringify({ ...exported, platform_curve: { rank_count: 480 } }))).toThrow(
      "platform curve"
    );
  });
});

test("names the file after the league and the fit date", () => {
  expect(leagueValueCurveExportFilename("Aspromonte", "2026-09-27T09:15:00+00:00")).toBe(
    "aspromonte-value-curve-2026-09-27.json"
  );
  expect(leagueValueCurveExportFilename("Liga Peña: Dynasty!", "2026-09-27")).toBe("liga-pena-dynasty-value-curve-2026-09-27.json");
  expect(leagueValueCurveExportFilename("!!!", "not a date")).toBe("league-value-curve.json");
});
