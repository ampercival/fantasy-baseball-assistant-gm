import type { Row } from "../_shared/fangraphs.ts";
import type { LineupReferencePersistencePatch } from "./reference-data.ts";

export type ReferenceCachePersistenceStatus =
  | "persisted"
  | "not-needed"
  | "skipped-stale"
  | "race-lost"
  | "failed";

export type ReferenceCachePersistenceMetadata = {
  status: ReferenceCachePersistenceStatus;
  attempted: boolean;
  pitcher_row_count: number;
  offense_team_count: number;
  message: string;
};

export type ReferenceCachePatchWrite = {
  season: number;
  expectedFetchedAt: string;
  maxAgeHours: number;
  pitcherStats: Record<string, Row>;
  offenseRanksSnapshot: Record<string, Row> | null;
};

export type ReferenceCachePatchWriter = (patch: ReferenceCachePatchWrite) => Promise<boolean>;

type PersistReferencePatchOptions = {
  season: number;
  referenceCache: Row;
  patch: LineupReferencePersistencePatch;
  writer: ReferenceCachePatchWriter;
  now?: Date;
};

export async function persistLineupReferencePatch(
  options: PersistReferencePatchOptions,
): Promise<ReferenceCachePersistenceMetadata> {
  const pitcherRowCount = Object.keys(options.patch.pitcherStats).length;
  const offenseTeamCount = options.patch.offenseRanksSnapshot == null
    ? 0
    : Object.keys(options.patch.offenseRanksSnapshot).length;

  if (pitcherRowCount === 0 && offenseTeamCount === 0) {
    return {
      status: "not-needed",
      attempted: false,
      pitcher_row_count: 0,
      offense_team_count: 0,
      message: "No successful live reference-data gap fills needed persistence.",
    };
  }

  const fetchedAt = options.referenceCache.fetched_at;
  const expectedFetchedAt = fetchedAt instanceof Date
    ? fetchedAt.toISOString()
    : typeof fetchedAt === "string"
    ? fetchedAt
    : "";
  const maxAgeHours = Number(options.referenceCache.max_age_hours);
  const fetchedAtMs = Date.parse(expectedFetchedAt);
  const writeCheckMs = (options.now ?? new Date()).getTime();
  const ageHours = (writeCheckMs - fetchedAtMs) / 3_600_000;
  const isFreshAtWrite = Number.isFinite(ageHours) &&
    Number.isFinite(maxAgeHours) &&
    maxAgeHours > 0 &&
    ageHours >= 0 &&
    ageHours <= maxAgeHours;
  if (
    options.referenceCache.status !== "fresh" ||
    options.referenceCache.is_fresh !== true ||
    !expectedFetchedAt ||
    !isFreshAtWrite
  ) {
    return {
      status: "skipped-stale",
      attempted: false,
      pitcher_row_count: 0,
      offense_team_count: 0,
      message: "Live reference data was not persisted because the original home-worker cache row was not fresh.",
    };
  }

  try {
    const persisted = await options.writer({
      season: options.season,
      expectedFetchedAt,
      maxAgeHours,
      pitcherStats: options.patch.pitcherStats,
      offenseRanksSnapshot: options.patch.offenseRanksSnapshot,
    });
    if (!persisted) {
      return {
        status: "race-lost",
        attempted: true,
        pitcher_row_count: 0,
        offense_team_count: 0,
        message: "The reference cache changed, became stale, or disappeared before the live gap-fill patch could be saved.",
      };
    }
    return {
      status: "persisted",
      attempted: true,
      pitcher_row_count: pitcherRowCount,
      offense_team_count: offenseTeamCount,
      message: `Persisted ${pitcherRowCount} pitcher row${pitcherRowCount === 1 ? "" : "s"}`
        + ` and ${offenseTeamCount} offense team row${offenseTeamCount === 1 ? "" : "s"} without changing cache freshness.`,
    };
  } catch (error) {
    return {
      status: "failed",
      attempted: true,
      pitcher_row_count: 0,
      offense_team_count: 0,
      message: `Reference-cache persistence failed without blocking recommendations: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
