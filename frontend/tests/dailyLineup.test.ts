import { describe, expect, test } from "vitest";
import {
  estimatedLineupPoints,
  optimizeLineup,
  recommendationForLineupRow
} from "../src/dailyLineup";
import type { LineupRecommendationGame, LineupRecommendationRow } from "../src/types";

function game(gameNumber: number, xfipMinus: number | null = 100): LineupRecommendationGame {
  return {
    game_key: `TOR-${gameNumber}`,
    game_number: gameNumber,
    opponent_team: "BOS",
    opponent_name: "Boston Red Sox",
    opposing_pitcher_key: `pitcher-${gameNumber}`,
    opposing_pitcher_name: `Pitcher ${gameNumber}`,
    opposing_pitcher_xfip_minus: xfipMinus
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

  test("availability takes precedence over either saved preference", () => {
    const row = hitter("off-day", {
      games: [],
      opponent_team: null,
      plays_today: false
    });

    expect(recommendationForLineupRow(row, true, false).code).toBe("no-game");
    expect(recommendationForLineupRow(row, false, true).code).toBe("no-game");
  });
});
