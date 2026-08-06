// Supabase Edge Function: save or remove a per-source player name correction.
//
// Pure database writes, so the static GitHub Pages build can call them from anywhere.
//
// POST { source_id, original_name, corrected_name }  — upsert a correction
// POST { action: "delete", correction_id }           — remove one
//
// Delete rides on POST rather than the DELETE verb so the shared CORS allow-list
// (GET, POST, OPTIONS) covers it without a preflight failure.
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { normalizePlayerKey } from "../_shared/player-key.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message, message }, { status, headers: CORS });
}

async function deleteCorrection(correctionId: number): Promise<Response> {
  if (!Number.isInteger(correctionId) || correctionId <= 0) {
    return jsonError("A positive correction_id is required.", 400);
  }
  const [deleted] = await sql`
    DELETE FROM player_name_corrections WHERE id = ${correctionId} RETURNING id
  `;
  if (!deleted) return jsonError("Unknown player name correction.", 404);
  return Response.json({ correction_id: Number(deleted.id), status: "success" }, { headers: CORS });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError("Method not allowed.", 405);

  try {
    const body = await req.json().catch(() => ({}));
    if (String(body.action ?? "") === "delete") {
      return await deleteCorrection(Number(body.correction_id));
    }

    const sourceId = String(body.source_id ?? "").trim();
    const originalName = String(body.original_name ?? "").trim();
    const correctedName = String(body.corrected_name ?? "").trim();
    if (!sourceId) return jsonError("source_id is required.", 400);
    if (!originalName || !correctedName) {
      return jsonError("Both original_name and corrected_name are required.", 422);
    }

    const [source] = await sql`SELECT id FROM sources WHERE id = ${sourceId} LIMIT 1`;
    if (!source) return jsonError("Unknown source.", 404);

    const now = new Date().toISOString();
    const [correction] = await sql`
      INSERT INTO player_name_corrections (
        source_id, original_name, original_player_key, corrected_name, corrected_player_key,
        created_at, updated_at
      )
      VALUES (
        ${sourceId}, ${originalName}, ${normalizePlayerKey(originalName)},
        ${correctedName}, ${normalizePlayerKey(correctedName)}, ${now}, ${now}
      )
      ON CONFLICT (source_id, original_player_key) DO UPDATE SET
        original_name = EXCLUDED.original_name,
        corrected_name = EXCLUDED.corrected_name,
        corrected_player_key = EXCLUDED.corrected_player_key,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `;
    return Response.json({ correction, status: "success" }, { headers: CORS });
  } catch (error) {
    return jsonError(String(error instanceof Error ? error.message : error), 500);
  }
});
