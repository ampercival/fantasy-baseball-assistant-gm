import {
  LINEUP_SLOTS,
  averageMetric,
  bestCaseLineupAverageMetric,
  bestCaseLineupSeasonPoints,
  bestPositionBy,
  buildOptimalLineupDisplayRows,
  buildPositionStrengthRows,
  expandedPositionTokens,
  optimizeBestCaseLineup,
  type DepthTier,
  type LineupOptimizerResult,
  type OptimalLineupDisplayRow,
  type PositionStrengthRow,
  type StrengthTier
} from "./optimalLineup";
import type { TradePlayerRow } from "./tradeAnalysis";
import type { OptimalLineupHitter, PitcherUsageRole } from "./types";

export type HitterImpactDataQuality = "full" | "ppg-only";

export type HitterImpactPlayer = {
  age: number | null;
  dataQuality: HitterImpactDataQuality;
  isMilb: boolean;
  row: OptimalLineupHitter;
};

export type HitterLineupSummary = {
  averageBenchPpg: number | null;
  averageStarterAge: number | null;
  averageWrcPlus: number | null;
  benchCount: number;
  filledSlots: number;
  limitedConfidenceCount: number;
  lineupPpg: number;
  lineupSeasonPoints: number;
  rosterCount: number;
};

export type HitterLineupSnapshot = {
  bench: OptimalLineupDisplayRow[];
  deepestPosition: string | null;
  entries: HitterImpactPlayer[];
  optimizer: LineupOptimizerResult;
  positionRows: PositionStrengthRow[];
  starters: OptimalLineupDisplayRow[];
  strongestPosition: string | null;
  summary: HitterLineupSummary;
  thinnestPosition: string | null;
  weakestPosition: string | null;
};

export type HitterImpactMovement = {
  afterRole: "starter" | "bench" | "off-roster";
  afterSlot: string | null;
  beforeRole: "starter" | "bench" | "off-roster";
  beforeSlot: string | null;
  player: HitterImpactPlayer;
};

export type HitterPositionDelta = {
  afterDepthScore: number | null;
  afterDepthTier: DepthTier;
  afterStarterScore: number | null;
  afterStarterTier: StrengthTier;
  beforeDepthScore: number | null;
  beforeDepthTier: DepthTier;
  beforeStarterScore: number | null;
  beforeStarterTier: StrengthTier;
  depthScoreDelta: number | null;
  position: string;
  starterScoreDelta: number | null;
};

export type HitterTradeImpact = {
  after: HitterLineupSnapshot;
  before: HitterLineupSnapshot;
  changedAssignments: HitterImpactMovement[];
  displacedStarters: HitterImpactMovement[];
  newStarters: HitterImpactMovement[];
  positionDeltas: HitterPositionDelta[];
  rosterArrivals: HitterImpactMovement[];
  rosterExits: HitterImpactMovement[];
  skippedMilbIncoming: HitterImpactPlayer[];
  starterToBench: HitterImpactMovement[];
  summaryDelta: HitterLineupSummary;
};

export type HitterTradeImpactInput = {
  currentRoster: HitterImpactPlayer[];
  dropPlayerKeys?: Iterable<string>;
  incomingPlayers?: HitterImpactPlayer[];
  outgoingPlayerKeys?: Iterable<string>;
};

export function optimalHitterFromTradePlayer(
  row: TradePlayerRow,
  dataQuality: HitterImpactDataQuality = "ppg-only"
): HitterImpactPlayer {
  const games =
    finiteNumber(row.seasonPoints) !== null &&
    finiteNumber(row.pointsPerGame) !== null &&
    Math.abs(row.pointsPerGame || 0) > 0.000001
      ? (row.seasonPoints as number) / (row.pointsPerGame as number)
      : null;
  return {
    age: finiteNumber(row.age),
    dataQuality,
    isMilb: row.availabilityCodes.includes("minors"),
    row: {
      player_key: row.player_key,
      player_name: row.player_name,
      positions: row.positions,
      status: row.status,
      mlb_team: row.mlbTeam,
      salary: row.salary,
      games,
      plate_appearances: null,
      points_per_game: finiteNumber(row.pointsPerGame),
      points: finiteNumber(row.seasonPoints),
      fangraphs_id: null,
      fangraphs_url: null,
      wrc_plus: null,
      wrc_error: dataQuality === "ppg-only" ? "P/G-only trade impact estimate." : null
    }
  };
}

export function assembleHypotheticalHitterRoster(input: HitterTradeImpactInput) {
  const removeKeys = new Set([
    ...normalizeKeys(input.outgoingPlayerKeys),
    ...normalizeKeys(input.dropPlayerKeys)
  ]);
  const roster = new Map<string, HitterImpactPlayer>();
  for (const player of input.currentRoster) {
    if (!player.row.player_key || player.isMilb) continue;
    roster.set(player.row.player_key, player);
  }
  for (const playerKey of removeKeys) roster.delete(playerKey);

  const skippedMilbIncoming: HitterImpactPlayer[] = [];
  for (const player of input.incomingPlayers || []) {
    if (!player.row.player_key) continue;
    if (player.isMilb) {
      skippedMilbIncoming.push(player);
      continue;
    }
    roster.set(player.row.player_key, player);
  }

  return {
    roster: [...roster.values()],
    skippedMilbIncoming
  };
}

export function buildHitterLineupSnapshot(players: HitterImpactPlayer[]): HitterLineupSnapshot {
  const entries = uniqueByPlayerKey(players.filter((player) => !player.isMilb), (player) => player.row.player_key);
  const optimizer = optimizeBestCaseLineup(entries.map((player) => player.row));
  const displayRows = buildOptimalLineupDisplayRows(entries.map((player) => player.row), optimizer);
  const starters = displayRows.filter((entry) => entry.assignment !== null);
  const bench = displayRows.filter((entry) => entry.assignment === null);
  const positionRows = buildPositionStrengthRows(starters, bench);
  const entryByKey = new Map(entries.map((entry) => [entry.row.player_key, entry]));
  const starterAges = starters.map((starter) => entryByKey.get(starter.row.player_key)?.age ?? null);
  const strongestPosition = bestPositionBy(positionRows, (row) => row.starterScore, "max");
  const weakestPosition = bestPositionBy(positionRows, (row) => row.starterScore, "min");
  const deepestPosition = bestPositionBy(positionRows, (row) => row.depthScore, "max");
  const thinnestPosition = bestPositionBy(positionRows, (row) => row.depthScore, "min");

  return {
    bench,
    deepestPosition: deepestPosition?.position || null,
    entries,
    optimizer,
    positionRows,
    starters,
    strongestPosition: strongestPosition?.position || null,
    summary: {
      averageBenchPpg: averageMetric(bench.map((entry) => entry.row.points_per_game)),
      averageStarterAge: averageMetric(starterAges),
      averageWrcPlus: bestCaseLineupAverageMetric(starters, (entry) => entry.row.wrc_plus),
      benchCount: bench.length,
      filledSlots: optimizer.starterCount,
      limitedConfidenceCount: entries.filter((entry) => entry.dataQuality === "ppg-only").length,
      lineupPpg: optimizer.totalPoints,
      lineupSeasonPoints: bestCaseLineupSeasonPoints(starters),
      rosterCount: entries.length
    },
    thinnestPosition: thinnestPosition?.position || null,
    weakestPosition: weakestPosition?.position || null
  };
}

export function analyzeHitterTradeImpact(input: HitterTradeImpactInput): HitterTradeImpact {
  const before = buildHitterLineupSnapshot(input.currentRoster);
  const assembled = assembleHypotheticalHitterRoster(input);
  const after = buildHitterLineupSnapshot(assembled.roster);
  const movements = buildHitterMovements(before, after);

  return {
    after,
    before,
    changedAssignments: movements.filter(
      (movement) =>
        movement.beforeRole === "starter" &&
        movement.afterRole === "starter" &&
        movement.beforeSlot !== movement.afterSlot
    ),
    displacedStarters: movements.filter(
      (movement) => movement.beforeRole === "starter" && movement.afterRole === "bench"
    ),
    newStarters: movements.filter(
      (movement) => movement.afterRole === "starter" && movement.beforeRole !== "starter"
    ),
    positionDeltas: buildHitterPositionDeltas(before.positionRows, after.positionRows),
    rosterArrivals: movements.filter(
      (movement) => movement.beforeRole === "off-roster" && movement.afterRole !== "off-roster"
    ),
    rosterExits: movements.filter(
      (movement) => movement.beforeRole !== "off-roster" && movement.afterRole === "off-roster"
    ),
    skippedMilbIncoming: assembled.skippedMilbIncoming,
    starterToBench: movements.filter(
      (movement) => movement.beforeRole === "starter" && movement.afterRole === "bench"
    ),
    summaryDelta: subtractHitterSummaries(after.summary, before.summary)
  };
}

function buildHitterMovements(before: HitterLineupSnapshot, after: HitterLineupSnapshot) {
  const beforeEntryByKey = new Map(before.entries.map((entry) => [entry.row.player_key, entry]));
  const afterEntryByKey = new Map(after.entries.map((entry) => [entry.row.player_key, entry]));
  const beforeAssignmentByKey = new Map(
    before.starters.map((entry) => [entry.row.player_key, entry.assignment])
  );
  const afterAssignmentByKey = new Map(
    after.starters.map((entry) => [entry.row.player_key, entry.assignment])
  );
  const playerKeys = [...new Set([...beforeEntryByKey.keys(), ...afterEntryByKey.keys()])].sort();

  return playerKeys
    .map((playerKey): HitterImpactMovement | null => {
      const beforePlayer = beforeEntryByKey.get(playerKey);
      const afterPlayer = afterEntryByKey.get(playerKey);
      const beforeAssignment = beforeAssignmentByKey.get(playerKey) || null;
      const afterAssignment = afterAssignmentByKey.get(playerKey) || null;
      const beforeRole = !beforePlayer ? "off-roster" : beforeAssignment ? "starter" : "bench";
      const afterRole = !afterPlayer ? "off-roster" : afterAssignment ? "starter" : "bench";
      const beforeSlot = beforeAssignment?.label || null;
      const afterSlot = afterAssignment?.label || null;
      if (beforeRole === afterRole && beforeSlot === afterSlot) return null;
      return {
        afterRole,
        afterSlot,
        beforeRole,
        beforeSlot,
        player: afterPlayer || beforePlayer!
      };
    })
    .filter((movement): movement is HitterImpactMovement => movement !== null);
}

function buildHitterPositionDeltas(
  beforeRows: PositionStrengthRow[],
  afterRows: PositionStrengthRow[]
): HitterPositionDelta[] {
  const beforeByPosition = new Map(beforeRows.map((row) => [row.position, row]));
  const afterByPosition = new Map(afterRows.map((row) => [row.position, row]));
  return [...new Set([...beforeByPosition.keys(), ...afterByPosition.keys()])]
    .sort()
    .map((position) => {
      const before = beforeByPosition.get(position);
      const after = afterByPosition.get(position);
      return {
        afterDepthScore: after?.depthScore ?? null,
        afterDepthTier: after?.depthTier ?? "thin",
        afterStarterScore: after?.starterScore ?? null,
        afterStarterTier: after?.starterTier ?? "weak",
        beforeDepthScore: before?.depthScore ?? null,
        beforeDepthTier: before?.depthTier ?? "thin",
        beforeStarterScore: before?.starterScore ?? null,
        beforeStarterTier: before?.starterTier ?? "weak",
        depthScoreDelta: subtractNullable(after?.depthScore, before?.depthScore),
        position,
        starterScoreDelta: subtractNullable(after?.starterScore, before?.starterScore)
      };
    });
}

function subtractHitterSummaries(after: HitterLineupSummary, before: HitterLineupSummary): HitterLineupSummary {
  return {
    averageBenchPpg: subtractNullable(after.averageBenchPpg, before.averageBenchPpg),
    averageStarterAge: subtractNullable(after.averageStarterAge, before.averageStarterAge),
    averageWrcPlus: subtractNullable(after.averageWrcPlus, before.averageWrcPlus),
    benchCount: after.benchCount - before.benchCount,
    filledSlots: after.filledSlots - before.filledSlots,
    limitedConfidenceCount: after.limitedConfidenceCount - before.limitedConfidenceCount,
    lineupPpg: after.lineupPpg - before.lineupPpg,
    lineupSeasonPoints: after.lineupSeasonPoints - before.lineupSeasonPoints,
    rosterCount: after.rosterCount - before.rosterCount
  };
}

export type PitcherImpactUsageOverride = Exclude<
  PitcherUsageRole,
  "No season usage" | "Usage unavailable"
>;

export type PitcherImpactUsageSource = "manual-override" | "observed" | "eligibility-fallback" | "unavailable";
export type PitcherImpactBucket = "SP" | "BUBBLE" | "RP";

export type PitcherImpactPlayer = {
  fallbackBucket?: "SP" | "RP" | null;
  observedRole: PitcherUsageRole | null;
  row: TradePlayerRow;
  usageOverride?: PitcherImpactUsageOverride | null;
};

export type EffectivePitcherUsage = {
  bucket: "SP" | "RP" | null;
  role: PitcherUsageRole | null;
  source: PitcherImpactUsageSource;
};

export type PitcherPlanTargets = {
  bubbleTarget: number;
  rpTarget: number;
  spTarget: number;
};

export type PitcherBucketSummary = {
  averagePip: number | null;
  count: number;
  dynastyMissingCount: number;
  dynastyValue: number;
  limitedUsageCount: number;
  qualityFallbackCount: number;
  scoringMissingCount: number;
  scoringValue: number;
  seasonPoints: number;
  seasonPointsMissingCount: number;
  target: number;
};

export type PitcherBucketProjection = {
  assignments: Map<string, PitcherImpactBucket>;
  buckets: Record<PitcherImpactBucket, PitcherImpactPlayer[]>;
  effectiveUsageByPlayerKey: Map<string, EffectivePitcherUsage>;
  skippedMilb: PitcherImpactPlayer[];
  summaries: Record<PitcherImpactBucket, PitcherBucketSummary>;
  targets: Record<PitcherImpactBucket, number>;
  unclassified: PitcherImpactPlayer[];
};

export type PitcherImpactMovement = {
  afterBucket: PitcherImpactBucket | null;
  afterRoster: boolean;
  beforeBucket: PitcherImpactBucket | null;
  beforeRoster: boolean;
  player: PitcherImpactPlayer;
};

export type PitcherBucketSummaryDelta = Omit<PitcherBucketSummary, "target"> & {
  target: number;
};

export type PitcherTradeImpact = {
  after: PitcherBucketProjection;
  before: PitcherBucketProjection;
  bucketChanges: PitcherImpactMovement[];
  entersPlan: PitcherImpactMovement[];
  leavesPlan: PitcherImpactMovement[];
  rosterArrivals: PitcherImpactMovement[];
  rosterExits: PitcherImpactMovement[];
  skippedMilbIncoming: PitcherImpactPlayer[];
  summaryDelta: Record<PitcherImpactBucket, PitcherBucketSummaryDelta>;
};

export type PitcherTradeImpactInput = {
  currentRoster: PitcherImpactPlayer[];
  dropPlayerKeys?: Iterable<string>;
  incomingPlayers?: PitcherImpactPlayer[];
  outgoingPlayerKeys?: Iterable<string>;
  targets: PitcherPlanTargets;
};

export function effectivePitcherUsage(player: PitcherImpactPlayer): EffectivePitcherUsage {
  if (isImpactUsageRole(player.usageOverride)) {
    return {
      bucket: pitcherRoleBucket(player.usageOverride),
      role: player.usageOverride,
      source: "manual-override"
    };
  }
  if (isImpactUsageRole(player.observedRole)) {
    return {
      bucket: pitcherRoleBucket(player.observedRole),
      role: player.observedRole,
      source: "observed"
    };
  }
  const fallbackBucket = player.fallbackBucket || pitcherEligibilityBucket(player.row.positions);
  if (fallbackBucket) {
    return {
      bucket: fallbackBucket,
      role: null,
      source: "eligibility-fallback"
    };
  }
  return {
    bucket: null,
    role: null,
    source: "unavailable"
  };
}

export function projectPitcherBuckets(
  players: PitcherImpactPlayer[],
  targets: PitcherPlanTargets
): PitcherBucketProjection {
  const normalizedTargets = normalizePitcherTargets(targets);
  const entries = uniqueByPlayerKey(players, (player) => player.row.player_key);
  const skippedMilb = entries.filter((player) => player.row.availabilityCodes.includes("minors"));
  const eligibleEntries = entries.filter((player) => !player.row.availabilityCodes.includes("minors"));
  const effectiveUsageByPlayerKey = new Map(
    eligibleEntries.map((player) => [player.row.player_key, effectivePitcherUsage(player)])
  );
  const spCandidates = eligibleEntries
    .filter((player) => effectiveUsageByPlayerKey.get(player.row.player_key)?.bucket === "SP")
    .sort(comparePitcherImpactQuality);
  const rpCandidates = eligibleEntries
    .filter((player) => effectiveUsageByPlayerKey.get(player.row.player_key)?.bucket === "RP")
    .sort(comparePitcherImpactQuality);
  const confirmedSpTarget = Math.max(0, normalizedTargets.spTarget - normalizedTargets.bubbleTarget);
  const buckets: Record<PitcherImpactBucket, PitcherImpactPlayer[]> = {
    SP: spCandidates.slice(0, confirmedSpTarget),
    BUBBLE: spCandidates.slice(confirmedSpTarget, confirmedSpTarget + normalizedTargets.bubbleTarget),
    RP: rpCandidates.slice(0, normalizedTargets.rpTarget)
  };
  const assignments = new Map<string, PitcherImpactBucket>();
  for (const bucket of ["SP", "BUBBLE", "RP"] as const) {
    for (const player of buckets[bucket]) assignments.set(player.row.player_key, bucket);
  }
  const bucketTargets: Record<PitcherImpactBucket, number> = {
    SP: confirmedSpTarget,
    BUBBLE: normalizedTargets.bubbleTarget,
    RP: normalizedTargets.rpTarget
  };

  return {
    assignments,
    buckets,
    effectiveUsageByPlayerKey,
    skippedMilb,
    summaries: {
      SP: summarizePitcherBucket(buckets.SP, bucketTargets.SP, effectiveUsageByPlayerKey),
      BUBBLE: summarizePitcherBucket(buckets.BUBBLE, bucketTargets.BUBBLE, effectiveUsageByPlayerKey),
      RP: summarizePitcherBucket(buckets.RP, bucketTargets.RP, effectiveUsageByPlayerKey)
    },
    targets: bucketTargets,
    unclassified: eligibleEntries.filter(
      (player) => effectiveUsageByPlayerKey.get(player.row.player_key)?.bucket === null
    )
  };
}

export function analyzePitcherTradeImpact(input: PitcherTradeImpactInput): PitcherTradeImpact {
  const beforeRoster = uniqueByPlayerKey(input.currentRoster, (player) => player.row.player_key);
  const removeKeys = new Set([
    ...normalizeKeys(input.outgoingPlayerKeys),
    ...normalizeKeys(input.dropPlayerKeys)
  ]);
  const afterRosterByKey = new Map(
    beforeRoster
      .filter((player) => !removeKeys.has(player.row.player_key))
      .map((player) => [player.row.player_key, player])
  );
  const skippedMilbIncoming: PitcherImpactPlayer[] = [];
  for (const player of input.incomingPlayers || []) {
    if (!player.row.player_key) continue;
    if (player.row.availabilityCodes.includes("minors")) {
      skippedMilbIncoming.push(player);
      continue;
    }
    afterRosterByKey.set(player.row.player_key, player);
  }
  const afterRoster = [...afterRosterByKey.values()];
  const before = projectPitcherBuckets(beforeRoster, input.targets);
  const after = projectPitcherBuckets(afterRoster, input.targets);
  const movements = buildPitcherMovements(beforeRoster, afterRoster, before, after);

  return {
    after,
    before,
    bucketChanges: movements.filter(
      (movement) =>
        movement.beforeBucket !== null &&
        movement.afterBucket !== null &&
        movement.beforeBucket !== movement.afterBucket
    ),
    entersPlan: movements.filter(
      (movement) => movement.beforeBucket === null && movement.afterBucket !== null
    ),
    leavesPlan: movements.filter(
      (movement) =>
        movement.beforeBucket !== null &&
        movement.afterBucket === null &&
        movement.afterRoster
    ),
    rosterArrivals: movements.filter(
      (movement) => !movement.beforeRoster && movement.afterRoster
    ),
    rosterExits: movements.filter(
      (movement) => movement.beforeRoster && !movement.afterRoster
    ),
    skippedMilbIncoming,
    summaryDelta: {
      SP: subtractPitcherBucketSummaries(after.summaries.SP, before.summaries.SP),
      BUBBLE: subtractPitcherBucketSummaries(after.summaries.BUBBLE, before.summaries.BUBBLE),
      RP: subtractPitcherBucketSummaries(after.summaries.RP, before.summaries.RP)
    }
  };
}

function buildPitcherMovements(
  beforeRoster: PitcherImpactPlayer[],
  afterRoster: PitcherImpactPlayer[],
  before: PitcherBucketProjection,
  after: PitcherBucketProjection
) {
  const beforeByKey = new Map(beforeRoster.map((player) => [player.row.player_key, player]));
  const afterByKey = new Map(afterRoster.map((player) => [player.row.player_key, player]));
  const playerKeys = [...new Set([...beforeByKey.keys(), ...afterByKey.keys()])].sort();

  return playerKeys
    .map((playerKey): PitcherImpactMovement | null => {
      const beforePlayer = beforeByKey.get(playerKey);
      const afterPlayer = afterByKey.get(playerKey);
      const beforeBucket = before.assignments.get(playerKey) || null;
      const afterBucket = after.assignments.get(playerKey) || null;
      const beforeRostered = Boolean(beforePlayer);
      const afterRostered = Boolean(afterPlayer);
      if (
        beforeRostered === afterRostered &&
        beforeBucket === afterBucket
      ) {
        return null;
      }
      return {
        afterBucket,
        afterRoster: afterRostered,
        beforeBucket,
        beforeRoster: beforeRostered,
        player: afterPlayer || beforePlayer!
      };
    })
    .filter((movement): movement is PitcherImpactMovement => movement !== null);
}

function summarizePitcherBucket(
  players: PitcherImpactPlayer[],
  target: number,
  usageByPlayerKey: Map<string, EffectivePitcherUsage>
): PitcherBucketSummary {
  const knownSeasonPoints = players
    .map((player) => finiteNumber(player.row.seasonPoints))
    .filter((value): value is number => value !== null);
  const knownScoringValues = players
    .map((player) => finiteNumber(player.row.scoredValue))
    .filter((value): value is number => value !== null);
  const knownDynastyValues = players
    .map((player) => finiteNumber(player.row.value))
    .filter((value): value is number => value !== null);
  return {
    averagePip: averageMetric(players.map((player) => player.row.pointsPerIp)),
    count: players.length,
    dynastyMissingCount: players.length - knownDynastyValues.length,
    dynastyValue: sum(knownDynastyValues),
    limitedUsageCount: players.filter((player) => {
      const source = usageByPlayerKey.get(player.row.player_key)?.source;
      return source === "eligibility-fallback" || source === "unavailable";
    }).length,
    qualityFallbackCount: players.filter((player) => pitcherQualityBasis(player) !== "scoring").length,
    scoringMissingCount: players.length - knownScoringValues.length,
    scoringValue: sum(knownScoringValues),
    seasonPoints: sum(knownSeasonPoints),
    seasonPointsMissingCount: players.length - knownSeasonPoints.length,
    target
  };
}

function subtractPitcherBucketSummaries(
  after: PitcherBucketSummary,
  before: PitcherBucketSummary
): PitcherBucketSummaryDelta {
  return {
    averagePip: subtractNullable(after.averagePip, before.averagePip),
    count: after.count - before.count,
    dynastyMissingCount: after.dynastyMissingCount - before.dynastyMissingCount,
    dynastyValue: after.dynastyValue - before.dynastyValue,
    limitedUsageCount: after.limitedUsageCount - before.limitedUsageCount,
    qualityFallbackCount: after.qualityFallbackCount - before.qualityFallbackCount,
    scoringMissingCount: after.scoringMissingCount - before.scoringMissingCount,
    scoringValue: after.scoringValue - before.scoringValue,
    seasonPoints: after.seasonPoints - before.seasonPoints,
    seasonPointsMissingCount: after.seasonPointsMissingCount - before.seasonPointsMissingCount,
    target: after.target - before.target
  };
}

function comparePitcherImpactQuality(left: PitcherImpactPlayer, right: PitcherImpactPlayer) {
  for (const getter of [
    (player: PitcherImpactPlayer) => player.row.scoredValue,
    (player: PitcherImpactPlayer) => player.row.pointsPerIp,
    (player: PitcherImpactPlayer) => player.row.value
  ]) {
    const leftValue = finiteNumber(getter(left));
    const rightValue = finiteNumber(getter(right));
    if (leftValue !== null && rightValue === null) return -1;
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue !== null && leftValue !== rightValue) {
      return rightValue - leftValue;
    }
  }
  return (
    left.row.player_name.localeCompare(right.row.player_name) ||
    left.row.player_key.localeCompare(right.row.player_key)
  );
}

function pitcherQualityBasis(player: PitcherImpactPlayer) {
  if (finiteNumber(player.row.scoredValue) !== null) return "scoring";
  if (finiteNumber(player.row.pointsPerIp) !== null) return "p/ip";
  if (finiteNumber(player.row.value) !== null) return "dynasty";
  return "none";
}

function normalizePitcherTargets(targets: PitcherPlanTargets): PitcherPlanTargets {
  const spTarget = nonNegativeInteger(targets.spTarget);
  return {
    bubbleTarget: Math.min(nonNegativeInteger(targets.bubbleTarget), spTarget),
    rpTarget: nonNegativeInteger(targets.rpTarget),
    spTarget
  };
}

function nonNegativeInteger(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function pitcherEligibilityBucket(positions: string | null | undefined): "SP" | "RP" | null {
  const tokens = expandedPositionTokens(positions);
  if (tokens.has("SP")) return "SP";
  if (tokens.has("RP")) return "RP";
  return null;
}

function isImpactUsageRole(value: PitcherUsageRole | null | undefined): value is PitcherImpactUsageOverride {
  return value === "SP" || value === "Mixed - SP" || value === "Mixed - RP" || value === "RP";
}

function pitcherRoleBucket(role: PitcherImpactUsageOverride): "SP" | "RP" {
  return role === "SP" || role === "Mixed - SP" ? "SP" : "RP";
}

function normalizeKeys(keys: Iterable<string> | undefined) {
  if (!keys) return [];
  return [...keys].filter((key) => Boolean(key));
}

function uniqueByPlayerKey<T>(rows: T[], getKey: (row: T) => string) {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const key = getKey(row);
    if (key) byKey.set(key, row);
  }
  return [...byKey.values()];
}

function subtractNullable(after: number | null | undefined, before: number | null | undefined) {
  const afterValue = finiteNumber(after);
  const beforeValue = finiteNumber(before);
  return afterValue !== null && beforeValue !== null ? afterValue - beforeValue : null;
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export const OPTIMAL_LINEUP_SLOT_COUNT = LINEUP_SLOTS.length;
