import type { Row } from "../_shared/fangraphs.ts";

type PitcherXfipFetcher = (
  playerId: string | number,
  season: number,
  refererUrl: string,
) => Promise<Row | number | null>;

type TeamOffenseFetcher = (season: number) => Promise<Record<string, Row>>;

type ReferenceDataOptions = {
  season: number;
  probablePitchers: Iterable<Row>;
  opponentTeamCodes: Iterable<string>;
  cachedStats: Record<string, Row> | null;
  cachedOffenseRanks: Record<string, Row> | null;
  referenceCacheFetchedAt: string | null;
  now?: Date;
  fetchPitcherXfipMinus: PitcherXfipFetcher;
  fetchTeamOffenseRanks: TeamOffenseFetcher;
};

export type LineupReferencePersistencePatch = {
  pitcherStats: Record<string, Row>;
  offenseRanksSnapshot: Record<string, Row> | null;
};

export type LineupReferenceData = {
  statsByKey: Record<string, Row>;
  offenseRanks: Record<string, Row>;
  xfipRefresh: Row;
  opponentOffenseRefresh: Row;
  referenceCache: Row;
  persistencePatch: LineupReferencePersistencePatch;
  source: string;
};

export const REFERENCE_CACHE_MAX_AGE_HOURS = 20;
export const MLB_TEAM_OFFENSE_SNAPSHOT_TEAM_COUNT = 30;

function usableXfipRow(row: Row | null | undefined): boolean {
  return row?.xfip_minus != null && Number.isFinite(Number(row.xfip_minus));
}

function cacheSuffix(fetchedAt: string | null): string {
  return fetchedAt ? ` (${fetchedAt})` : "";
}

function referenceCacheFreshness(fetchedAt: string | null, now: Date): Row {
  if (!fetchedAt) {
    return {
      status: "missing",
      is_fresh: false,
      fetched_at: null,
      age_hours: null,
      max_age_hours: REFERENCE_CACHE_MAX_AGE_HOURS,
    };
  }
  const fetchedAtMs = Date.parse(fetchedAt);
  const ageMs = now.getTime() - fetchedAtMs;
  const ageHours = Number.isFinite(ageMs) ? ageMs / 3_600_000 : null;
  const isFresh = ageHours != null && ageHours >= 0 && ageHours <= REFERENCE_CACHE_MAX_AGE_HOURS;
  return {
    status: isFresh ? "fresh" : "stale",
    is_fresh: isFresh,
    fetched_at: fetchedAt,
    age_hours: ageHours == null ? null : Math.round(ageHours * 100) / 100,
    max_age_hours: REFERENCE_CACHE_MAX_AGE_HOURS,
  };
}

function referenceSource(cachedCount: number, liveCount: number, liveLabel: string): string {
  if (cachedCount > 0 && liveCount > 0) return `home-worker cache + ${liveLabel} gap fill`;
  if (cachedCount > 0) return "home-worker cache";
  if (liveCount > 0) return liveLabel;
  return "none";
}

function enrichedReferenceRow(row: Row, provenance: "home-worker-cache" | "live-fangraphs"): Row {
  return {
    ...row,
    reference_provenance: provenance,
    reference_confidence: "high",
  };
}

function enrichedReferenceRows(
  rows: Record<string, Row>,
  provenance: "home-worker-cache" | "live-fangraphs",
): Record<string, Row> {
  return Object.fromEntries(
    Object.entries(rows).map(([key, row]) => [key, enrichedReferenceRow(row, provenance)]),
  );
}

export async function resolveLineupReferenceData(
  options: ReferenceDataOptions,
): Promise<LineupReferenceData> {
  const referenceCache = referenceCacheFreshness(options.referenceCacheFetchedAt, options.now ?? new Date());
  const authoritativeCachedStats = referenceCache.is_fresh ? options.cachedStats : null;
  const authoritativeCachedOffenseRanks = referenceCache.is_fresh ? options.cachedOffenseRanks : null;
  const pitchersByKey = new Map<string, Row>();
  for (const pitcher of options.probablePitchers) {
    const pitcherKey = String(pitcher?.pitcher_key ?? "").trim();
    if (pitcherKey) pitchersByKey.set(pitcherKey, pitcher);
  }
  const requiredTeams = [...new Set(
    [...options.opponentTeamCodes]
      .map((teamCode) => String(teamCode ?? "").trim().toUpperCase())
      .filter(Boolean),
  )].sort();

  const statsByKey: Record<string, Row> = {};
  const livePitcherStatsPatch: Record<string, Row> = {};
  let cachedPitcherCount = 0;
  for (const pitcherKey of pitchersByKey.keys()) {
    const cached = authoritativeCachedStats?.[pitcherKey];
    if (!usableXfipRow(cached)) continue;
    statsByKey[pitcherKey] = enrichedReferenceRow(cached!, "home-worker-cache");
    cachedPitcherCount++;
  }
  const missingPitchers = [...pitchersByKey.entries()]
    .filter(([pitcherKey]) => !statsByKey[pitcherKey])
    .map(([, pitcher]) => pitcher);
  const fetchablePitchers = missingPitchers.filter(
    (pitcher) => pitcher.fangraphs_id && pitcher.fangraphs_url,
  );

  let offenseRanks = enrichedReferenceRows(
    authoritativeCachedOffenseRanks ?? {},
    "home-worker-cache",
  );
  const cachedRequiredTeams = requiredTeams.filter((teamCode) => offenseRanks[teamCode] != null);
  const missingTeams = requiredTeams.filter((teamCode) => offenseRanks[teamCode] == null);
  const offensePromise = missingTeams.length
    ? options.fetchTeamOffenseRanks(options.season)
      .then((rankings) => ({ rankings, error: null as string | null }))
      .catch((error) => ({
        rankings: {} as Record<string, Row>,
        error: String(error instanceof Error ? error.message : error),
      }))
    : Promise.resolve({ rankings: {} as Record<string, Row>, error: null as string | null });

  let livePitcherCount = 0;
  let pitcherErrorCount = 0;
  await Promise.all(
    fetchablePitchers.map(async (pitcher) => {
      try {
        const fetchedReference = await options.fetchPitcherXfipMinus(
          pitcher.fangraphs_id,
          options.season,
          pitcher.fangraphs_url,
        );
        const reference = typeof fetchedReference === "number"
          ? { xfip_minus: fetchedReference }
          : fetchedReference;
        if (reference?.xfip_minus == null || !Number.isFinite(Number(reference.xfip_minus))) return;
        const liveRow = enrichedReferenceRow({
          pitcher_key: pitcher.pitcher_key,
          pitcher_name: pitcher.pitcher_name ?? null,
          fangraphs_id: pitcher.fangraphs_id,
          season: options.season,
          xfip_minus: Number(reference.xfip_minus),
          innings_pitched: reference.innings_pitched ?? null,
          batters_faced: reference.batters_faced ?? null,
          source: "FanGraphs player page",
        }, "live-fangraphs");
        statsByKey[pitcher.pitcher_key] = liveRow;
        livePitcherStatsPatch[pitcher.pitcher_key] = liveRow;
        livePitcherCount++;
      } catch {
        pitcherErrorCount++;
      }
    }),
  );

  const offenseResult = await offensePromise;
  let liveOffenseTeamCount = 0;
  let cachedOffenseTeamCount = cachedRequiredTeams.length;
  const liveOffenseSnapshotCount = Object.keys(offenseResult.rankings).length;
  const liveOffenseRequiredTeamCount = requiredTeams.filter(
    (teamCode) => offenseResult.rankings[teamCode] != null,
  ).length;
  const liveOffenseCoversEveryRequiredTeam = liveOffenseRequiredTeamCount === requiredTeams.length;
  const liveOffenseSnapshotComplete = liveOffenseSnapshotCount === MLB_TEAM_OFFENSE_SNAPSHOT_TEAM_COUNT;
  let liveOffenseRanksSnapshot: Record<string, Row> | null = null;
  if (missingTeams.length > 0 && liveOffenseSnapshotComplete && liveOffenseCoversEveryRequiredTeam) {
    // Team ranks are relative to the league-wide snapshot. If the cache is incomplete,
    // use the complete live snapshot rather than mixing ranks calculated at different times.
    liveOffenseRanksSnapshot = enrichedReferenceRows(offenseResult.rankings, "live-fangraphs");
    offenseRanks = liveOffenseRanksSnapshot;
    cachedOffenseTeamCount = 0;
    liveOffenseTeamCount = requiredTeams.filter((teamCode) => offenseRanks[teamCode] != null).length;
  }

  const unresolvedPitcherCount = [...pitchersByKey.keys()].filter((pitcherKey) => !statsByKey[pitcherKey]).length;
  const unresolvedTeamCount = requiredTeams.filter((teamCode) => offenseRanks[teamCode] == null).length;
  const cacheTime = cacheSuffix(options.referenceCacheFetchedAt);
  const staleCachePrefix = referenceCache.status === "stale"
    ? `Ignored stale home-worker reference data${cacheTime}; the maximum age is ${REFERENCE_CACHE_MAX_AGE_HOURS} hours. `
    : "";
  const xfipSource = referenceSource(cachedPitcherCount, livePitcherCount, "FanGraphs player pages");
  const offenseSource = requiredTeams.length === 0
    ? "not required"
    : referenceSource(cachedOffenseTeamCount, liveOffenseTeamCount, "FanGraphs team offense leaderboard");

  let xfipMessage: string;
  if (pitchersByKey.size === 0) {
    xfipMessage = "No probable-starter xFIP- rows were required.";
  } else if (cachedPitcherCount > 0 && fetchablePitchers.length > 0) {
    xfipMessage =
      `Loaded ${cachedPitcherCount}/${pitchersByKey.size} probable-starter xFIP- rows from the home-worker cache${cacheTime}; `
      + `filled ${livePitcherCount}/${fetchablePitchers.length} missing fetchable rows from FanGraphs.`;
  } else if (cachedPitcherCount > 0) {
    xfipMessage =
      `Loaded ${cachedPitcherCount}/${pitchersByKey.size} probable-starter xFIP- rows from the home-worker cache${cacheTime}.`;
  } else {
    xfipMessage =
      `Refreshed ${livePitcherCount}/${fetchablePitchers.length} missing fetchable probable-starter xFIP- rows from FanGraphs.`;
  }
  if (unresolvedPitcherCount > 0) {
    xfipMessage += ` ${unresolvedPitcherCount} probable starter${unresolvedPitcherCount === 1 ? " remains" : "s remain"} without xFIP-.`;
  }
  xfipMessage = staleCachePrefix + xfipMessage;

  let offenseMessage: string;
  if (requiredTeams.length === 0) {
    offenseMessage = "No opponent offense rankings were required.";
  } else if (liveOffenseSnapshotComplete && liveOffenseCoversEveryRequiredTeam) {
    offenseMessage =
      `The home-worker cache covered ${cachedRequiredTeams.length}/${requiredTeams.length} required MLB offense rankings${cacheTime}; `
      + `refreshed a ${liveOffenseSnapshotCount}-team FanGraphs snapshot because ${missingTeams.length} required `
      + `team${missingTeams.length === 1 ? " was" : "s were"} missing.`;
  } else if (cachedOffenseTeamCount > 0) {
    offenseMessage =
      `Loaded ${cachedOffenseTeamCount}/${requiredTeams.length} required MLB offense rankings from the home-worker cache${cacheTime}.`;
  } else {
    offenseMessage = "No required MLB offense rankings were resolved.";
  }
  if (liveOffenseSnapshotCount > 0 && !liveOffenseSnapshotComplete) {
    offenseMessage +=
      ` The live FanGraphs snapshot contained ${liveOffenseSnapshotCount}/${MLB_TEAM_OFFENSE_SNAPSHOT_TEAM_COUNT} MLB teams, so it was not used.`;
  } else if (liveOffenseSnapshotCount > 0 && !liveOffenseCoversEveryRequiredTeam) {
    offenseMessage +=
      ` The live FanGraphs snapshot covered only ${liveOffenseRequiredTeamCount}/${requiredTeams.length} required teams, so it was not used.`;
  }
  if (offenseResult.error) offenseMessage += ` FanGraphs refresh failed: ${offenseResult.error}.`;
  if (unresolvedTeamCount > 0) {
    offenseMessage += ` ${unresolvedTeamCount} required team${unresolvedTeamCount === 1 ? " remains" : "s remain"} without rankings.`;
  }
  offenseMessage = staleCachePrefix + offenseMessage;

  return {
    statsByKey,
    offenseRanks,
    xfipRefresh: {
      row_count: Object.keys(statsByKey).length,
      required_row_count: pitchersByKey.size,
      cached_row_count: cachedPitcherCount,
      live_row_count: livePitcherCount,
      missing_row_count: unresolvedPitcherCount,
      error_count: pitcherErrorCount,
      cache_status: referenceCache.status,
      source: xfipSource,
      message: xfipMessage,
    },
    opponentOffenseRefresh: {
      team_count: Object.keys(offenseRanks).length,
      required_team_count: requiredTeams.length,
      cache_hit_team_count: cachedRequiredTeams.length,
      cached_team_count: cachedOffenseTeamCount,
      live_team_count: liveOffenseTeamCount,
      live_snapshot_team_count: liveOffenseSnapshotCount,
      missing_team_count: unresolvedTeamCount,
      error: offenseResult.error,
      cache_status: referenceCache.status,
      source: offenseSource,
      message: offenseMessage,
    },
    referenceCache,
    persistencePatch: {
      pitcherStats: livePitcherStatsPatch,
      offenseRanksSnapshot: liveOffenseRanksSnapshot,
    },
    source: `pitcher xFIP- via ${xfipSource}; team offense via ${offenseSource}`,
  };
}
