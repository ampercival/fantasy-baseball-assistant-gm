import { describe, expect, test } from "vitest";
import {
  buildTradeImpactFingerprint,
  initialTradeImpactActionState,
  loadTradeImpactAnalysis,
  tradeImpactActionReducer,
  type TradeImpactDataDependencies,
  type TradeImpactPitcherPlan,
  type TradeImpactProposal
} from "../src/tradeImpactData";
import type { TradePlayerRow } from "../src/tradeAnalysis";
import type {
  OptimalLineupHitter,
  OptimalLineupResponse,
  PitcherUsageResponse,
  PitcherUsageRole,
  PitcherUsageRow
} from "../src/types";

let rowSequence = 0;

function makeTradeRow(overrides: Partial<TradePlayerRow> = {}): TradePlayerRow {
  rowSequence += 1;
  return {
    player_key: `player_${rowSequence}`,
    player_name: `Player ${rowSequence}`,
    positions: "SS",
    status: null,
    ownerTeamName: "Test Team",
    ownerTeamUid: "team:my",
    mlbTeam: "TOR",
    section: "hitter",
    age: 27,
    salary: 5,
    availabilityCodes: [],
    seasonPoints: 500,
    pointsPerGame: 5,
    pointsPerIp: null,
    aggregate_rank: 100,
    scoringRank: 100,
    value: 10,
    scoredValue: 10,
    sourceValues: [],
    ...overrides
  };
}

function makeOptimalHitter(row: TradePlayerRow, overrides: Partial<OptimalLineupHitter> = {}): OptimalLineupHitter {
  return {
    player_key: row.player_key,
    player_name: row.player_name,
    positions: row.positions,
    status: row.status,
    mlb_team: row.mlbTeam,
    salary: row.salary,
    games: 100,
    plate_appearances: 400,
    points_per_game: row.pointsPerGame,
    points: row.seasonPoints,
    fangraphs_id: row.player_key,
    fangraphs_url: null,
    wrc_plus: 120,
    wrc_error: null,
    ...overrides
  };
}

function makeUsage(
  row: TradePlayerRow,
  role: PitcherUsageRole = "SP",
  bucket: "SP" | "RP" = "SP"
): PitcherUsageRow {
  return {
    player_key: row.player_key,
    player_name: row.player_name,
    positions: row.positions,
    bucket,
    role,
    season_appearances: 20,
    season_starts: bucket === "SP" ? 20 : 0,
    season_relief_appearances: bucket === "RP" ? 20 : 0,
    last_five: [bucket, bucket, bucket, bucket, bucket],
    fangraphs_id: row.player_key,
    fangraphs_url: null,
    xfip_minus: 95,
    xfip_error: null,
    usage_source: "fangraphs-game-log",
    error: null
  };
}

function optimalResponse(teamUid: string, rows: OptimalLineupHitter[] = []): OptimalLineupResponse {
  return {
    league_uid: "league:1",
    team_uid: teamUid,
    season: 2026,
    source: "test",
    fetched_at: "2026-08-06T00:00:00Z",
    rows,
    errors: []
  };
}

function usageResponse(teamUid: string, rows: PitcherUsageRow[] = []): PitcherUsageResponse {
  return {
    league_uid: "league:1",
    team_uid: teamUid,
    season: 2026,
    source: "test",
    fetched_at: "2026-08-06T00:00:00Z",
    rows,
    errors: []
  };
}

function proposal(overrides: Partial<TradeImpactProposal> = {}): TradeImpactProposal {
  return {
    leagueUid: "league:1",
    myDrops: [],
    myTeamRows: [],
    myTeamUid: "team:my",
    partnerTeamUid: "team:partner",
    playersGiven: [],
    playersReceived: [],
    season: 2026,
    ...overrides
  };
}

function dependencyHarness({
  optimalByTeam = {},
  plan = { spTarget: 5, bubbleTarget: 1, rpTarget: 4, usageOverrides: {} },
  usageByTeam = {}
}: {
  optimalByTeam?: Record<string, OptimalLineupResponse>;
  plan?: TradeImpactPitcherPlan;
  usageByTeam?: Record<string, PitcherUsageResponse>;
} = {}) {
  const calls = {
    optimal: [] as string[],
    plan: [] as string[],
    usage: [] as string[]
  };
  const dependencies: TradeImpactDataDependencies = {
    fetchOptimalLineup: async (_leagueUid, teamUid) => {
      calls.optimal.push(teamUid);
      return optimalByTeam[teamUid] || optimalResponse(teamUid);
    },
    fetchPitcherPlan: async (_leagueUid, teamUid) => {
      calls.plan.push(teamUid);
      return plan;
    },
    fetchPitcherUsage: async (_leagueUid, teamUid) => {
      calls.usage.push(teamUid);
      return usageByTeam[teamUid] || usageResponse(teamUid);
    },
    optimalLineupCache: new Map(),
    pitcherUsageCache: new Map()
  };
  return { calls, dependencies, plan };
}

describe("trade impact cached loading", () => {
  test("loads My Team and a normal partner once, maps only selected incoming players, and clones the persisted plan", async () => {
    const myHitter = makeTradeRow({ player_key: "my_h", player_name: "My Hitter" });
    const myPitcher = makeTradeRow({
      player_key: "my_p",
      player_name: "My Pitcher",
      positions: "SP",
      section: "pitcher",
      pointsPerGame: null,
      pointsPerIp: 5
    });
    const incomingHitter = makeTradeRow({
      player_key: "in_h",
      player_name: "Incoming Hitter",
      ownerTeamUid: "team:partner"
    });
    const incomingPitcher = makeTradeRow({
      player_key: "in_p",
      player_name: "Incoming Pitcher",
      ownerTeamUid: "team:partner",
      positions: "RP",
      section: "pitcher",
      pointsPerGame: null,
      pointsPerIp: 7,
      scoredValue: 20
    });
    const unselectedHitter = makeTradeRow({
      player_key: "not_selected",
      ownerTeamUid: "team:partner"
    });
    const plan: TradeImpactPitcherPlan = {
      spTarget: 3,
      bubbleTarget: 1,
      rpTarget: 2,
      usageOverrides: { my_p: "Mixed - RP" }
    };
    const harness = dependencyHarness({
      optimalByTeam: {
        "team:my": optimalResponse("team:my", [makeOptimalHitter(myHitter)]),
        "team:partner": optimalResponse("team:partner", [
          makeOptimalHitter(incomingHitter),
          makeOptimalHitter(unselectedHitter)
        ])
      },
      plan,
      usageByTeam: {
        "team:my": usageResponse("team:my", [makeUsage(myPitcher)]),
        "team:partner": usageResponse("team:partner", [makeUsage(incomingPitcher, "RP", "RP")])
      }
    });

    const result = await loadTradeImpactAnalysis(proposal({
      myTeamRows: [myHitter, myPitcher],
      playersReceived: [incomingHitter, incomingPitcher]
    }), harness.dependencies);

    expect(harness.calls.optimal).toEqual(["team:my", "team:partner"]);
    expect(harness.calls.usage).toEqual(["team:my", "team:partner"]);
    expect(harness.calls.plan).toEqual(["team:my"]);
    expect(result.loadedTeamUids).toEqual(["team:my", "team:partner"]);
    expect(result.hitterImpact.after.entries.map((entry) => entry.row.player_key)).toContain("in_h");
    expect(result.hitterImpact.after.entries.map((entry) => entry.row.player_key)).not.toContain("not_selected");
    expect(result.pitcherImpact.rosterArrivals.map((entry) => entry.player.row.player_key)).toContain("in_p");
    expect(result.pitcherImpact.before.effectiveUsageByPlayerKey.get("my_p")?.source).toBe("manual-override");
    expect(result.pitcherPlan).toEqual(plan);
    expect(result.pitcherPlan.usageOverrides).not.toBe(plan.usageOverrides);
    expect(result.warnings).toEqual([]);
  });

  test("reuses both response caches on a repeated user-triggered analysis", async () => {
    const incoming = makeTradeRow({ player_key: "cached_in", ownerTeamUid: "team:partner" });
    const harness = dependencyHarness({
      optimalByTeam: {
        "team:my": optimalResponse("team:my"),
        "team:partner": optimalResponse("team:partner", [makeOptimalHitter(incoming)])
      }
    });
    const input = proposal({ playersReceived: [incoming] });

    await loadTradeImpactAnalysis(input, harness.dependencies);
    await loadTradeImpactAnalysis(input, harness.dependencies);

    expect(harness.calls.optimal).toEqual(["team:my", "team:partner"]);
    expect(harness.calls.usage).toEqual(["team:my", "team:partner"]);
    expect(harness.calls.plan).toEqual(["team:my", "team:my"]);
    expect(harness.dependencies.optimalLineupCache.size).toBe(2);
    expect(harness.dependencies.pitcherUsageCache.size).toBe(2);
  });

  test("deduplicates Trade Block owner-team requests across a mixed package", async () => {
    const ownerAHitter = makeTradeRow({ player_key: "a_h", ownerTeamUid: "team:a" });
    const ownerAPitcher = makeTradeRow({
      player_key: "a_p",
      ownerTeamUid: "team:a",
      positions: "SP",
      section: "pitcher",
      pointsPerGame: null,
      pointsPerIp: 5
    });
    const ownerBHitter = makeTradeRow({ player_key: "b_h", ownerTeamUid: "team:b" });
    const harness = dependencyHarness({
      optimalByTeam: {
        "team:a": optimalResponse("team:a", [makeOptimalHitter(ownerAHitter)]),
        "team:b": optimalResponse("team:b", [makeOptimalHitter(ownerBHitter)])
      },
      usageByTeam: {
        "team:a": usageResponse("team:a", [makeUsage(ownerAPitcher)])
      }
    });

    const result = await loadTradeImpactAnalysis(proposal({
      partnerTeamUid: "__trade_block__",
      playersReceived: [ownerAHitter, ownerAPitcher, ownerBHitter, ownerAHitter]
    }), harness.dependencies);

    expect(harness.calls.optimal).toEqual(["team:my", "team:a", "team:b"]);
    expect(harness.calls.usage).toEqual(["team:my", "team:a", "team:b"]);
    expect(result.loadedTeamUids).toEqual(["team:my", "team:a", "team:b"]);
    expect(result.hitterImpact.after.entries.filter((entry) => entry.row.player_key === "a_h")).toHaveLength(1);
  });

  test("keeps Available targets local, labels hitter confidence, and uses pitcher eligibility without observed usage", async () => {
    const availableHitter = makeTradeRow({
      player_key: "available_h",
      ownerTeamName: null,
      ownerTeamUid: null,
      salary: null
    });
    const availablePitcher = makeTradeRow({
      player_key: "available_p",
      ownerTeamName: null,
      ownerTeamUid: null,
      positions: "RP",
      section: "pitcher",
      salary: null,
      pointsPerGame: null,
      pointsPerIp: 8
    });
    const harness = dependencyHarness();

    const result = await loadTradeImpactAnalysis(proposal({
      partnerTeamUid: "__available__",
      playersReceived: [availableHitter, availablePitcher]
    }), harness.dependencies);

    expect(harness.calls.optimal).toEqual(["team:my"]);
    expect(harness.calls.usage).toEqual(["team:my"]);
    expect(result.hitterImpact.after.summary.limitedConfidenceCount).toBe(1);
    expect(result.pitcherImpact.after.effectiveUsageByPlayerKey.get("available_p")).toEqual({
      bucket: "RP",
      role: null,
      source: "eligibility-fallback"
    });
    expect(result.warnings.map((warning) => warning.code)).toEqual([
      "available-hitter-limited",
      "available-pitcher-usage-unavailable"
    ]);
  });

  test("uses explicit player-specific fallbacks when selected owner data is incomplete", async () => {
    const missingHitter = makeTradeRow({
      player_key: "missing_h",
      player_name: "Missing Hitter",
      ownerTeamUid: "team:partner"
    });
    const missingPitcher = makeTradeRow({
      player_key: "missing_p",
      player_name: "Missing Pitcher",
      ownerTeamUid: "team:partner",
      positions: "SP",
      section: "pitcher",
      pointsPerGame: null,
      pointsPerIp: 4
    });
    const harness = dependencyHarness();

    const result = await loadTradeImpactAnalysis(proposal({
      playersReceived: [missingHitter, missingPitcher]
    }), harness.dependencies);

    expect(result.hitterImpact.after.entries.find((entry) => entry.row.player_key === "missing_h")?.dataQuality).toBe("ppg-only");
    expect(result.pitcherImpact.after.effectiveUsageByPlayerKey.get("missing_p")?.source).toBe("eligibility-fallback");
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-optimal-lineup-player", playerName: "Missing Hitter" }),
      expect.objectContaining({ code: "missing-pitcher-usage-player", playerName: "Missing Pitcher" })
    ]));
  });

  test("warns and retains a selected My Team player missing from cached source data", async () => {
    const outgoingHitter = makeTradeRow({ player_key: "out_h", player_name: "Outgoing Hitter" });
    const outgoingPitcher = makeTradeRow({
      player_key: "out_p",
      player_name: "Outgoing Pitcher",
      positions: "SP",
      section: "pitcher",
      pointsPerGame: null,
      pointsPerIp: 5
    });
    const harness = dependencyHarness();

    const result = await loadTradeImpactAnalysis(proposal({
      myTeamRows: [outgoingHitter, outgoingPitcher],
      playersGiven: [outgoingHitter, outgoingPitcher]
    }), harness.dependencies);

    expect(result.hitterImpact.before.entries.map((entry) => entry.row.player_key)).toContain("out_h");
    expect(result.hitterImpact.rosterExits.map((entry) => entry.player.row.player_key)).toContain("out_h");
    expect(result.pitcherImpact.rosterExits.map((entry) => entry.player.row.player_key)).toContain("out_p");
    expect(result.warnings.map((warning) => warning.playerKey)).toEqual(expect.arrayContaining(["out_h", "out_p"]));
  });
});

describe("trade impact proposal and action state", () => {
  test("fingerprints are deterministic across row order and change with the GM context or proposal", () => {
    const giveA = makeTradeRow({ player_key: "give_a" });
    const giveB = makeTradeRow({ player_key: "give_b" });
    const receive = makeTradeRow({ player_key: "receive", ownerTeamUid: "team:partner" });
    const first = buildTradeImpactFingerprint(proposal({
      playersGiven: [giveA, giveB],
      playersReceived: [receive]
    }));
    const reordered = buildTradeImpactFingerprint(proposal({
      playersGiven: [giveB, giveA],
      playersReceived: [receive]
    }));
    const changedTeam = buildTradeImpactFingerprint(proposal({
      myTeamUid: "team:other",
      playersGiven: [giveA, giveB],
      playersReceived: [receive]
    }));
    const changedDrop = buildTradeImpactFingerprint(proposal({
      myDrops: [giveA],
      playersGiven: [giveA, giveB],
      playersReceived: [receive]
    }));

    expect(reordered).toBe(first);
    expect(changedTeam).not.toBe(first);
    expect(changedDrop).not.toBe(first);
  });

  test("covers idle, loading, ready, stale, reset, and error transitions", async () => {
    const harness = dependencyHarness();
    const input = proposal();
    const fingerprint = buildTradeImpactFingerprint(input);
    const result = await loadTradeImpactAnalysis(input, harness.dependencies);
    let state = initialTradeImpactActionState(fingerprint);
    expect(state.status).toBe("idle");

    state = tradeImpactActionReducer(state, { type: "start", fingerprint });
    expect(state.status).toBe("loading");
    state = tradeImpactActionReducer(state, { type: "ready", fingerprint, result });
    expect(state).toMatchObject({ status: "ready", stale: false, error: null });

    const changedFingerprint = `${fingerprint}:changed`;
    state = tradeImpactActionReducer(state, { type: "proposal-changed", fingerprint: changedFingerprint });
    expect(state).toMatchObject({ status: "ready", stale: true, currentFingerprint: changedFingerprint });
    expect(state.result).toBe(result);

    state = tradeImpactActionReducer(state, { type: "start", fingerprint: changedFingerprint });
    state = tradeImpactActionReducer(state, {
      type: "error",
      error: "Owner team unavailable",
      fingerprint: changedFingerprint
    });
    expect(state).toMatchObject({ status: "error", error: "Owner team unavailable", stale: true });

    state = tradeImpactActionReducer(state, { type: "reset", fingerprint: changedFingerprint });
    expect(state).toEqual(initialTradeImpactActionState(changedFingerprint));
  });

  test("rejects an analysis without a selected league and My Team", async () => {
    const harness = dependencyHarness();
    await expect(loadTradeImpactAnalysis(proposal({ leagueUid: "", myTeamUid: "" }), harness.dependencies))
      .rejects.toThrow("Select a league and My Team");
    expect(harness.calls.optimal).toEqual([]);
    expect(harness.calls.usage).toEqual([]);
    expect(harness.calls.plan).toEqual([]);
  });
});