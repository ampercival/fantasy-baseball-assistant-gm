import { describe, expect, test } from "vitest";
import {
  analyzeHitterTradeImpact,
  analyzePitcherTradeImpact,
  buildHitterLineupSnapshot,
  effectivePitcherUsage,
  optimalHitterFromTradePlayer,
  projectPitcherBuckets,
  type HitterImpactPlayer,
  type PitcherImpactPlayer
} from "../src/tradeImpact";
import type { TradePlayerRow } from "../src/tradeAnalysis";
import type { OptimalLineupHitter, PitcherUsageRole } from "../src/types";

function makeHitter(
  playerKey: string,
  positions: string,
  pointsPerGame: number,
  overrides: Partial<OptimalLineupHitter> = {}
): HitterImpactPlayer {
  return {
    age: 27,
    dataQuality: "full",
    isMilb: false,
    row: {
      player_key: playerKey,
      player_name: playerKey,
      positions,
      status: null,
      mlb_team: "TOR",
      salary: 5,
      games: 100,
      plate_appearances: 400,
      points_per_game: pointsPerGame,
      points: pointsPerGame * 100,
      fangraphs_id: playerKey,
      fangraphs_url: null,
      wrc_plus: 100 + pointsPerGame * 5,
      wrc_error: null,
      ...overrides
    }
  };
}

function fullHitterRoster() {
  return [
    makeHitter("c1", "C", 5.5),
    makeHitter("c2", "C", 4.5),
    makeHitter("first", "1B", 5.2),
    makeHitter("second", "2B", 5.1),
    makeHitter("short", "SS", 5),
    makeHitter("middle", "2B/SS", 4.8),
    makeHitter("third", "3B", 5),
    makeHitter("of1", "OF", 5.4),
    makeHitter("of2", "OF", 5.2),
    makeHitter("of3", "OF", 5),
    makeHitter("of4", "OF", 4.8),
    makeHitter("of5", "OF", 4.6),
    makeHitter("util", "DH", 4)
  ];
}

let tradePlayerSequence = 0;

function makeTradePitcher(overrides: Partial<TradePlayerRow> = {}): TradePlayerRow {
  tradePlayerSequence += 1;
  return {
    player_key: `pitcher_${tradePlayerSequence}`,
    player_name: `Pitcher ${tradePlayerSequence}`,
    positions: "SP",
    status: null,
    ownerTeamName: "Test Team",
    ownerTeamUid: "team:test",
    mlbTeam: "TOR",
    section: "pitcher",
    age: 28,
    salary: 5,
    availabilityCodes: [],
    seasonPoints: 200,
    pointsPerGame: null,
    pointsPerIp: 5,
    aggregate_rank: 100,
    scoringRank: 100,
    value: 10,
    scoredValue: 10,
    sourceValues: [],
    ...overrides
  };
}

function makePitcher(
  playerKey: string,
  scoredValue: number | null,
  observedRole: PitcherUsageRole = "SP",
  overrides: Partial<TradePlayerRow> = {}
): PitcherImpactPlayer {
  return {
    observedRole,
    row: makeTradePitcher({
      player_key: playerKey,
      player_name: playerKey,
      scoredValue,
      ...overrides
    })
  };
}

describe("shared optimal hitter impact", () => {
  test("preserves the existing 13-slot optimizer and summarizes the current roster", () => {
    const snapshot = buildHitterLineupSnapshot(fullHitterRoster());

    expect(snapshot.summary.filledSlots).toBe(13);
    expect(snapshot.optimizer.assignments.size).toBe(13);
    expect(snapshot.summary.rosterCount).toBe(13);
    expect(snapshot.summary.benchCount).toBe(0);
    expect(snapshot.summary.lineupPpg).toBeGreaterThan(0);
    expect(snapshot.positionRows.map((row) => row.position)).toEqual([
      "C",
      "1B",
      "2B",
      "SS",
      "MI",
      "3B",
      "OF",
      "UTIL"
    ]);
  });

  test("adds a better incoming hitter, names the new and displaced starters, and captures position changes", () => {
    const incoming = makeHitter("incoming-shortstop", "SS", 7, { wrc_plus: 150 });
    const impact = analyzeHitterTradeImpact({
      currentRoster: fullHitterRoster(),
      incomingPlayers: [incoming]
    });

    expect(impact.after.summary.filledSlots).toBe(13);
    expect(impact.summaryDelta.lineupPpg).toBeGreaterThan(0);
    expect(impact.newStarters.map((movement) => movement.player.row.player_key)).toContain("incoming-shortstop");
    expect(impact.displacedStarters).toHaveLength(1);
    expect(impact.displacedStarters[0]?.player.row.player_key).toBe("util");
    expect(impact.rosterArrivals.map((movement) => movement.player.row.player_key)).toEqual(["incoming-shortstop"]);
    expect(impact.changedAssignments.length).toBeGreaterThan(0);
    expect(impact.positionDeltas.some((row) => row.starterScoreDelta !== 0)).toBe(true);
  });

  test("applies selected drops and promotes eligible bench depth without calling it a displacement", () => {
    const currentRoster = [
      ...fullHitterRoster(),
      makeHitter("third-bench", "3B", 3)
    ];
    const impact = analyzeHitterTradeImpact({
      currentRoster,
      dropPlayerKeys: ["third"]
    });

    expect(impact.rosterExits.map((movement) => movement.player.row.player_key)).toContain("third");
    expect(impact.newStarters.map((movement) => movement.player.row.player_key)).toContain("third-bench");
    expect(impact.displacedStarters).toHaveLength(0);
    expect(impact.after.summary.filledSlots).toBe(13);
    expect(impact.summaryDelta.lineupPpg).toBeLessThan(0);
  });

  test("excludes incoming MiLB hitters from the MLB optimizer", () => {
    const minor = {
      ...makeHitter("prospect", "SS", 12),
      isMilb: true
    };
    const impact = analyzeHitterTradeImpact({
      currentRoster: fullHitterRoster(),
      incomingPlayers: [minor]
    });

    expect(impact.skippedMilbIncoming.map((player) => player.row.player_key)).toEqual(["prospect"]);
    expect(impact.after.summary).toEqual(impact.before.summary);
    expect(impact.newStarters).toHaveLength(0);
  });

  test("builds an explicit P/G-only Available hitter and counts limited confidence", () => {
    const availableTradeRow = makeTradePitcher({
      player_key: "available-hitter",
      player_name: "Available Hitter",
      section: "hitter",
      positions: "OF",
      pointsPerGame: 6.5,
      seasonPoints: 325,
      pointsPerIp: null,
      scoredValue: 20
    });
    const available = optimalHitterFromTradePlayer(availableTradeRow);
    const impact = analyzeHitterTradeImpact({
      currentRoster: fullHitterRoster(),
      incomingPlayers: [available]
    });

    expect(available.dataQuality).toBe("ppg-only");
    expect(available.row.games).toBe(50);
    expect(available.row.wrc_plus).toBeNull();
    expect(available.row.wrc_error).toContain("P/G-only");
    expect(impact.after.summary.limitedConfidenceCount).toBe(1);
    expect(impact.summaryDelta.limitedConfidenceCount).toBe(1);
  });

  test("deduplicates incoming hitters by stable player key", () => {
    const incoming = makeHitter("same-player", "OF", 6);
    const impact = analyzeHitterTradeImpact({
      currentRoster: fullHitterRoster(),
      incomingPlayers: [incoming, { ...incoming, age: 25 }]
    });

    expect(impact.after.entries.filter((player) => player.row.player_key === "same-player")).toHaveLength(1);
    expect(impact.after.entries.find((player) => player.row.player_key === "same-player")?.age).toBe(25);
  });
});

describe("pitcher plan impact", () => {
  const targets = { spTarget: 4, bubbleTarget: 1, rpTarget: 2 };

  test("projects confirmed SP, Bubble, and RP from configured targets", () => {
    const projection = projectPitcherBuckets(
      [
        makePitcher("sp30", 30),
        makePitcher("sp20", 20),
        makePitcher("sp10", 10),
        makePitcher("sp05", 5),
        makePitcher("rp20", 20, "RP", { positions: "RP" }),
        makePitcher("rp10", 10, "RP", { positions: "RP" }),
        makePitcher("rp05", 5, "RP", { positions: "RP" })
      ],
      targets
    );

    expect(projection.buckets.SP.map((player) => player.row.player_key)).toEqual(["sp30", "sp20", "sp10"]);
    expect(projection.buckets.BUBBLE.map((player) => player.row.player_key)).toEqual(["sp05"]);
    expect(projection.buckets.RP.map((player) => player.row.player_key)).toEqual(["rp20", "rp10"]);
    expect(projection.summaries.SP).toMatchObject({ count: 3, target: 3, scoringValue: 60 });
    expect(projection.summaries.BUBBLE).toMatchObject({ count: 1, target: 1, scoringValue: 5 });
    expect(projection.summaries.RP).toMatchObject({ count: 2, target: 2, scoringValue: 30 });
  });

  test("shows an incoming starter entering, an incumbent moving to Bubble, and the prior Bubble leaving", () => {
    const currentRoster = [
      makePitcher("sp30", 30),
      makePitcher("sp20", 20),
      makePitcher("sp10", 10),
      makePitcher("sp05", 5)
    ];
    const incoming = makePitcher("incoming25", 25);
    const impact = analyzePitcherTradeImpact({
      currentRoster,
      incomingPlayers: [incoming],
      targets
    });

    expect(impact.after.buckets.SP.map((player) => player.row.player_key)).toEqual(["sp30", "incoming25", "sp20"]);
    expect(impact.after.buckets.BUBBLE.map((player) => player.row.player_key)).toEqual(["sp10"]);
    expect(impact.entersPlan.map((movement) => movement.player.row.player_key)).toContain("incoming25");
    expect(impact.bucketChanges).toContainEqual(
      expect.objectContaining({
        player: expect.objectContaining({ row: expect.objectContaining({ player_key: "sp10" }) }),
        beforeBucket: "SP",
        afterBucket: "BUBBLE"
      })
    );
    expect(impact.leavesPlan.map((movement) => movement.player.row.player_key)).toContain("sp05");
    expect(impact.summaryDelta.SP.scoringValue).toBe(15);
    expect(impact.summaryDelta.BUBBLE.scoringValue).toBe(5);
  });

  test("shows an incoming RP displacing the weakest selected reliever", () => {
    const currentRoster = [
      makePitcher("rp20", 20, "RP", { positions: "RP" }),
      makePitcher("rp10", 10, "RP", { positions: "RP" }),
      makePitcher("rp05", 5, "RP", { positions: "RP" })
    ];
    const impact = analyzePitcherTradeImpact({
      currentRoster,
      incomingPlayers: [makePitcher("rp15", 15, "RP", { positions: "RP" })],
      targets
    });

    expect(impact.after.buckets.RP.map((player) => player.row.player_key)).toEqual(["rp20", "rp15"]);
    expect(impact.entersPlan.map((movement) => movement.player.row.player_key)).toContain("rp15");
    expect(impact.leavesPlan.map((movement) => movement.player.row.player_key)).toContain("rp10");
    expect(impact.summaryDelta.RP.scoringValue).toBe(5);
  });

  test("uses My Team manual usage override ahead of observed usage", () => {
    const overridden = {
      ...makePitcher("swingman", 18, "RP", { positions: "SP/RP" }),
      usageOverride: "Mixed - SP" as const
    };

    expect(effectivePitcherUsage(overridden)).toEqual({
      bucket: "SP",
      role: "Mixed - SP",
      source: "manual-override"
    });
    const projection = projectPitcherBuckets([overridden], targets);
    expect(projection.buckets.SP.map((player) => player.row.player_key)).toEqual(["swingman"]);
    expect(projection.summaries.SP.limitedUsageCount).toBe(0);
  });

  test("uses eligibility as a lower-confidence fallback for unavailable usage", () => {
    const fallback = makePitcher("available-sp", 12, "Usage unavailable", {
      ownerTeamUid: null,
      positions: "SP/RP"
    });
    const projection = projectPitcherBuckets([fallback], targets);

    expect(effectivePitcherUsage(fallback)).toEqual({
      bucket: "SP",
      role: null,
      source: "eligibility-fallback"
    });
    expect(projection.buckets.SP.map((player) => player.row.player_key)).toEqual(["available-sp"]);
    expect(projection.summaries.SP.limitedUsageCount).toBe(1);
  });

  test("falls back from missing scoring value to P/IP, then dynasty value", () => {
    const pipLeader = makePitcher("pip-leader", null, "SP", { pointsPerIp: 6, value: 2 });
    const dynastyFallback = makePitcher("dynasty-fallback", null, "SP", { pointsPerIp: null, value: 30 });
    const noMetrics = makePitcher("no-metrics", null, "SP", { pointsPerIp: null, value: null });
    const projection = projectPitcherBuckets(
      [dynastyFallback, noMetrics, pipLeader],
      { spTarget: 3, bubbleTarget: 0, rpTarget: 0 }
    );

    expect(projection.buckets.SP.map((player) => player.row.player_key)).toEqual([
      "pip-leader",
      "dynasty-fallback",
      "no-metrics"
    ]);
    expect(projection.summaries.SP.qualityFallbackCount).toBe(3);
    expect(projection.summaries.SP.scoringMissingCount).toBe(3);
    expect(projection.summaries.SP.dynastyMissingCount).toBe(1);
  });

  test("applies outgoing players and drops while ignoring incoming MiLB pitchers", () => {
    const outgoing = makePitcher("outgoing-sp", 20);
    const drop = makePitcher("drop-rp", 10, "RP", { positions: "RP" });
    const minor = makePitcher("minor-sp", 50, "SP", { availabilityCodes: ["minors"], mlbTeam: "AAA" });
    const impact = analyzePitcherTradeImpact({
      currentRoster: [outgoing, drop],
      outgoingPlayerKeys: ["outgoing-sp"],
      dropPlayerKeys: ["drop-rp"],
      incomingPlayers: [minor],
      targets
    });

    expect(impact.rosterExits.map((movement) => movement.player.row.player_key).sort()).toEqual([
      "drop-rp",
      "outgoing-sp"
    ]);
    expect(impact.skippedMilbIncoming.map((player) => player.row.player_key)).toEqual(["minor-sp"]);
    expect(impact.after.assignments.size).toBe(0);
  });

  test("breaks complete quality ties deterministically by player name and key", () => {
    const beta = makePitcher("beta-key", 10, "SP", { player_name: "Beta" });
    const alphaTwo = makePitcher("alpha-two", 10, "SP", { player_name: "Alpha" });
    const alphaOne = makePitcher("alpha-one", 10, "SP", { player_name: "Alpha" });
    const projection = projectPitcherBuckets(
      [beta, alphaTwo, alphaOne],
      { spTarget: 3, bubbleTarget: 0, rpTarget: 0 }
    );

    expect(projection.buckets.SP.map((player) => player.row.player_key)).toEqual([
      "alpha-one",
      "alpha-two",
      "beta-key"
    ]);
  });
});
