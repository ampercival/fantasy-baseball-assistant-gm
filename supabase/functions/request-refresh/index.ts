// Supabase Edge Function: enqueue a data-refresh request for the local worker to pick up.
// Query param: scope = all | continuous | leagues (default all).
// Debounced: if a request is already pending/running, or one finished very recently, it
// returns that instead of creating a duplicate.
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
const VALID_SCOPES = new Set(["all", "continuous", "leagues"]);
const RATE_LIMIT_MS = 90_000;

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return (async () => {
    try {
      const scopeParam = (new URL(req.url).searchParams.get("scope") ?? "all").toLowerCase();
      const scope = VALID_SCOPES.has(scopeParam) ? scopeParam : "all";

      const [active] = await sql`
        SELECT * FROM refresh_requests WHERE status IN ('pending', 'running') ORDER BY id DESC LIMIT 1
      `;
      if (active) return Response.json({ status: "already_queued", request: active }, { headers: CORS });

      const [recent] = await sql`SELECT * FROM refresh_requests ORDER BY id DESC LIMIT 1`;
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
