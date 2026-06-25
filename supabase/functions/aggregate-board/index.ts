// Supabase Edge Function: GET aggregate dynasty board.
// Thin wrapper around the shared board loader (../_shared/board.ts + aggregate.ts, which is
// unit-tested against the Python oracle). Reads are public (RLS allows anon select).
//
// Query params (same as the old FastAPI /api/rankings):
//   tdg_format=obp|points  fantrax_format=roto|points
//   included_source_tags=Continuous,Updated   included_sources_only=true|false
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { loadBoard, formatExclusions } from "../_shared/board.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const tdg = (url.searchParams.get("tdg_format") ?? "obp").toLowerCase();
    const fantrax = (url.searchParams.get("fantrax_format") ?? "roto").toLowerCase();
    const includedOnly = (url.searchParams.get("included_sources_only") ?? "true") !== "false";
    const tagsParam = (url.searchParams.get("included_source_tags") ?? "").trim();
    const includedTags = tagsParam ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean) : null;

    const board = await loadBoard(sql, {
      excludeSourceIds: formatExclusions(tdg, fantrax),
      includedOnly,
      includedTags,
    });
    return Response.json(board, { headers: CORS });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: CORS });
  }
});
