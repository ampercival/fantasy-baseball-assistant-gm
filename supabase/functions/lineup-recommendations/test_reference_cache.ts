import assert from "node:assert/strict";
import type { Row } from "../_shared/fangraphs.ts";
import {
  MLB_TEAM_OFFENSE_SNAPSHOT_TEAM_COUNT,
  resolveLineupReferenceData,
} from "./reference-data.ts";
import {
  persistLineupReferencePatch,
  type ReferenceCachePatchWriter,
} from "./reference-persistence.ts";

const MLB_TEAM_CODES = [
  "ARI", "ATH", "ATL", "BAL", "BOS", "CHC", "CHW", "CIN", "CLE", "COL",
  "DET", "HOU", "KCR", "LAA", "LAD", "MIA", "MIL", "MIN", "NYM", "NYY",
  "PHI", "PIT", "SDP", "SEA", "SFG", "STL", "TBR", "TEX", "TOR", "WSN",
];

function completeOffenseSnapshot(overrides: Record<string, Row> = {}): Record<string, Row> {
  assert.equal(MLB_TEAM_CODES.length, MLB_TEAM_OFFENSE_SNAPSHOT_TEAM_COUNT);
  return {
    ...Object.fromEntries(
      MLB_TEAM_CODES.map((teamCode, index) => [
        teamCode,
        {
          aggregate_rank: index + 1,
          source: "live leaderboard",
          team_code: teamCode,
          team_count: MLB_TEAM_OFFENSE_SNAPSHOT_TEAM_COUNT,
        },
      ]),
    ),
    ...overrides,
  };
}

async function run(): Promise<void> {
const now = new Date("2026-08-22T12:00:00Z");
const pitchers = [
  {
    pitcher_key: "cached ace",
    pitcher_name: "Cached Ace",
    fangraphs_id: 1,
    fangraphs_url: "https://example.test/1",
  },
  {
    pitcher_key: "missing arm",
    pitcher_name: "Missing Arm",
    fangraphs_id: 2,
    fangraphs_url: "https://example.test/2",
  },
];

const fetchedPitcherIds: number[] = [];
let offenseFetchCount = 0;
const partialResult = await resolveLineupReferenceData({
  season: 2026,
  probablePitchers: pitchers,
  opponentTeamCodes: ["BOS", "NYY"],
  cachedStats: {
    "cached ace": { xfip_minus: 75, source: "cached leaderboard" },
    "missing arm": { xfip_minus: null, source: "incomplete cached leaderboard" },
  },
  cachedOffenseRanks: {
    BOS: { aggregate_rank: 5, source: "cached leaderboard" },
  },
  referenceCacheFetchedAt: "2026-08-22T08:00:00Z",
  now,
  fetchPitcherXfipMinus: async (playerId) => {
    fetchedPitcherIds.push(Number(playerId));
    return 120;
  },
  fetchTeamOffenseRanks: async () => {
    offenseFetchCount++;
    return completeOffenseSnapshot({
      BOS: { aggregate_rank: 8, source: "live leaderboard" },
      NYY: { aggregate_rank: 2, source: "live leaderboard" },
      TOR: { aggregate_rank: 4, source: "live leaderboard" },
    });
  },
});

assert.deepEqual(fetchedPitcherIds, [2]);
assert.equal(offenseFetchCount, 1);
assert.equal(partialResult.statsByKey["cached ace"].xfip_minus, 75);
assert.equal(partialResult.statsByKey["missing arm"].xfip_minus, 120);
assert.equal(partialResult.statsByKey["cached ace"].reference_provenance, "home-worker-cache");
assert.equal(partialResult.statsByKey["cached ace"].reference_confidence, "high");
assert.equal(partialResult.statsByKey["cached ace"].source, "cached leaderboard");
assert.equal(partialResult.statsByKey["missing arm"].reference_provenance, "live-fangraphs");
assert.equal(partialResult.statsByKey["missing arm"].reference_confidence, "high");
assert.equal(partialResult.statsByKey["missing arm"].source, "FanGraphs player page");
assert.equal(partialResult.xfipRefresh.required_row_count, 2);
assert.equal(partialResult.xfipRefresh.cached_row_count, 1);
assert.equal(partialResult.xfipRefresh.live_row_count, 1);
assert.equal(partialResult.xfipRefresh.missing_row_count, 0);
assert.equal(partialResult.xfipRefresh.source, "home-worker cache + FanGraphs player pages gap fill");
assert.match(partialResult.xfipRefresh.message, /filled 1\/1 missing fetchable rows/);

// Offense ranks are league-relative, so an incomplete cache triggers one complete live
// snapshot instead of combining cached and live ranks calculated at different times.
assert.equal(partialResult.offenseRanks.BOS.aggregate_rank, 8);
assert.equal(partialResult.offenseRanks.NYY.aggregate_rank, 2);
assert.equal(partialResult.offenseRanks.BOS.reference_provenance, "live-fangraphs");
assert.equal(partialResult.offenseRanks.BOS.reference_confidence, "high");
assert.equal(partialResult.offenseRanks.BOS.source, "live leaderboard");
assert.equal(partialResult.opponentOffenseRefresh.team_count, 30);
assert.equal(partialResult.opponentOffenseRefresh.required_team_count, 2);
assert.equal(partialResult.opponentOffenseRefresh.cache_hit_team_count, 1);
assert.equal(partialResult.opponentOffenseRefresh.cached_team_count, 0);
assert.equal(partialResult.opponentOffenseRefresh.live_team_count, 2);
assert.equal(partialResult.opponentOffenseRefresh.missing_team_count, 0);
assert.equal(partialResult.opponentOffenseRefresh.source, "FanGraphs team offense leaderboard");
assert.match(partialResult.opponentOffenseRefresh.message, /refreshed a 30-team FanGraphs snapshot/);
assert.match(partialResult.source, /home-worker cache \+ FanGraphs player pages gap fill/);
assert.match(partialResult.source, /team offense via FanGraphs team offense leaderboard/);
assert.deepEqual(Object.keys(partialResult.persistencePatch.pitcherStats), ["missing arm"]);
assert.equal(partialResult.persistencePatch.pitcherStats["missing arm"].xfip_minus, 120);
assert.equal(partialResult.persistencePatch.pitcherStats["missing arm"].reference_provenance, "live-fangraphs");
assert.equal(Object.keys(partialResult.persistencePatch.offenseRanksSnapshot ?? {}).length, 30);
assert.equal(partialResult.persistencePatch.offenseRanksSnapshot?.NYY.aggregate_rank, 2);

let redundantFetchCount = 0;
const completeCacheResult = await resolveLineupReferenceData({
  season: 2026,
  probablePitchers: pitchers,
  opponentTeamCodes: ["BOS", "NYY"],
  cachedStats: {
    "cached ace": { xfip_minus: 75 },
    "missing arm": { xfip_minus: 95 },
  },
  cachedOffenseRanks: {
    BOS: { aggregate_rank: 5 },
    NYY: { aggregate_rank: 2 },
  },
  referenceCacheFetchedAt: "2026-08-22T08:00:00Z",
  now,
  fetchPitcherXfipMinus: async () => {
    redundantFetchCount++;
    throw new Error("complete pitcher cache should not fetch");
  },
  fetchTeamOffenseRanks: async () => {
    redundantFetchCount++;
    throw new Error("complete offense cache should not fetch");
  },
});

assert.equal(redundantFetchCount, 0);
assert.equal(completeCacheResult.xfipRefresh.cached_row_count, 2);
assert.equal(completeCacheResult.xfipRefresh.live_row_count, 0);
assert.equal(completeCacheResult.xfipRefresh.source, "home-worker cache");
assert.equal(completeCacheResult.statsByKey["missing arm"].reference_provenance, "home-worker-cache");
assert.equal(completeCacheResult.statsByKey["missing arm"].reference_confidence, "high");
assert.equal(completeCacheResult.opponentOffenseRefresh.cached_team_count, 2);
assert.equal(completeCacheResult.opponentOffenseRefresh.live_team_count, 0);
assert.equal(completeCacheResult.opponentOffenseRefresh.source, "home-worker cache");
assert.equal(completeCacheResult.offenseRanks.BOS.reference_provenance, "home-worker-cache");
assert.equal(completeCacheResult.offenseRanks.BOS.reference_confidence, "high");
assert.deepEqual(completeCacheResult.persistencePatch.pitcherStats, {});
assert.equal(completeCacheResult.persistencePatch.offenseRanksSnapshot, null);

const stalePitcherIds: number[] = [];
let staleOffenseFetchCount = 0;
const staleCacheResult = await resolveLineupReferenceData({
  season: 2026,
  probablePitchers: pitchers,
  opponentTeamCodes: ["BOS", "NYY"],
  cachedStats: {
    "cached ace": { xfip_minus: 75 },
    "missing arm": { xfip_minus: 95 },
  },
  cachedOffenseRanks: {
    BOS: { aggregate_rank: 5 },
    NYY: { aggregate_rank: 2 },
  },
  referenceCacheFetchedAt: "2026-08-21T15:00:00Z",
  now,
  fetchPitcherXfipMinus: async (playerId) => {
    stalePitcherIds.push(Number(playerId));
    return 100 + Number(playerId);
  },
  fetchTeamOffenseRanks: async () => {
    staleOffenseFetchCount++;
    return completeOffenseSnapshot({
      BOS: { aggregate_rank: 7 },
      NYY: { aggregate_rank: 3 },
    });
  },
});

assert.deepEqual(stalePitcherIds.sort(), [1, 2]);
assert.equal(staleOffenseFetchCount, 1);
assert.equal(staleCacheResult.referenceCache.status, "stale");
assert.equal(staleCacheResult.referenceCache.age_hours, 21);
assert.equal(staleCacheResult.referenceCache.max_age_hours, 20);
assert.equal(staleCacheResult.xfipRefresh.cached_row_count, 0);
assert.equal(staleCacheResult.xfipRefresh.live_row_count, 2);
assert.equal(staleCacheResult.xfipRefresh.source, "FanGraphs player pages");
assert.match(staleCacheResult.xfipRefresh.message, /Ignored stale home-worker reference data/);
assert.equal(staleCacheResult.opponentOffenseRefresh.cached_team_count, 0);
assert.equal(staleCacheResult.opponentOffenseRefresh.live_team_count, 2);
assert.equal(staleCacheResult.opponentOffenseRefresh.source, "FanGraphs team offense leaderboard");
assert.equal(Object.keys(staleCacheResult.persistencePatch.pitcherStats).length, 2);
assert.equal(Object.keys(staleCacheResult.persistencePatch.offenseRanksSnapshot ?? {}).length, 30);

let incompleteOffenseFetchCount = 0;
const incompleteLiveOffenseResult = await resolveLineupReferenceData({
  season: 2026,
  probablePitchers: pitchers,
  opponentTeamCodes: ["BOS", "NYY"],
  cachedStats: {
    "cached ace": { xfip_minus: 75 },
    "missing arm": { xfip_minus: 95 },
  },
  cachedOffenseRanks: { BOS: { aggregate_rank: 5 } },
  referenceCacheFetchedAt: "2026-08-22T08:00:00Z",
  now,
  fetchPitcherXfipMinus: async () => {
    throw new Error("complete pitcher cache should not fetch");
  },
  fetchTeamOffenseRanks: async () => {
    incompleteOffenseFetchCount++;
    return {
      BOS: { aggregate_rank: 8 },
      NYY: { aggregate_rank: 2 },
      TOR: { aggregate_rank: 4 },
    };
  },
});

assert.equal(incompleteOffenseFetchCount, 1);
assert.equal(incompleteLiveOffenseResult.offenseRanks.BOS.aggregate_rank, 5);
assert.equal(incompleteLiveOffenseResult.offenseRanks.NYY, undefined);
assert.equal(incompleteLiveOffenseResult.opponentOffenseRefresh.cached_team_count, 1);
assert.equal(incompleteLiveOffenseResult.opponentOffenseRefresh.live_team_count, 0);
assert.equal(incompleteLiveOffenseResult.opponentOffenseRefresh.live_snapshot_team_count, 3);
assert.equal(incompleteLiveOffenseResult.opponentOffenseRefresh.missing_team_count, 1);
assert.equal(incompleteLiveOffenseResult.opponentOffenseRefresh.source, "home-worker cache");
assert.match(incompleteLiveOffenseResult.opponentOffenseRefresh.message, /contained 3\/30 MLB teams, so it was not used/);
assert.deepEqual(incompleteLiveOffenseResult.persistencePatch.pitcherStats, {});
assert.equal(incompleteLiveOffenseResult.persistencePatch.offenseRanksSnapshot, null);

const failedFillResult = await resolveLineupReferenceData({
  season: 2026,
  probablePitchers: [
    ...pitchers,
    {
      pitcher_key: "null arm",
      pitcher_name: "Null Arm",
      fangraphs_id: 3,
      fangraphs_url: "https://example.test/3",
    },
  ],
  opponentTeamCodes: ["BOS", "NYY"],
  cachedStats: { "cached ace": { xfip_minus: 75 } },
  cachedOffenseRanks: { BOS: { aggregate_rank: 5 } },
  referenceCacheFetchedAt: "2026-08-22T08:00:00Z",
  now,
  fetchPitcherXfipMinus: async (playerId) => {
    if (Number(playerId) === 2) throw new Error("pitcher unavailable");
    return null;
  },
  fetchTeamOffenseRanks: async () => {
    throw new Error("leaderboard unavailable");
  },
});

assert.equal(failedFillResult.statsByKey["cached ace"].xfip_minus, 75);
assert.equal(failedFillResult.xfipRefresh.cached_row_count, 1);
assert.equal(failedFillResult.xfipRefresh.live_row_count, 0);
assert.equal(failedFillResult.xfipRefresh.error_count, 1);
assert.equal(failedFillResult.xfipRefresh.missing_row_count, 2);
assert.equal(failedFillResult.xfipRefresh.source, "home-worker cache");
assert.equal(failedFillResult.opponentOffenseRefresh.cached_team_count, 1);
assert.equal(failedFillResult.opponentOffenseRefresh.missing_team_count, 1);
assert.equal(failedFillResult.opponentOffenseRefresh.source, "home-worker cache");
assert.equal(failedFillResult.opponentOffenseRefresh.error, "leaderboard unavailable");
assert.match(failedFillResult.opponentOffenseRefresh.message, /refresh failed: leaderboard unavailable/);
assert.deepEqual(failedFillResult.persistencePatch.pitcherStats, {});
assert.equal(failedFillResult.persistencePatch.offenseRanksSnapshot, null);

const storedCache: {
  season: number;
  fetchedAt: string;
  pitcherStats: Record<string, Row>;
  offenseRanks: Record<string, Row>;
} = {
  season: 2026,
  fetchedAt: "2026-08-22T08:00:00Z",
  pitcherStats: {
    "cached ace": { xfip_minus: 75, source: "cached leaderboard" },
    "missing arm": { xfip_minus: null, source: "incomplete cached leaderboard" },
  },
  offenseRanks: { BOS: { aggregate_rank: 5, source: "cached leaderboard" } },
};
let freshWriteCount = 0;
const mergingWriter: ReferenceCachePatchWriter = async (patch) => {
  freshWriteCount++;
  if (patch.season !== storedCache.season || patch.expectedFetchedAt !== storedCache.fetchedAt) return false;
  assert.equal(patch.maxAgeHours, 20);
  storedCache.pitcherStats = { ...storedCache.pitcherStats, ...patch.pitcherStats };
  if (patch.offenseRanksSnapshot != null) {
    storedCache.offenseRanks = { ...patch.offenseRanksSnapshot };
  }
  return true;
};

const freshPersistence = await persistLineupReferencePatch({
  season: 2026,
  referenceCache: partialResult.referenceCache,
  patch: partialResult.persistencePatch,
  writer: mergingWriter,
  now,
});
assert.equal(freshWriteCount, 1);
assert.equal(freshPersistence.status, "persisted");
assert.equal(freshPersistence.attempted, true);
assert.equal(freshPersistence.pitcher_row_count, 1);
assert.equal(freshPersistence.offense_team_count, 30);
assert.match(freshPersistence.message, /without changing cache freshness/);
assert.equal(storedCache.fetchedAt, "2026-08-22T08:00:00Z");
assert.equal(storedCache.pitcherStats["cached ace"].xfip_minus, 75);
assert.equal(storedCache.pitcherStats["missing arm"].xfip_minus, 120);
assert.equal(storedCache.offenseRanks.BOS.aggregate_rank, 8);
assert.equal(storedCache.offenseRanks.NYY.aggregate_rank, 2);
assert.equal(storedCache.offenseRanks.TOR.aggregate_rank, 4);

const disjointPitcherPersistence = await persistLineupReferencePatch({
  season: 2026,
  referenceCache: partialResult.referenceCache,
  patch: {
    pitcherStats: {
      "another arm": { xfip_minus: 88, source: "second live request" },
    },
    offenseRanksSnapshot: null,
  },
  writer: mergingWriter,
  now,
});
assert.equal(disjointPitcherPersistence.status, "persisted");
assert.equal(storedCache.pitcherStats["missing arm"].xfip_minus, 120);
assert.equal(storedCache.pitcherStats["another arm"].xfip_minus, 88);
assert.equal(storedCache.fetchedAt, "2026-08-22T08:00:00Z");

let nextResolverUpstreamCalls = 0;
const nextResolverResult = await resolveLineupReferenceData({
  season: 2026,
  probablePitchers: pitchers,
  opponentTeamCodes: ["BOS", "NYY"],
  cachedStats: storedCache.pitcherStats,
  cachedOffenseRanks: storedCache.offenseRanks,
  referenceCacheFetchedAt: storedCache.fetchedAt,
  now,
  fetchPitcherXfipMinus: async () => {
    nextResolverUpstreamCalls++;
    throw new Error("the merged cache should prevent duplicate pitcher requests");
  },
  fetchTeamOffenseRanks: async () => {
    nextResolverUpstreamCalls++;
    throw new Error("the accepted offense snapshot should prevent duplicate requests");
  },
});
assert.equal(nextResolverUpstreamCalls, 0);
assert.equal(nextResolverResult.statsByKey["missing arm"].xfip_minus, 120);
assert.equal(nextResolverResult.statsByKey["missing arm"].reference_provenance, "home-worker-cache");
assert.equal(nextResolverResult.statsByKey["missing arm"].reference_confidence, "high");
assert.equal(nextResolverResult.statsByKey["missing arm"].source, "FanGraphs player page");
assert.equal(nextResolverResult.offenseRanks.NYY.reference_provenance, "home-worker-cache");
assert.equal(nextResolverResult.offenseRanks.NYY.reference_confidence, "high");
assert.equal(nextResolverResult.offenseRanks.NYY.source, "live leaderboard");
assert.deepEqual(nextResolverResult.persistencePatch.pitcherStats, {});
assert.equal(nextResolverResult.persistencePatch.offenseRanksSnapshot, null);

let noOpWriteCount = 0;
const noOpPersistence = await persistLineupReferencePatch({
  season: 2026,
  referenceCache: completeCacheResult.referenceCache,
  patch: completeCacheResult.persistencePatch,
  writer: async () => {
    noOpWriteCount++;
    return true;
  },
});
assert.equal(noOpWriteCount, 0);
assert.deepEqual(noOpPersistence, {
  status: "not-needed",
  attempted: false,
  pitcher_row_count: 0,
  offense_team_count: 0,
  message: "No successful live reference-data gap fills needed persistence.",
});

let staleWriteCount = 0;
const stalePersistence = await persistLineupReferencePatch({
  season: 2026,
  referenceCache: staleCacheResult.referenceCache,
  patch: staleCacheResult.persistencePatch,
  writer: async () => {
    staleWriteCount++;
    return true;
  },
});
assert.equal(staleWriteCount, 0);
assert.equal(stalePersistence.status, "skipped-stale");
assert.equal(stalePersistence.attempted, false);
assert.equal(stalePersistence.pitcher_row_count, 0);
assert.equal(stalePersistence.offense_team_count, 0);

let boundaryWriteCount = 0;
const boundaryCrossedPersistence = await persistLineupReferencePatch({
  season: 2026,
  referenceCache: partialResult.referenceCache,
  patch: partialResult.persistencePatch,
  writer: async () => {
    boundaryWriteCount++;
    return true;
  },
  now: new Date("2026-08-23T04:00:01Z"),
});
assert.equal(boundaryWriteCount, 0);
assert.equal(boundaryCrossedPersistence.status, "skipped-stale");
assert.equal(boundaryCrossedPersistence.attempted, false);

const raceLossPersistence = await persistLineupReferencePatch({
  season: 2026,
  referenceCache: partialResult.referenceCache,
  patch: partialResult.persistencePatch,
  writer: async () => false,
  now,
});
assert.equal(raceLossPersistence.status, "race-lost");
assert.equal(raceLossPersistence.attempted, true);
assert.equal(raceLossPersistence.pitcher_row_count, 0);
assert.equal(raceLossPersistence.offense_team_count, 0);
assert.match(raceLossPersistence.message, /changed, became stale, or disappeared/);

const failedPersistence = await persistLineupReferencePatch({
  season: 2026,
  referenceCache: partialResult.referenceCache,
  patch: partialResult.persistencePatch,
  writer: async () => {
    throw new Error("database unavailable");
  },
  now,
});
assert.equal(failedPersistence.status, "failed");
assert.equal(failedPersistence.attempted, true);
assert.equal(failedPersistence.pitcher_row_count, 0);
assert.equal(failedPersistence.offense_team_count, 0);
assert.match(failedPersistence.message, /database unavailable/);

console.log("Lineup partial reference-cache tests passed.");
}

run().catch((error) => {
  throw error;
});
