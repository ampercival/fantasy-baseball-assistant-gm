import assert from "node:assert/strict";
import { resolveLineupReferenceData } from "./reference-data.ts";

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
    return {
      BOS: { aggregate_rank: 8, source: "live leaderboard" },
      NYY: { aggregate_rank: 2, source: "live leaderboard" },
      TOR: { aggregate_rank: 4, source: "live leaderboard" },
    };
  },
});

assert.deepEqual(fetchedPitcherIds, [2]);
assert.equal(offenseFetchCount, 1);
assert.equal(partialResult.statsByKey["cached ace"].xfip_minus, 75);
assert.equal(partialResult.statsByKey["missing arm"].xfip_minus, 120);
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
assert.equal(partialResult.opponentOffenseRefresh.team_count, 3);
assert.equal(partialResult.opponentOffenseRefresh.required_team_count, 2);
assert.equal(partialResult.opponentOffenseRefresh.cache_hit_team_count, 1);
assert.equal(partialResult.opponentOffenseRefresh.cached_team_count, 0);
assert.equal(partialResult.opponentOffenseRefresh.live_team_count, 2);
assert.equal(partialResult.opponentOffenseRefresh.missing_team_count, 0);
assert.equal(partialResult.opponentOffenseRefresh.source, "FanGraphs team offense leaderboard");
assert.match(partialResult.opponentOffenseRefresh.message, /refreshed a 3-team FanGraphs snapshot/);
assert.match(partialResult.source, /home-worker cache \+ FanGraphs player pages gap fill/);
assert.match(partialResult.source, /team offense via FanGraphs team offense leaderboard/);

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
assert.equal(completeCacheResult.opponentOffenseRefresh.cached_team_count, 2);
assert.equal(completeCacheResult.opponentOffenseRefresh.live_team_count, 0);
assert.equal(completeCacheResult.opponentOffenseRefresh.source, "home-worker cache");

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
    return {
      BOS: { aggregate_rank: 7 },
      NYY: { aggregate_rank: 3 },
    };
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
    return { NYY: { aggregate_rank: 2 } };
  },
});

assert.equal(incompleteOffenseFetchCount, 1);
assert.equal(incompleteLiveOffenseResult.offenseRanks.BOS.aggregate_rank, 5);
assert.equal(incompleteLiveOffenseResult.offenseRanks.NYY, undefined);
assert.equal(incompleteLiveOffenseResult.opponentOffenseRefresh.cached_team_count, 1);
assert.equal(incompleteLiveOffenseResult.opponentOffenseRefresh.live_team_count, 0);
assert.equal(incompleteLiveOffenseResult.opponentOffenseRefresh.live_snapshot_team_count, 1);
assert.equal(incompleteLiveOffenseResult.opponentOffenseRefresh.missing_team_count, 1);
assert.equal(incompleteLiveOffenseResult.opponentOffenseRefresh.source, "home-worker cache");
assert.match(incompleteLiveOffenseResult.opponentOffenseRefresh.message, /snapshot covered only 1\/2 required teams/);

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

console.log("Lineup partial reference-cache tests passed.");
}

run().catch((error) => {
  throw error;
});
