// Shared board loader: runs the snapshot-selection + sources/entries queries and feeds them to
// the pure buildAggregateBoard logic. Used by the aggregate-board and team-detail functions.
import postgres from "npm:postgres@3.4.4";
import { buildAggregateBoard } from "./aggregate.ts";

const TDG_OBP = "tdg_2026_obp_top_500";
const TDG_POINTS = "tdg_2026_points_top_500";
const FANTRAX_ROTO = "fantrax_2026_top_500";
const FANTRAX_POINTS = "fantrax_2026_top_500_points";

/** Mirrors main.py format_exclusions: pick which TDG/Fantrax format variant to drop. */
export function formatExclusions(tdg: string, fantrax: string): string[] {
  return [
    tdg === "points" || tdg === "pts" ? TDG_OBP : TDG_POINTS,
    fantrax === "points" || fantrax === "pts" ? FANTRAX_ROTO : FANTRAX_POINTS,
  ];
}

type Sql = ReturnType<typeof postgres>;

export interface BoardOptions {
  excludeSourceIds?: string[];
  includedOnly?: boolean;
  includedTags?: string[] | null;
}

export async function loadBoard(sql: Sql, opts: BoardOptions = {}) {
  const excludeSourceIds = opts.excludeSourceIds ?? [];
  const includedOnly = opts.includedOnly ?? true;
  const includedTags = opts.includedTags ?? null;

  const idRows = await sql<{ snapshot_id: number }[]>`
    SELECT MAX(snapshots.id) AS snapshot_id
    FROM snapshots
    JOIN sources ON sources.id = snapshots.source_id
    WHERE snapshots.status = 'success'
      AND snapshots.row_count > 0
      ${includedOnly ? sql`AND sources.included = 1` : sql``}
      ${excludeSourceIds.length ? sql`AND snapshots.source_id <> ALL(${excludeSourceIds})` : sql``}
    GROUP BY snapshots.source_id
  `;
  const snapshotIds = idRows.map((r) => Number(r.snapshot_id)).filter((id) => id != null);
  if (snapshotIds.length === 0) return buildAggregateBoard([], [], { includedTags });

  const sources = await sql`
    SELECT s.*, snap.id AS snapshot_id, snap.fetched_at, snap.row_count,
           snap.source_date, snap.source_date_kind
    FROM snapshots snap
    JOIN sources s ON s.id = snap.source_id
    WHERE snap.id = ANY(${snapshotIds})
    ORDER BY s.name, s.ranking_type
  `;
  const entries = await sql`
    SELECT e.*, s.short_name, s.source_tag,
           c.id AS correction_id, c.corrected_name, c.corrected_player_key
    FROM ranking_entries e
    JOIN sources s ON s.id = e.source_id
    LEFT JOIN player_name_corrections c
      ON c.source_id = e.source_id AND c.original_player_key = e.player_key
    WHERE e.snapshot_id = ANY(${snapshotIds})
    ORDER BY e.rank
  `;
  return buildAggregateBoard([...sources], [...entries], { includedTags });
}
