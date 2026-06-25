// Supabase Edge Function: GET aggregate dynasty board.
// Thin I/O wrapper around ./logic.ts (which is unit-tested against the Python oracle).
// It selects the latest successful snapshot per source, fetches the sources + ranking entries,
// then runs buildAggregateBoard. Reads are public (RLS allows anon select; this uses a DB role).
//
// Accepts the same query params the old FastAPI /api/rankings endpoint did:
//   tdg_format=obp|points  fantrax_format=roto|points
//   included_source_tags=Continuous,Updated   included_sources_only=true|false
//
// Requires SUPABASE_DB_URL (auto-provided in the Edge runtime; session/transaction pooler URL).
// NOTE: validated at deploy time — needs the Deno runtime + Supabase CLI to run.
import postgres from "npm:postgres@3.4.4";
import { buildAggregateBoard } from "./logic.ts";

const TDG_OBP = "tdg_2026_obp_top_500";
const TDG_POINTS = "tdg_2026_points_top_500";
const FANTRAX_ROTO = "fantrax_2026_top_500";
const FANTRAX_POINTS = "fantrax_2026_top_500_points";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

function formatExclusions(tdg: string, fantrax: string): string[] {
  const ex: string[] = [];
  ex.push(tdg === "points" || tdg === "pts" ? TDG_OBP : TDG_POINTS);
  ex.push(fantrax === "points" || fantrax === "pts" ? FANTRAX_ROTO : FANTRAX_POINTS);
  return ex;
}

async function latestSnapshotIds(excludeSourceIds: string[], includedOnly: boolean): Promise<number[]> {
  const rows = await sql<{ snapshot_id: number }[]>`
    SELECT MAX(snapshots.id) AS snapshot_id
    FROM snapshots
    JOIN sources ON sources.id = snapshots.source_id
    WHERE snapshots.status = 'success'
      AND snapshots.row_count > 0
      ${includedOnly ? sql`AND sources.included = 1` : sql``}
      ${excludeSourceIds.length ? sql`AND snapshots.source_id <> ALL(${excludeSourceIds})` : sql``}
    GROUP BY snapshots.source_id
  `;
  return rows.map((r) => Number(r.snapshot_id)).filter((id) => id != null);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const tdg = (url.searchParams.get("tdg_format") ?? "obp").toLowerCase();
    const fantrax = (url.searchParams.get("fantrax_format") ?? "roto").toLowerCase();
    const includedOnly = (url.searchParams.get("included_sources_only") ?? "true") !== "false";
    const tagsParam = (url.searchParams.get("included_source_tags") ?? "").trim();
    const includedTags = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : null;

    const excludeSourceIds = formatExclusions(tdg, fantrax);
    const snapshotIds = await latestSnapshotIds(excludeSourceIds, includedOnly);

    if (snapshotIds.length === 0) {
      const empty = buildAggregateBoard([], [], { includedTags });
      return Response.json(empty, { headers: CORS });
    }

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

    const board = buildAggregateBoard([...sources], [...entries], { includedTags });
    return Response.json(board, { headers: CORS });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: CORS });
  }
});
