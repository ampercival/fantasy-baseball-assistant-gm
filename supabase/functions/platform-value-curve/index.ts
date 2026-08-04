// Supabase Edge Function: read the latest platform salary curve and persist its
// random sample-size setting. Scraping is performed by the existing home worker.
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function curveResponse(row: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!row) return null;
  return {
    parameters: parseJson(row.parameters),
    points: parseJson(row.points),
    sampled_leagues: parseJson(row.sampled_leagues),
    failed_leagues: parseJson(row.failed_leagues),
    sample_size: Number(row.sample_size),
    successful_league_count: Number(row.successful_league_count),
    attempted_league_count: Number(row.attempted_league_count),
    rank_count: Number(row.rank_count),
    observation_count: Number(row.observation_count),
    rmse: Number(row.rmse),
    model_version: Number(row.model_version),
    generated_at: row.generated_at,
  };
}

async function responsePayload() {
  const [setting] = await sql`
    SELECT platform, sample_size, updated_at
    FROM platform_value_curve_settings
    WHERE platform = 'ottoneu'
  `;
  const [curve] = await sql`
    SELECT * FROM platform_value_curves WHERE platform = 'ottoneu'
  `;
  return {
    setting: setting
      ? { platform: setting.platform, sample_size: Number(setting.sample_size), updated_at: setting.updated_at }
      : { platform: "ottoneu", sample_size: 20, updated_at: null },
    curve: curveResponse(curve),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const sampleSize = Number(body?.sample_size);
      if (!Number.isInteger(sampleSize) || sampleSize < 1 || sampleSize > 500) {
        return Response.json({ error: "sample_size must be an integer between 1 and 500" }, { status: 422, headers: CORS });
      }
      const timestamp = new Date().toISOString();
      await sql`
        INSERT INTO platform_value_curve_settings (platform, sample_size, created_at, updated_at)
        VALUES ('ottoneu', ${sampleSize}, ${timestamp}, ${timestamp})
        ON CONFLICT (platform)
        DO UPDATE SET sample_size = EXCLUDED.sample_size, updated_at = EXCLUDED.updated_at
      `;
    } else if (req.method !== "GET") {
      return Response.json({ error: "Method not allowed" }, { status: 405, headers: CORS });
    }
    return Response.json(await responsePayload(), { headers: CORS });
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: CORS });
  }
});
