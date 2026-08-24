import { describe, expect, test } from "vitest";
import {
  estimatedLineupPoints,
  formatLineupCacheAge,
  lineupCacheAgeHours,
  lineupGames,
  lineupXfipConfidenceLabel,
  lineupXfipProvenanceLabel,
  matchupAssessmentForLineupRow,
  optimizeLineup,
} from "../src/dailyLineup";
import type { LineupRecommendationGame, LineupRecommendationRow } from "../src/types";

function game(
  gameNumber: number,
  xfipMinus: number | null = 100,
  adjustedXfipMinus: number | null = xfipMinus
): LineupRecommendationGame {
  return {
    game_key: `TOR-${gameNumber}`,
    game_number: gameNumber,
    opponent_team: "BOS",
    opponent_name: "Boston Red Sox",
    opposing_pitcher_key: `pitcher-${gameNumber}`,
    opposing_pitcher_name: `Pitcher ${gameNumber}`,
    opposing_pitcher_xfip_minus: xfipMinus,
    opposing_pitcher_adjusted_xfip_minus: adjustedXfipMinus,
    opposing_pitcher_xfip_provenance: xfipMinus === null ? "missing" : "home-worker-cache",
    opposing_pitcher_xfip_confidence: xfipMinus === null ? "missing" : "high",
    opposing_pitcher_xfip_source: xfipMinus === null ? null : "FanGraphs leaderboard"
  };
}

function hitter(
  playerKey: string,
  overrides: Partial<LineupRecommendationRow> = {}
): LineupRecommendationRow {
  return {
    player_key: playerKey,
    player_name: playerKey,
    positions: "SS",
    mlb_team: "TOR",
    status: null,
    section: "hitter",
    salary: 10,
    points: 500,
    points_per_game: 5,
    plays_today: true,
    games: [game(1)],
    opponent_team: "BOS",
    opponent_name: "Boston Red Sox",
    opposing_pitcher_key: "pitcher-1",
    opposing_pitcher_name: "Pitcher 1",
    opposing_pitcher_xfip_minus: 100,
    recommendation: "Neutral",
    recommendation_code: "neutral",
    always_start: false,
    always_sit: false,
    ...overrides
  };
}

describe("daily lineup projections", () => {
  test("preserves the legacy single-game estimate", () => {
    const legacy = hitter("legacy", { games: [] });
    const current = hitter("current", { games: [game(1)] });

    expect(estimatedLineupPoints(legacy)).toBe(5);
    expect(estimatedLineupPoints(current)).toBe(5);
  });

  test("sums every doubleheader game and applies each starter independently", () => {
    const row = hitter("doubleheader", { games: [game(1, 80), game(2, 120)] });

    expect(estimatedLineupPoints(row)).toBe(10);
  });

  test("uses neutral 100 only for the game whose xFIP is missing", () => {
    const row = hitter("partial-xfip", { games: [game(1, 120), game(2, null)] });

    expect(estimatedLineupPoints(row)).toBe(11);
  });

  test("uses workload-adjusted xFIP instead of the raw small-sample value", () => {
    const rawEliteButSmallSample = hitter("small-sample", { games: [game(1, 60, 90)] });
    const rawPoorButSmallSample = hitter("small-sample-poor", { games: [game(1, 140, 110)] });

    expect(estimatedLineupPoints(rawEliteButSmallSample)).toBe(4.5);
    expect(estimatedLineupPoints(rawPoorButSmallSample)).toBe(5.5);
    expect(matchupAssessmentForLineupRow(rawEliteButSmallSample)).toEqual({ code: "neutral", label: "Neutral" });
    expect(matchupAssessmentForLineupRow(rawPoorButSmallSample)).toEqual({ code: "neutral", label: "Neutral" });
  });
});

describe("daily lineup hard eligibility", () => {
  test("warns when the available roster cannot fill every lineup slot", () => {
    const rows = [
      hitter("only-catcher", { positions: "C" }),
      hitter("first-base", { positions: "1B" }),
      hitter("second-base-1", { positions: "2B" }),
      hitter("second-base-2", { positions: "2B" }),
      hitter("shortstop", { positions: "SS" }),
      hitter("third-base", { positions: "3B" }),
      ...[1, 2, 3, 4, 5].map((index) => hitter(`outfielder-${index}`, { positions: "OF" })),
      hitter("designated-hitter", { positions: "DH" })
    ];

    const result = optimizeLineup(rows);

    expect(result.starterCount).toBe(12);
    expect(result.missingSlotWarning).toContain("1 of 13 lineup slot is unfilled (C)");
    expect(result.missingSlotWarning).toContain("cannot fill every slot for this date");
    expect(result.lockWarning).toBe("");
  });

  test("keeps an incompatible lock warning separate from lineup feasibility", () => {
    const catcherLocks = [1, 2, 3, 4].map((index) =>
      hitter(`catcher-${index}`, {
        always_start: true,
        player_name: `Catcher ${index}`,
        positions: "C"
      })
    );
    const rows = [
      ...catcherLocks,
      hitter("first-base", { positions: "1B" }),
      hitter("second-base-1", { positions: "2B" }),
      hitter("second-base-2", { positions: "2B" }),
      hitter("shortstop", { positions: "SS" }),
      hitter("third-base", { positions: "3B" }),
      ...[1, 2, 3, 4, 5].map((index) => hitter(`outfielder-${index}`, { positions: "OF" }))
    ];

    const result = optimizeLineup(rows);

    expect(result.starterCount).toBe(13);
    expect(result.missingSlotWarning).toBe("");
    expect(result.lockWarning).toContain("Locked players could not all be assigned");
    expect(result.lockWarning).toMatch(/Catcher [1-4]/);
  });

  test("does not assign an off-day Always Start player", () => {
    const offDay = hitter("off-day-lock", {
      always_start: true,
      games: [],
      opponent_name: null,
      opponent_team: null,
      opposing_pitcher_key: null,
      opposing_pitcher_name: null,
      opposing_pitcher_xfip_minus: null,
      plays_today: false,
      points_per_game: 20,
      recommendation: "No game",
      recommendation_code: "no-game"
    });
    const playable = hitter("playable", { points_per_game: 1 });

    const result = optimizeLineup([offDay, playable]);

    expect(result.assignments.has("off-day-lock")).toBe(false);
    expect(result.assignments.has("playable")).toBe(true);
    expect(result.warning).toContain("off-day-lock");
  });

  test("keeps a playable lock even when unlocked alternatives project higher", () => {
    const rows = [
      hitter("locked", { always_start: true, points_per_game: 1 }),
      ...[1, 2, 3].map((index) => hitter(`unlocked-${index}`, { points_per_game: 20 - index }))
    ];

    const result = optimizeLineup(rows);

    expect(result.assignments.has("locked")).toBe(true);
  });

  test("keeps the largest compatible lock set instead of discarding every lock", () => {
    const catcherLocks = [1, 2, 3, 4].map((index) =>
      hitter(`catcher-${index}`, {
        always_start: true,
        player_name: `Catcher ${index}`,
        points_per_game: index,
        positions: "C"
      })
    );
    const firstBaseLock = hitter("first-base-lock", {
      always_start: true,
      points_per_game: 1,
      positions: "1B"
    });

    const result = optimizeLineup([...catcherLocks, firstBaseLock]);

    expect(result.assignments.has("first-base-lock")).toBe(true);
    expect(catcherLocks.filter((row) => result.assignments.has(row.player_key))).toHaveLength(3);
    expect(result.assignments.has("catcher-1")).toBe(false);
    expect(result.warning).toContain("Catcher 1");
  });

  test("keeps Always Sit players ineligible", () => {
    const result = optimizeLineup([
      hitter("sit", { always_sit: true, points_per_game: 20 }),
      hitter("start", { points_per_game: 1 })
    ]);

    expect(result.assignments.has("sit")).toBe(false);
    expect(result.assignments.has("start")).toBe(true);
  });

  test("excludes missing P/G instead of silently treating it as zero", () => {
    const result = optimizeLineup([
      hitter("unknown", { always_start: true, points_per_game: null }),
      hitter("known", { points_per_game: 1 })
    ]);

    expect(result.assignments.has("unknown")).toBe(false);
    expect(result.assignments.has("known")).toBe(true);
    expect(result.warning).toContain("no P/G projection: unknown");
  });

  test("reports matchup states independently of saved preferences", () => {
    expect(matchupAssessmentForLineupRow(hitter("favorable", { games: [game(1, 111)] })).code).toBe("favorable");
    expect(matchupAssessmentForLineupRow(hitter("tough", { always_start: true, games: [game(1, 89)] })).code).toBe("tough");
    expect(matchupAssessmentForLineupRow(hitter("neutral", { always_sit: true, games: [game(1, 100)] })).code).toBe("neutral");
    expect(matchupAssessmentForLineupRow(hitter("no-xfip", { games: [game(1, null)] })).code).toBe("no-xfip");

    const noProbable = game(1);
    noProbable.opposing_pitcher_name = null;
    expect(matchupAssessmentForLineupRow(hitter("no-probable", { games: [noProbable] })).code).toBe("no-probable");

    const row = hitter("off-day", {
      games: [],
      opponent_team: null,
      plays_today: false,
      always_start: true
    });

    expect(matchupAssessmentForLineupRow(row).code).toBe("no-game");
  });

  test("can start a tough matchup and bench a favorable one", () => {
    const toughStar = hitter("tough-star", { games: [game(1, 80)], points_per_game: 20, positions: "OF" });
    const favorableBench = hitter("favorable-bench", { games: [game(1, 120)], points_per_game: 1, positions: "OF" });
    const neutralOutfielders = [1, 2, 3, 4, 5].map((index) =>
      hitter(`neutral-${index}`, { games: [game(1, 100)], points_per_game: 10, positions: "OF" })
    );

    const result = optimizeLineup([toughStar, favorableBench, ...neutralOutfielders]);

    expect(result.assignments.has("tough-star")).toBe(true);
    expect(matchupAssessmentForLineupRow(toughStar).code).toBe("tough");
    expect(result.assignments.has("favorable-bench")).toBe(false);
    expect(matchupAssessmentForLineupRow(favorableBench).code).toBe("favorable");
  });
});

describe("lineup data context", () => {
  test("formats xFIP provenance as compact user-facing labels", () => {
    expect(lineupXfipProvenanceLabel("home-worker-cache")).toBe("Cache");
    expect(lineupXfipProvenanceLabel("live-fangraphs")).toBe("Live");
    expect(lineupXfipProvenanceLabel("saved-reference")).toBe("Saved");
    expect(lineupXfipProvenanceLabel("missing")).toBe("Missing");
    expect(lineupXfipConfidenceLabel("high")).toBe("High");
    expect(lineupXfipConfidenceLabel("medium")).toBe("Medium");
    expect(lineupXfipConfidenceLabel("low")).toBe("Low");
    expect(lineupXfipConfidenceLabel("missing")).toBe("Missing");
  });

  test("normalizes pre-provenance game arrays during an Edge and Pages rollout", () => {
    const legacyGame = {
      ...game(1, 95),
      opposing_pitcher_xfip_provenance: undefined,
      opposing_pitcher_xfip_confidence: undefined,
      opposing_pitcher_xfip_source: undefined
    } as unknown as LineupRecommendationGame;
    const [normalized] = lineupGames(hitter("legacy", { games: [legacyGame] }));

    expect(normalized.opposing_pitcher_xfip_provenance).toBe("saved-reference");
    expect(normalized.opposing_pitcher_xfip_confidence).toBe("high");
    expect(normalized.opposing_pitcher_xfip_source).toBeNull();
  });

  test("formats deterministic cache ages", () => {
    const now = new Date("2026-08-22T16:00:00.000Z");

    expect(lineupCacheAgeHours("2026-08-22T15:30:00.000Z", now)).toBe(0.5);
    expect(formatLineupCacheAge(0.5)).toBe("30m old");
    expect(formatLineupCacheAge(2.25)).toBe("2.3h old");
    expect(formatLineupCacheAge(48)).toBe("2d old");
    expect(formatLineupCacheAge(null)).toBe("age unknown");
  });
});
