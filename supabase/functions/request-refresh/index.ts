// Supabase Edge Function: enqueue a data-refresh request for the local worker to pick up.
// Query param: scope = all | continuous | leagues | platform (default all).
// Debounced: if a request is already pending/running, or one finished very recently, it
// returns that instead of creating a duplicate.
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
const VALID_SCOPES = new Set(["all", "continuous", "leagues", "platform"]);
const RATE_LIMIT_MS = 90_000;
// If the worker is offline, requests never get picked up. Treat a request that has been
// waiting/running far longer than a real scrape takes as abandoned so the queue self-heals
// instead of blocking every future click with "already queued".
const STALE_PENDING_MS = 10 * 60_000;
const STALE_RUNNING_MS = 30 * 60_000;

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return (async () => {
    try {
      const scopeParam = (new URL(req.url).searchParams.get("scope") ?? "all").toLowerCase();
      const scope = VALID_SCOPES.has(scopeParam) ? scopeParam : "all";

      const [active] = await sql`
        SELECT * FROM refresh_requests
        WHERE status IN ('pending', 'running') AND (scope = ${scope} OR scope = 'all')
        ORDER BY id DESC LIMIT 1
      `;
      if (active) {
        const isRunning = active.status === "running";
        const ts = isRunning ? active.started_at : active.requested_at;
        const ageMs = ts ? Date.now() - Date.parse(ts) : Infinity;
        const cutoff = isRunning ? STALE_RUNNING_MS : STALE_PENDING_MS;
        if (Number.isFinite(ageMs) && ageMs < cutoff) {
          return Response.json({ status: "already_queued", request: active }, { headers: CORS });
        }
        // Stale: the worker likely isn't running. Mark it errored so it stops blocking new requests.
        await sql`
          UPDATE refresh_requests
          SET status = 'error', finished_at = ${new Date().toISOString()}, message = 'expired (no worker picked it up)'
          WHERE id = ${active.id} AND status = ${active.status}
        `;
      }

      // Only a genuinely completed refresh triggers the cooldown - expired/errored rows shouldn't.
      const [recent] = await sql`SELECT * FROM refresh_requests
        WHERE status = 'done' AND (scope = ${scope} OR scope = 'all')
        ORDER BY id DESC LIMIT 1`;
      if (recent?.finished_at) {
        const finishedMs = Date.parse(recent.finished_at);
        if (Number.isFinite(finishedMs) && Date.now() - finishedMs < RATE_LIMIT_MS) {
          return Response.json({ status: "rate_limited", request: recent }, { headers: CORS });
        }
      }

      const [row] = await sql`
        INSERT INTO refresh_requests (scope, status, requested_at)
        VALUES (${scope}, 'pending', ${new Date().toISOString()})
        RETURNING *
      `;
      return Response.json({ status: "queued", request: row }, { headers: CORS });
    } catch (err) {
      return Response.json({ error: String(err) }, { status: 500, headers: CORS });
    }
  })();
});
