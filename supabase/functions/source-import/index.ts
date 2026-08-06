// Supabase Edge Function: import a pasted ranking CSV from the static GitHub Pages app.
// POST { source_id, csv_text }
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { CsvImportError, parseCsvImport } from "../_shared/csv-import.ts";
import { normalizePlayerKey } from "../_shared/player-key.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
const MAX_CSV_CHARACTERS = 2_000_000;
const MAX_IMPORT_ROWS = 10_000;

function jsonError(message: string, status: number): Response {
  return Response.json({ error: message, message }, { status, headers: CORS });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return jsonError("Method not allowed.", 405);

  try {
    const body = await req.json().catch(() => ({}));
    const sourceId = String(body.source_id ?? "").trim();
    const csvText = String(body.csv_text ?? "");
    if (!sourceId || !csvText.trim()) return jsonError("source_id and csv_text are required.", 400);
    if (csvText.length > MAX_CSV_CHARACTERS) return jsonError("CSV import is too large.", 413);

    const [source] = await sql`SELECT id, url FROM sources WHERE id = ${sourceId} LIMIT 1`;
    if (!source) return jsonError("Unknown source.", 404);

    const entries = parseCsvImport(csvText);
    if (entries.length > MAX_IMPORT_ROWS) return jsonError(`CSV import exceeds ${MAX_IMPORT_ROWS} ranking rows.`, 413);

    const now = new Date().toISOString();
    const message = `Imported ${entries.length} rankings.`;
    const snapshotId = await sql.begin(async (transaction) => {
      const [snapshot] = await transaction`
        INSERT INTO snapshots (
          source_id, fetched_at, status, row_count, message, source_url, source_date, source_date_kind
        )
        VALUES (${sourceId}, ${now}, 'success', ${entries.length}, ${message}, ${source.url}, NULL, NULL)
        RETURNING id
      `;
      const rows = entries.map((entry) => ({
        age: entry.age,
        player_key: normalizePlayerKey(entry.player_name),
        player_name: entry.player_name,
        positions: entry.positions,
        rank: entry.rank,
        snapshot_id: snapshot.id,
        source_id: sourceId,
        team: entry.team,
      }));
      for (let index = 0; index < rows.length; index += 500) {
        const chunk = rows.slice(index, index + 500);
        await transaction`INSERT INTO ranking_entries ${transaction(chunk)}`;
      }
      return Number(snapshot.id);
    });

    return Response.json({
      message,
      row_count: entries.length,
      snapshot_id: snapshotId,
      source_date: null,
      source_date_kind: null,
      source_id: sourceId,
      status: "success",
    }, { headers: CORS });
  } catch (error) {
    if (error instanceof CsvImportError) return jsonError(error.message, 422);
    return jsonError(String(error instanceof Error ? error.message : error), 500);
  }
});
