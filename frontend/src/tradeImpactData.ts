import {
  analyzeHitterTradeImpact,
  analyzePitcherTradeImpact,
  optimalHitterFromTradePlayer,
  type HitterImpactPlayer,
  type HitterTradeImpact,
  type PitcherImpactPlayer,
  type PitcherImpactUsageOverride,
  type PitcherTradeImpact
} from "./tradeImpact";
import type { TradePlayerRow } from "./tradeAnalysis";
import type { OptimalLineupHitter, OptimalLineupResponse, PitcherUsageResponse, PitcherUsageRole } from "./types";

export type TradeImpactWarningCode =
  | "available-hitter-limited"
  | "available-pitcher-usage-unavailable"
  | "missing-optimal-lineup-player"
  | "missing-pitcher-usage-player"
  | "pitcher-usage-unavailable";

export type TradeImpactWarning = {
  code: TradeImpactWarningCode;
  message: string;
  playerKey: string;
  playerName: string;
  teamUid: string | null;
};

export type TradeImpactPitcherPlan = {
  bubbleTarget: number;
  rpTarget: number;
  spTarget: number;
  usageOverrides: Record<string, PitcherImpactUsageOverride>;
};

export type TradeImpactProposal = {
  leagueUid: string;
  myDrops: TradePlayerRow[];
  myTeamRows: TradePlayerRow[];
  myTeamUid: string;
  partnerTeamUid: string;
  playersGiven: TradePlayerRow[];
  playersReceived: TradePlayerRow[];
  season: number;
};

export type TradeImpactDataDependencies = {
  fetchOptimalLineup: (leagueUid: string, teamUid: string, season: number) => Promise<OptimalLineupResponse>;
  fetchPitcherPlan: (leagueUid: string, teamUid: string) => Promise<TradeImpactPitcherPlan | null>;
  fetchPitcherUsage: (leagueUid: string, teamUid: string, season: number) => Promise<PitcherUsageResponse>;
  optimalLineupCache: Map<string, OptimalLineupResponse>;
  pitcherUsageCache: Map<string, PitcherUsageResponse>;
};

export type TradeImpactAnalysisResult = {
  fingerprint: string;
  hitterImpact: HitterTradeImpact;
  loadedTeamUids: string[];
  pitcherImpact: PitcherTradeImpact;
  pitcherPlan: TradeImpactPitcherPlan;
  warnings: TradeImpactWarning[];
};

export type TradeImpactActionStatus = "idle" | "loading" | "ready" | "error";

export type TradeImpactActionState = {
  currentFingerprint: string;
  error: string | null;
  requestedFingerprint: string | null;
  result: TradeImpactAnalysisResult | null;
  stale: boolean;
  status: TradeImpactActionStatus;
};

export type TradeImpactAction =
  | { type: "proposal-changed"; fingerprint: string }
  | { type: "start"; fingerprint: string }
  | { type: "ready"; fingerprint: string; result: TradeImpactAnalysisResult }
  | { type: "error"; error: string; fingerprint: string }
  | { type: "reset"; fingerprint: string };

export function buildTradeImpactFingerprint(proposal: Pick<
  TradeImpactProposal,
  "leagueUid" | "myDrops" | "myTeamUid" | "partnerTeamUid" | "playersGiven" | "playersReceived" | "season"
>) {
  return JSON.stringify({
    version: 1,
    leagueUid: proposal.leagueUid,
    myTeamUid: proposal.myTeamUid,
    partnerTeamUid: proposal.partnerTeamUid,
    season: proposal.season,
    playersGiven: fingerprintRows(proposal.playersGiven),
    playersReceived: fingerprintRows(proposal.playersReceived),
    myDrops: fingerprintRows(proposal.myDrops)
  });
}

export function initialTradeImpactActionState(fingerprint: string): TradeImpactActionState {
  return {
    currentFingerprint: fingerprint,
    error: null,
    requestedFingerprint: null,
    result: null,
    stale: false,
    status: "idle"
  };
}

export function tradeImpactActionReducer(
  state: TradeImpactActionState,
  action: TradeImpactAction
): TradeImpactActionState {
  switch (action.type) {
    case "proposal-changed": {
      if (action.fingerprint === state.currentFingerprint) return state;
      if (state.result) {
        return {
          ...state,
          currentFingerprint: action.fingerprint,
          error: null,
          requestedFingerprint: null,
          stale: state.result.fingerprint !== action.fingerprint,
          status: "ready"
        };
      }
      return initialTradeImpactActionState(action.fingerprint);
    }
    case "start":
      return {
        ...state,
        currentFingerprint: action.fingerprint,
        error: null,
        requestedFingerprint: action.fingerprint,
        stale: Boolean(state.result && state.result.fingerprint !== action.fingerprint),
        status: "loading"
      };
    case "ready":
      return {
        currentFingerprint: state.currentFingerprint,
        error: null,
        requestedFingerprint: action.fingerprint,
        result: action.result,
        stale: action.fingerprint !== state.currentFingerprint,
        status: "ready"
      };
    case "error":
      return {
        ...state,
        error: action.error,
        requestedFingerprint: action.fingerprint,
        stale: Boolean(state.result && state.result.fingerprint !== state.currentFingerprint),
        status: "error"
      };
    case "reset":
      return initialTradeImpactActionState(action.fingerprint);
  }
}

export async function loadTradeImpactAnalysis(
  proposal: TradeImpactProposal,
  dependencies: TradeImpactDataDependencies
): Promise<TradeImpactAnalysisResult> {
  if (!proposal.leagueUid || !proposal.myTeamUid) {
    throw new Error("Select a league and My Team before running Impact Analysis.");
  }

  const fingerprint = buildTradeImpactFingerprint(proposal);
  const incomingOwnerTeamUids = uniqueStrings(
    proposal.playersReceived
      .map((row) => row.ownerTeamUid)
      .filter((teamUid): teamUid is string => Boolean(teamUid && teamUid !== proposal.myTeamUid))
  );
  const loadedTeamUids = uniqueStrings([proposal.myTeamUid, ...incomingOwnerTeamUids]);
  const [teamResponses, loadedPitcherPlan] = await Promise.all([
    Promise.all(
      loadedTeamUids.map(async (teamUid) => {
        const cacheKey = tradeImpactTeamCacheKey(proposal.leagueUid, teamUid, proposal.season);
        const [optimalLineup, pitcherUsage] = await Promise.all([
          loadCached(
            dependencies.optimalLineupCache,
            cacheKey,
            () => dependencies.fetchOptimalLineup(proposal.leagueUid, teamUid, proposal.season)
          ),
          loadCached(
            dependencies.pitcherUsageCache,
            cacheKey,
            () => dependencies.fetchPitcherUsage(proposal.leagueUid, teamUid, proposal.season)
          )
        ]);
        return { optimalLineup, pitcherUsage, teamUid };
      })
    ),
    dependencies.fetchPitcherPlan(proposal.leagueUid, proposal.myTeamUid)
  ]);
  const teamResponseByUid = new Map(teamResponses.map((response) => [response.teamUid, response]));
  const pitcherPlan = normalizeTradeImpactPitcherPlan(loadedPitcherPlan);
  const warnings: TradeImpactWarning[] = [];
  const myTeamResponse = teamResponseByUid.get(proposal.myTeamUid);
  if (!myTeamResponse) throw new Error("My Team impact data could not be loaded.");

  const myRowsByKey = new Map(proposal.myTeamRows.map((row) => [row.player_key, row]));
  const selectedMyRows = uniqueRows([...proposal.playersGiven, ...proposal.myDrops]);
  const currentHitters = buildCurrentHitters(
    myTeamResponse.optimalLineup.rows,
    myRowsByKey,
    selectedMyRows,
    warnings,
    proposal.myTeamUid
  );
  const incomingHitters = proposal.playersReceived
    .filter((row) => row.section === "hitter")
    .map((row) => buildIncomingHitter(row, teamResponseByUid, warnings));

  const usageByMyPlayerKey = new Map(
    myTeamResponse.pitcherUsage.rows.map((row) => [row.player_key, row])
  );
  const selectedMyPitcherKeys = new Set(
    selectedMyRows.filter((row) => row.section === "pitcher").map((row) => row.player_key)
  );
  const currentPitchers = proposal.myTeamRows
    .filter((row) => row.section === "pitcher")
    .map((row) => {
      const usage = usageByMyPlayerKey.get(row.player_key) || null;
      if (!usage && selectedMyPitcherKeys.has(row.player_key)) {
        warnings.push(missingPitcherUsageWarning(row, proposal.myTeamUid));
      }
      return impactPitcherFromTradeRow(
        row,
        usage?.role || null,
        usage?.bucket || null,
        pitcherPlan.usageOverrides[row.player_key] || null
      );
    });
  const incomingPitchers = proposal.playersReceived
    .filter((row) => row.section === "pitcher")
    .map((row) => buildIncomingPitcher(row, teamResponseByUid, warnings));

  return {
    fingerprint,
    hitterImpact: analyzeHitterTradeImpact({
      currentRoster: currentHitters,
      dropPlayerKeys: proposal.myDrops.map((row) => row.player_key),
      incomingPlayers: incomingHitters,
      outgoingPlayerKeys: proposal.playersGiven.map((row) => row.player_key)
    }),
    loadedTeamUids,
    pitcherImpact: analyzePitcherTradeImpact({
      currentRoster: currentPitchers,
      dropPlayerKeys: proposal.myDrops.map((row) => row.player_key),
      incomingPlayers: incomingPitchers,
      outgoingPlayerKeys: proposal.playersGiven.map((row) => row.player_key),
      targets: pitcherPlan
    }),
    pitcherPlan,
    warnings: uniqueWarnings(warnings)
  };
}

export function tradeImpactTeamCacheKey(leagueUid: string, teamUid: string, season: number) {
  return `${leagueUid}:${teamUid}:${season}`;
}

function buildCurrentHitters(
  optimalRows: OptimalLineupHitter[],
  myRowsByKey: Map<string, TradePlayerRow>,
  selectedMyRows: TradePlayerRow[],
  warnings: TradeImpactWarning[],
  myTeamUid: string
) {
  const current = new Map<string, HitterImpactPlayer>();
  for (const row of optimalRows) {
    const tradeRow = myRowsByKey.get(row.player_key);
    current.set(row.player_key, {
      age: finiteNumber(tradeRow?.age),
      dataQuality: "full",
      isMilb: Boolean(tradeRow?.availabilityCodes.includes("minors")),
      row
    });
  }
  for (const tradeRow of selectedMyRows) {
    if (tradeRow.section !== "hitter" || current.has(tradeRow.player_key) || tradeRow.availabilityCodes.includes("minors")) {
      continue;
    }
    warnings.push(missingOptimalLineupWarning(tradeRow, myTeamUid));
    current.set(tradeRow.player_key, optimalHitterFromTradePlayer(tradeRow));
  }
  return [...current.values()];
}

function buildIncomingHitter(
  row: TradePlayerRow,
  teamResponseByUid: Map<string, { optimalLineup: OptimalLineupResponse; pitcherUsage: PitcherUsageResponse; teamUid: string }>,
  warnings: TradeImpactWarning[]
): HitterImpactPlayer {
  if (!row.ownerTeamUid) {
    const availableDataNote = finiteNumber(row.pointsPerGame) === null
      ? "limited lineup data because neither team wRC+ nor P/G is available"
      : "a P/G-only estimate because team wRC+ data is unavailable";
    warnings.push({
      code: "available-hitter-limited",
      message: `${row.player_name} uses ${availableDataNote}.`,
      playerKey: row.player_key,
      playerName: row.player_name,
      teamUid: null
    });
    return optimalHitterFromTradePlayer(row);
  }
  const optimalRow = teamResponseByUid
    .get(row.ownerTeamUid)
    ?.optimalLineup.rows.find((candidate) => candidate.player_key === row.player_key);
  if (!optimalRow) {
    warnings.push(missingOptimalLineupWarning(row, row.ownerTeamUid));
    return optimalHitterFromTradePlayer(row);
  }
  return {
    age: finiteNumber(row.age),
    dataQuality: "full",
    isMilb: row.availabilityCodes.includes("minors"),
    row: optimalRow
  };
}

function buildIncomingPitcher(
  row: TradePlayerRow,
  teamResponseByUid: Map<string, { optimalLineup: OptimalLineupResponse; pitcherUsage: PitcherUsageResponse; teamUid: string }>,
  warnings: TradeImpactWarning[]
): PitcherImpactPlayer {
  if (!row.ownerTeamUid) {
    warnings.push({
      code: "available-pitcher-usage-unavailable",
      message: `${row.player_name} has no observed team usage; Impact Analysis uses position eligibility as a lower-confidence fallback.`,
      playerKey: row.player_key,
      playerName: row.player_name,
      teamUid: null
    });
    return impactPitcherFromTradeRow(row, null, null, null);
  }
  const usage = teamResponseByUid
    .get(row.ownerTeamUid)
    ?.pitcherUsage.rows.find((candidate) => candidate.player_key === row.player_key) || null;
  if (!usage) {
    warnings.push(missingPitcherUsageWarning(row, row.ownerTeamUid));
    return impactPitcherFromTradeRow(row, null, null, null);
  }
  if (!isObservedPitcherRole(usage.role)) {
    warnings.push({
      code: "pitcher-usage-unavailable",
      message: `${row.player_name} has no usable observed role; Impact Analysis uses ${usage.bucket} eligibility as a lower-confidence fallback.`,
      playerKey: row.player_key,
      playerName: row.player_name,
      teamUid: row.ownerTeamUid
    });
  }
  return impactPitcherFromTradeRow(row, usage.role, usage.bucket, null);
}

function impactPitcherFromTradeRow(
  row: TradePlayerRow,
  observedRole: PitcherUsageRole | null,
  fallbackBucket: "SP" | "RP" | null,
  usageOverride: PitcherImpactUsageOverride | null
): PitcherImpactPlayer {
  return {
    fallbackBucket,
    observedRole,
    row,
    usageOverride
  };
}

function missingOptimalLineupWarning(row: TradePlayerRow, teamUid: string): TradeImpactWarning {
  const fallbackNote = finiteNumber(row.pointsPerGame) === null
    ? "limited lineup data because no P/G fallback is available"
    : "a P/G-only fallback";
  return {
    code: "missing-optimal-lineup-player",
    message: `${row.player_name} was missing from team Optimal Lineup data; ${fallbackNote} is used.`,
    playerKey: row.player_key,
    playerName: row.player_name,
    teamUid
  };
}

function missingPitcherUsageWarning(row: TradePlayerRow, teamUid: string): TradeImpactWarning {
  return {
    code: "missing-pitcher-usage-player",
    message: `${row.player_name} was missing from team Pitcher Usage data; position eligibility is used as a lower-confidence fallback.`,
    playerKey: row.player_key,
    playerName: row.player_name,
    teamUid
  };
}

function normalizeTradeImpactPitcherPlan(plan: TradeImpactPitcherPlan | null): TradeImpactPitcherPlan {
  const spTarget = nonNegativeInteger(plan?.spTarget, 5);
  const bubbleTarget = Math.min(nonNegativeInteger(plan?.bubbleTarget, 0), spTarget);
  const usageOverrides: Record<string, PitcherImpactUsageOverride> = {};
  for (const [playerKey, role] of Object.entries(plan?.usageOverrides || {})) {
    if (!playerKey || !isObservedPitcherRole(role)) continue;
    usageOverrides[playerKey] = role;
  }
  return {
    bubbleTarget,
    rpTarget: nonNegativeInteger(plan?.rpTarget, 5),
    spTarget,
    usageOverrides
  };
}

function isObservedPitcherRole(role: PitcherUsageRole | null | undefined): role is PitcherImpactUsageOverride {
  return role === "SP" || role === "Mixed - SP" || role === "Mixed - RP" || role === "RP";
}

function fingerprintRows(rows: TradePlayerRow[]) {
  return uniqueRows(rows)
    .map((row) => `${row.ownerTeamUid || "available"}:${row.player_key}`)
    .sort();
}

function uniqueRows(rows: TradePlayerRow[]) {
  const byIdentity = new Map<string, TradePlayerRow>();
  for (const row of rows) {
    byIdentity.set(`${row.ownerTeamUid || "available"}:${row.player_key}`, row);
  }
  return [...byIdentity.values()];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function uniqueWarnings(warnings: TradeImpactWarning[]) {
  const byIdentity = new Map<string, TradeImpactWarning>();
  for (const warning of warnings) {
    byIdentity.set(`${warning.code}:${warning.teamUid || "available"}:${warning.playerKey}`, warning);
  }
  return [...byIdentity.values()];
}

async function loadCached<T>(cache: Map<string, T>, key: string, load: () => Promise<T>) {
  const cached = cache.get(key);
  if (cached) return cached;
  const result = await load();
  cache.set(key, result);
  return result;
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nonNegativeInteger(value: number | null | undefined, fallback: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : fallback;
}