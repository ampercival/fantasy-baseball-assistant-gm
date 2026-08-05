// Supabase Edge Function: GET probable-start date options.
// Ports /api/lineup/dates. Query params: start_date (optional, YYYY-MM-DD), days (default 10).
import { CORS } from "../_shared/cors.ts";
import { fetchProbablesGridGames, ScrapeError } from "../_shared/fangraphs.ts";
import { buildProbableDateOptions, parseIsoDate } from "../_shared/lineup.ts";
import { fetchMlbProbableDateOptions } from "../_shared/mlb.ts";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
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
      let dates;
      let fangraphsError: unknown = null;
      try {
        const games = await fetchProbablesGridGames();
        dates = buildProbableDateOptions(games, start, end);
      } catch (err) {
        fangraphsError = err;
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
      return Response.json({ dates }, { headers: CORS });
    } catch (err) {
      const status = err instanceof ScrapeError ? 422 : 502;
      return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status, headers: CORS });
    }
  })();
});
