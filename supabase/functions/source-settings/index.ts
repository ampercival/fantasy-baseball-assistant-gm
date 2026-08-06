// Supabase Edge Function: change a ranking source's tag or its included-in-aggregate flag.
//
// These are pure database writes with no scraping, so the static GitHub Pages build can
// call them from anywhere — the operator's home machine does not need to be running.
//
// POST { source_id, source_tag? , included? } — send either field, or both.
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

// Mirrors SOURCE_TAGS in backend/app/sources.py.
const SOURCE_TAGS = ["Continuous", "Updated", "Old/Pre-season"];

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message, message }, { status, headers: CORS });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError("Method not allowed.", 405);

  try {
    const body = await req.json().catch(() => ({}));
    const sourceId = String(body.source_id ?? "").trim();
    if (!sourceId) return jsonError("source_id is required.", 400);

    const hasTag = body.source_tag !== undefined && body.source_tag !== null;
    const hasIncluded = body.included !== undefined && body.included !== null;
    if (!hasTag && !hasIncluded) return jsonError("Send source_tag, included, or both.", 400);

    const sourceTag = hasTag ? String(body.source_tag).trim() : null;
    if (hasTag && !SOURCE_TAGS.includes(sourceTag!)) {
      return jsonError(`source_tag must be one of: ${SOURCE_TAGS.join(", ")}.`, 422);
    }
    // `included` is an integer column (0/1), not a boolean.
    const included = hasIncluded ? (body.included ? 1 : 0) : null;

    const [updated] = await sql`
      UPDATE sources
      SET
        source_tag = ${hasTag ? sourceTag : sql`source_tag`},
        included = ${hasIncluded ? included : sql`included`}
      WHERE id = ${sourceId}
      RETURNING id, source_tag, included
    `;
    if (!updated) return jsonError("Unknown source.", 404);

    return Response.json({
      included: Boolean(updated.included),
      source_id: updated.id,
      source_tag: updated.source_tag,
      status: "success",
    }, { headers: CORS });
  } catch (error) {
    return jsonError(String(error instanceof Error ? error.message : error), 500);
  }
});
