// Supabase Edge Function: set a lineup always-start / always-sit preference for a player.
// Ports POST /api/lineup/always-start and /api/lineup/always-sit so the toggles work from the
// static GitHub Pages site (no local backend). Uses the service-role DB connection.
//
// POST body: { league_uid, team_uid, player_key, player_name, kind: "start" | "sit", value: bool }
// "start" and "sit" are mutually exclusive; setting one clears the other. value=false removes it.
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return (async () => {
    try {
      const body = await req.json().catch(() => ({}));
      const leagueUid = String(body.league_uid ?? "").trim();
      const teamUid = String(body.team_uid ?? "").trim();
      const playerKey = String(body.player_key ?? "").trim();
      const playerName = String(body.player_name ?? "").trim();
      const kind = String(body.kind ?? "");
      const value = Boolean(body.value);
      if (!leagueUid || !teamUid || !playerKey || (kind !== "start" && kind !== "sit")) {
        return Response.json(
          { error: "league_uid, team_uid, player_key, and kind (start|sit) are required." },
          { status: 400, headers: CORS },
        );
      }

      const now = new Date().toISOString();
      if (kind === "start") {
        if (value) {
          await sql`DELETE FROM lineup_always_sit_players WHERE league_uid=${leagueUid} AND team_uid=${teamUid} AND player_key=${playerKey}`;
          await sql`
            INSERT INTO lineup_always_start_players (league_uid, team_uid, player_key, player_name, created_at, updated_at)
            VALUES (${leagueUid}, ${teamUid}, ${playerKey}, ${playerName}, ${now}, ${now})
            ON CONFLICT (league_uid, team_uid, player_key)
            DO UPDATE SET player_name = EXCLUDED.player_name, updated_at = EXCLUDED.updated_at
          `;
        } else {
          await sql`DELETE FROM lineup_always_start_players WHERE league_uid=${leagueUid} AND team_uid=${teamUid} AND player_key=${playerKey}`;
        }
      } else {
        if (value) {
          await sql`DELETE FROM lineup_always_start_players WHERE league_uid=${leagueUid} AND team_uid=${teamUid} AND player_key=${playerKey}`;
          await sql`
            INSERT INTO lineup_always_sit_players (league_uid, team_uid, player_key, player_name, created_at, updated_at)
            VALUES (${leagueUid}, ${teamUid}, ${playerKey}, ${playerName}, ${now}, ${now})
            ON CONFLICT (league_uid, team_uid, player_key)
            DO UPDATE SET player_name = EXCLUDED.player_name, updated_at = EXCLUDED.updated_at
          `;
        } else {
          await sql`DELETE FROM lineup_always_sit_players WHERE league_uid=${leagueUid} AND team_uid=${teamUid} AND player_key=${playerKey}`;
        }
      }

      return Response.json({ status: "success", kind, value }, { headers: CORS });
    } catch (err) {
      return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status: 500, headers: CORS });
    }
  })();
});
