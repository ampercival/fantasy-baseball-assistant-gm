// Supabase Edge Function: persist the app owner's selected team for one league.
//
// POST { league_uid, team_uid } where an empty team_uid clears the selection.
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405, headers: CORS });
    }

    const body = await req.json().catch(() => ({}));
    const leagueUid = String(body.league_uid ?? "").trim();
    const teamUid = String(body.team_uid ?? "").trim();
    if (!leagueUid) {
      return Response.json({ error: "league_uid is required." }, { status: 400, headers: CORS });
    }

    const [league] = await sql`SELECT league_uid FROM fantasy_leagues WHERE league_uid = ${leagueUid}`;
    if (!league) {
      return Response.json({ error: "Unknown league." }, { status: 404, headers: CORS });
    }
    if (teamUid) {
      const [membership] = await sql`
        SELECT 1 FROM league_team_memberships
        WHERE league_uid = ${leagueUid} AND team_uid = ${teamUid}
      `;
      if (!membership) {
        return Response.json({ error: "Unknown team for this league." }, { status: 422, headers: CORS });
      }
    }

    const [updated] = await sql`
      UPDATE fantasy_leagues
      SET my_team_uid = ${teamUid || null}
      WHERE league_uid = ${leagueUid}
      RETURNING league_uid, my_team_uid
    `;
    return Response.json(
      { status: "success", league_uid: updated.league_uid, team_uid: updated.my_team_uid },
      { headers: CORS },
    );
  } catch (err) {
    return Response.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500, headers: CORS },
    );
  }
});
