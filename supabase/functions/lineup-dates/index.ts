// Supabase Edge Function: GET probable-start date options.
// Prefers FanGraphs data cached by the home worker, then live FanGraphs, then MLB.
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { fetchProbablesGridGames, ScrapeError } from "../_shared/fangraphs.ts";
import type { Row } from "../_shared/fangraphs.ts";
import { buildProbableDateOptions, parseIsoDate } from "../_shared/lineup.ts";
import { fetchMlbProbableDateOptions } from "../_shared/mlb.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function jsonValue<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return (async () => {
    try {
      const url = new URL(req.url);
      const startParam = (url.searchParams.get("start_date") ?? "").trim();
      let days = Number(url.searchParams.get("days") ?? "10");
      if (!Number.isFinite(days)) days = 10;
      days = Math.max(1, Math.min(days, 31));

      const start = startParam ? parseIsoDate(startParam) : todayIso();
      const end = addDaysIso(start, days - 1);
      let dates: Row[] | undefined;
      let cacheGeneratedAt: string | null = null;
      try {
        const [cache] = await sql`
          SELECT games, generated_at
          FROM lineup_data_cache
          WHERE cache_key = 'current'
        `;
        if (cache) {
          const games = jsonValue<Row[]>(cache.games);
          dates = buildProbableDateOptions(games, start, end).map((option) => ({
            ...option,
            source: "FanGraphs via home worker",
          }));
          if (dates.length) cacheGeneratedAt = cache.generated_at;
        }
      } catch {
        // A missing or malformed cache must not block the live/MLB fallbacks.
      }

      let fangraphsError: unknown = null;
      if (!dates?.length) {
        try {
          const games = await fetchProbablesGridGames();
          dates = buildProbableDateOptions(games, start, end);
        } catch (err) {
          fangraphsError = err;
        }
      }
      if (!dates?.length) {
        try {
          dates = await fetchMlbProbableDateOptions(start, end);
        } catch (mlbError) {
          const fgMessage = fangraphsError instanceof Error ? fangraphsError.message : String(fangraphsError ?? "no dates returned");
          const mlbMessage = mlbError instanceof Error ? mlbError.message : String(mlbError);
          throw new ScrapeError(`Probable-date sources failed. FanGraphs: ${fgMessage} MLB: ${mlbMessage}`);
        }
      }
      return Response.json({ dates, cache_generated_at: cacheGeneratedAt }, { headers: CORS });
    } catch (err) {
      const status = err instanceof ScrapeError ? 422 : 502;
      return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status, headers: CORS });
    }
  })();
});
