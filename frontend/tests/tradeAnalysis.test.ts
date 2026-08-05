import { describe, expect, test } from "vitest";
import {
  analyzeTrade,
  buildTradeTotal,
  type TradeAnalysisInput,
  type TradePlayerRow,
  type TradeSourceValue
} from "../src/tradeAnalysis";
import type { SourceTag } from "../src/types";

let playerSequence = 0;

function makeSource(
  sourceId: string,
  value: number,
  sourceTag: SourceTag = "Continuous"
): TradeSourceValue {
  return {
    sourceId,
    sourceName: `${sourceId} source`,
    shortName: sourceId.toUpperCase(),
    sourceTag,
    sourceDate: "2026-08-05",
    rank: Math.max(1, Math.round(100 - value)),
    value
  };
}

function makePlayer(overrides: Partial<TradePlayerRow> = {}): TradePlayerRow {
  playerSequence += 1;
  return {
    player_key: `player_${playerSequence}`,
    player_name: `Player ${playerSequence}`,
    positions: "SS",
    status: null,
    ownerTeamName: "Test Team",
    ownerTeamUid: "team:test",
    mlbTeam: "TOR",
    section: "hitter",
    age: 26,
    salary: 5,
    availabilityCodes: [],
    seasonPoints: 500,
    pointsPerGame: 5,
    pointsPerIp: null,
    aggregate_rank: 100,
    scoringRank: 100,
    value: 10,
    scoredValue: 8,
    sourceValues: [],
    ...overrides
  };
}

function analyze(overrides: Partial<TradeAnalysisInput> = {}) {
  return analyzeTrade({
    cashReceived: 0,
    cashSent: 0,
    myDrops: [],
    opponentDrops: [],
    playersGiven: [],
    playersReceived: [],
    ...overrides
  });
}

describe("trade package totals", () => {
  test("calculates a one-for-one trade, net to me, salary, and player surplus", () => {
    const given = makePlayer({
      salary: 10,
      value: 20,
      scoredValue: 15,
      sourceValues: [makeSource("alpha", 20)]
    });
    const received = makePlayer({
      salary: 12,
      value: 24,
      scoredValue: 18,
      sourceValues: [makeSource("alpha", 24)]
    });

    const result = analyze({ playersGiven: [given], playersReceived: [received] });

    expect(result.given.dynasty.knownPlayerValue).toBe(20);
    expect(result.received.dynasty.knownPlayerValue).toBe(24);
    expect(result.given.scoring.knownPlayerValue).toBe(15);
    expect(result.received.scoring.knownPlayerValue).toBe(18);
    expect(result.given.dynastySurplus.knownTotal).toBe(10);
    expect(result.received.dynastySurplus.knownTotal).toBe(12);
    expect(result.dynastyResult.knownNetToYou).toBe(4);
    expect(result.scoringResult.knownNetToYou).toBe(3);
    expect(result.dynastyResult.winner).toBe("You");
    expect(result.dynastyResult.label).toBe("Favors You");
    expect(result.dynastyResult.copy).toContain("You gain $4 in dynasty value");
    expect(result.dynastyResult.copy).not.toContain("Side A");
    expect(result.myRosterImpact.salaryChange).toBe(2);
    expect(result.myRosterImpact.rosterCountChange).toBe(0);
  });

  test("frames a negative net as favoring the trade partner", () => {
    const result = analyze({
      playersGiven: [makePlayer({ value: 30, scoredValue: 24 })],
      playersReceived: [makePlayer({ value: 20, scoredValue: 18 })]
    });

    expect(result.dynastyResult.knownNetToYou).toBe(-10);
    expect(result.dynastyResult.winner).toBe("Trade Partner");
    expect(result.dynastyResult.label).toBe("Favors Trade Partner");
    expect(result.dynastyResult.copy).toContain("You give $10 more dynasty value than you receive");
    expect(result.dynastyResult.copy).not.toMatch(/Side A|Side B/);
  });

  test("adds multi-player packages without mixing salary into value", () => {
    const given = [
      makePlayer({ salary: 6, value: 15, scoredValue: 12 }),
      makePlayer({ salary: 4, value: 9, scoredValue: 7 })
    ];
    const received = [
      makePlayer({ salary: 11, value: 20, scoredValue: 16 }),
      makePlayer({ salary: 2, value: 7, scoredValue: 5 }),
      makePlayer({ salary: 1, value: 3, scoredValue: 2 })
    ];

    const result = analyze({ playersGiven: given, playersReceived: received });

    expect(result.given.count).toBe(2);
    expect(result.received.count).toBe(3);
    expect(result.given.salary).toBe(10);
    expect(result.received.salary).toBe(14);
    expect(result.given.dynasty.knownTotal).toBe(24);
    expect(result.received.dynasty.knownTotal).toBe(30);
    expect(result.given.scoring.knownTotal).toBe(19);
    expect(result.received.scoring.knownTotal).toBe(23);
    expect(result.myRosterImpact.rosterCountChange).toBe(1);
  });

  test("summarizes package points, age, roles, and roster statuses", () => {
    const hitter = makePlayer({
      age: 24,
      availabilityCodes: ["il"],
      seasonPoints: 400
    });
    const pitcher = makePlayer({
      age: 30,
      availabilityCodes: ["minors", "susp"],
      seasonPoints: 200,
      section: "pitcher"
    });
    const unknowns = makePlayer({ age: null, seasonPoints: null });

    const total = buildTradeTotal([hitter, pitcher, unknowns]);

    expect(total.seasonPoints).toBe(600);
    expect(total.unknownSeasonPointsCount).toBe(1);
    expect(total.ageSum).toBe(54);
    expect(total.ageCount).toBe(2);
    expect(total.hitterCount).toBe(2);
    expect(total.pitcherCount).toBe(1);
    expect(total.ilCount).toBe(1);
    expect(total.milbCount).toBe(1);
    expect(total.suspendedCount).toBe(1);
  });

  test("treats cash I send as separate one-dollar dynasty and scoring value", () => {
    const given = makePlayer({ value: 20, scoredValue: 15 });
    const received = makePlayer({ value: 24, scoredValue: 18 });

    const result = analyze({ cashSent: 3, playersGiven: [given], playersReceived: [received] });

    expect(result.given.dynasty.knownPlayerValue).toBe(20);
    expect(result.given.dynasty.cashValue).toBe(3);
    expect(result.given.dynasty.knownTotal).toBe(23);
    expect(result.given.scoring.knownTotal).toBe(18);
    expect(result.dynastyResult.knownNetToYou).toBe(1);
    expect(result.myRosterImpact.capLimitChange).toBe(-3);
  });

  test("treats cash I receive as separate one-dollar dynasty and scoring value", () => {
    const given = makePlayer({ value: 20, scoredValue: 15 });
    const received = makePlayer({ value: 24, scoredValue: 18 });

    const result = analyze({ cashReceived: 4, playersGiven: [given], playersReceived: [received] });

    expect(result.received.dynasty.knownPlayerValue).toBe(24);
    expect(result.received.dynasty.cashValue).toBe(4);
    expect(result.received.dynasty.knownTotal).toBe(28);
    expect(result.received.scoring.knownTotal).toBe(22);
    expect(result.dynastyResult.knownNetToYou).toBe(8);
    expect(result.myRosterImpact.capLimitChange).toBe(4);
  });
});

describe("fairness and roster consequences", () => {
  const given = () => makePlayer({
    salary: 10,
    value: 20,
    scoredValue: 15,
    sourceValues: [makeSource("alpha", 20), makeSource("beta", 19)]
  });
  const received = () => makePlayer({
    salary: 12,
    value: 24,
    scoredValue: 18,
    sourceValues: [makeSource("alpha", 24), makeSource("beta", 23)]
  });

  test("my drop cannot change dynasty, scoring, or source fairness", () => {
    const outgoing = given();
    const incoming = received();
    const withoutDrop = analyze({ playersGiven: [outgoing], playersReceived: [incoming] });
    const withDrop = analyze({
      myDrops: [makePlayer({ salary: 4, value: 50, scoredValue: 40 })],
      playersGiven: [outgoing],
      playersReceived: [incoming]
    });

    expect(withDrop.dynastyResult).toEqual(withoutDrop.dynastyResult);
    expect(withDrop.scoringResult).toEqual(withoutDrop.scoringResult);
    expect(withDrop.dynastySourceNetRange).toEqual(withoutDrop.dynastySourceNetRange);
    expect(withoutDrop.myRosterImpact.salaryChange).toBe(2);
    expect(withDrop.myRosterImpact.salaryChange).toBe(-2);
    expect(withoutDrop.myRosterImpact.rosterCountChange).toBe(0);
    expect(withDrop.myRosterImpact.rosterCountChange).toBe(-1);
  });

  test("an opponent drop changes only the opponent roster consequences", () => {
    const outgoing = given();
    const incoming = received();
    const withoutDrop = analyze({ playersGiven: [outgoing], playersReceived: [incoming] });
    const withDrop = analyze({
      opponentDrops: [makePlayer({ salary: 7, value: 60, scoredValue: 55 })],
      playersGiven: [outgoing],
      playersReceived: [incoming]
    });

    expect(withDrop.dynastyResult).toEqual(withoutDrop.dynastyResult);
    expect(withDrop.scoringResult).toEqual(withoutDrop.scoringResult);
    expect(withDrop.dynastySourceNetRange).toEqual(withoutDrop.dynastySourceNetRange);
    expect(withDrop.myRosterImpact).toEqual(withoutDrop.myRosterImpact);
    expect(withoutDrop.opponentRosterImpact.salaryChange).toBe(-2);
    expect(withDrop.opponentRosterImpact.salaryChange).toBe(-9);
    expect(withDrop.opponentRosterImpact.rosterCountChange).toBe(-1);
  });
});

describe("missing, not-applicable, and Available values", () => {
  test("a missing dynasty value invalidates dynasty only", () => {
    const missingDynasty = makePlayer({ value: null, scoredValue: 12 });
    const received = makePlayer({ value: 15, scoredValue: 12 });

    const result = analyze({ playersGiven: [missingDynasty], playersReceived: [received] });

    expect(result.given.dynasty.knownPlayerValue).toBe(0);
    expect(result.given.dynasty.missingCount).toBe(1);
    expect(result.dynastyResult.complete).toBe(false);
    expect(result.dynastyResult.winner).toBeNull();
    expect(result.dynastyResult.copy).toContain("You Give has $0 known and You Get has $15 known");
    expect(result.dynastyResult.copy).not.toMatch(/Side A|Side B/);
    expect(result.scoringResult.complete).toBe(true);
  });

  test("a missing scoring value invalidates scoring only", () => {
    const missingScoring = makePlayer({ value: 12, scoredValue: null });
    const received = makePlayer({ value: 12, scoredValue: 10 });

    const result = analyze({ playersGiven: [missingScoring], playersReceived: [received] });

    expect(result.dynastyResult.complete).toBe(true);
    expect(result.given.scoring.knownPlayerValue).toBe(0);
    expect(result.given.scoring.missingCount).toBe(1);
    expect(result.scoringResult.complete).toBe(false);
    expect(result.scoringResult.winner).toBeNull();
  });

  test("MiLB scoring is excluded as not applicable instead of becoming zero or missing", () => {
    const minorLeaguer = makePlayer({
      availabilityCodes: ["minors"],
      mlbTeam: "AAA",
      scoredValue: null,
      value: 9
    });

    const result = analyze({ playersGiven: [minorLeaguer] });

    expect(result.given.scoring.knownPlayerValue).toBe(0);
    expect(result.given.scoring.missingCount).toBe(0);
    expect(result.given.scoring.notApplicableCount).toBe(1);
    expect(result.scoringResult.complete).toBe(true);
    expect(result.scoringResult.copy).toContain("MiLB player is intentionally excluded");
  });

  test("Available salary remains unknown while season points and rate remain separate", () => {
    const available = makePlayer({
      ownerTeamName: null,
      ownerTeamUid: null,
      salary: null,
      seasonPoints: 123.4,
      pointsPerGame: 4.6,
      scoredValue: 7,
      value: 11
    });

    const total = buildTradeTotal([available]);

    expect(available.salary).toBeNull();
    expect(available.seasonPoints).toBe(123.4);
    expect(available.pointsPerGame).toBe(4.6);
    expect(total.salary).toBe(0);
    expect(total.unknownSalaryCount).toBe(1);
    expect(total.dynastySurplus.complete).toBe(false);
    expect(total.scoringSurplus.complete).toBe(false);
  });
});

describe("source coverage and confidence", () => {
  test("calculates coherent full-coverage source package totals and range", () => {
    const given = makePlayer({
      value: 15,
      sourceValues: [makeSource("alpha", 10), makeSource("beta", 20)]
    });
    const received = makePlayer({
      value: 14,
      sourceValues: [makeSource("alpha", 15), makeSource("beta", 12)]
    });

    const result = analyze({ playersGiven: [given], playersReceived: [received] });

    expect(result.dynastySourceNetRange.fullCoverageNets).toHaveLength(2);
    expect(result.dynastySourceNetRange.fullCoverageNets.map((source) => source.netValue).sort((a, b) => a - b))
      .toEqual([-8, 5]);
    expect(result.dynastySourceNetRange.minNet).toBe(-8);
    expect(result.dynastySourceNetRange.maxNet).toBe(5);
    expect(result.dynastySourceNetRange.crossesZero).toBe(true);
    expect(result.dynastyResult.sourceRangeCrossesZero).toBe(true);
    expect(result.dynastyResult.winner).toBe("Even");
  });

  test("substitutes consensus for a partial source without admitting it to the official range", () => {
    const given = [
      makePlayer({
        value: 12,
        sourceValues: [makeSource("alpha", 10), makeSource("beta", 11)]
      }),
      makePlayer({
        value: 18,
        sourceValues: [makeSource("alpha", 20)]
      })
    ];
    const received = makePlayer({
      value: 36,
      sourceValues: [makeSource("alpha", 40), makeSource("beta", 35)]
    });

    const result = analyze({ playersGiven: given, playersReceived: [received] });
    const alpha = result.dynastySourceNetRange.fullCoverageNets.find((source) => source.sourceId === "alpha");
    const beta = result.dynastySourceNetRange.partialCoverageNets.find((source) => source.sourceId === "beta");

    expect(alpha?.netValue).toBe(10);
    expect(beta?.netValue).toBe(6);
    expect(beta?.coveredPlayerCount).toBe(2);
    expect(beta?.totalPlayerCount).toBe(3);
    expect(beta?.substitutedPlayerCount).toBe(1);
    expect(result.dynastySourceNetRange.fullCoverageNets).toHaveLength(1);
    expect(result.dynastySourceNetRange.partialCoverageNets).toHaveLength(1);
    expect(result.dynastySourceNetRange.minNet).toBe(10);
    expect(result.dynastySourceNetRange.maxNet).toBe(10);
    expect(result.dynastySourceNetRange.crossesZero).toBe(false);
  });

  test("source-tag filtering recomputes authoritative source totals", () => {
    const given = makePlayer({
      value: 10,
      sourceValues: [
        makeSource("continuous", 10, "Continuous"),
        makeSource("updated", 20, "Updated")
      ]
    });
    const received = makePlayer({
      value: 12,
      sourceValues: [
        makeSource("continuous", 15, "Continuous"),
        makeSource("updated", 15, "Updated")
      ]
    });
    const allSources = analyze({ playersGiven: [given], playersReceived: [received] });
    const continuousOnly = analyze({
      playersGiven: [{ ...given, sourceValues: given.sourceValues.filter((source) => source.sourceTag === "Continuous") }],
      playersReceived: [{ ...received, sourceValues: received.sourceValues.filter((source) => source.sourceTag === "Continuous") }]
    });

    expect(allSources.dynastySourceNetRange.fullCoverageNets).toHaveLength(2);
    expect(allSources.dynastySourceNetRange.minNet).toBe(-5);
    expect(allSources.dynastySourceNetRange.maxNet).toBe(5);
    expect(allSources.dynastySourceNetRange.crossesZero).toBe(true);
    expect(continuousOnly.dynastySourceNetRange.fullCoverageNets).toHaveLength(1);
    expect(continuousOnly.dynastySourceNetRange.minNet).toBe(5);
    expect(continuousOnly.dynastySourceNetRange.maxNet).toBe(5);
    expect(continuousOnly.dynastySourceNetRange.crossesZero).toBe(false);
  });

  test("uses max($1, 5% of average package value) as the even threshold", () => {
    const given = makePlayer({ value: 20, scoredValue: 20 });
    const received = makePlayer({ value: 20.8, scoredValue: 20.8 });

    const result = analyze({ playersGiven: [given], playersReceived: [received] });

    expect(result.dynastyResult.threshold).toBeCloseTo(1.02);
    expect(result.dynastyResult.knownNetToYou).toBeCloseTo(0.8);
    expect(result.dynastyResult.winner).toBe("Even");
    expect(result.scoringResult.winner).toBe("Even");
  });
});
