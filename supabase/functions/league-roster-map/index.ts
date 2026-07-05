// Supabase Edge Function: GET league roster map.
// Ports the /api/leagues/{uid}/roster-map endpoint: league + roster map + trade block +
// available-player stats + fitted value curve. (Board rankings are matched client-side.)
//
// Query param: league_uid (required)
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { buildLeagueValueCurve } from "../_shared/value-curve.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const leagueUid = (url.searchParams.get("league_uid") ?? "").trim();
    if (!leagueUid) return Response.json({ error: "league_uid is required" }, { status: 400, headers: CORS });

    const [league] = await sql`SELECT * FROM fantasy_leagues WHERE league_uid = ${leagueUid}`;
    if (!league) return Response.json({ error: "Unknown league." }, { status: 404, headers: CORS });

    const players = await sql`
      SELECT r.player_key, r.player_name, r.salary, r.positions, r.status, r.mlb_team, r.section,
             r.games, r.innings_pitched, r.points_per_game, r.points_per_ip, r.points,
             m.league_uid, m.team_uid, m.team_name, m.standings_rank
      FROM league_team_memberships m
      JOIN (
        SELECT team_snapshots.*
        FROM team_snapshots
        INNER JOIN (
          SELECT team_uid, MAX(id) AS max_id FROM team_snapshots WHERE status = 'success' GROUP BY team_uid
        ) latest_ids ON latest_ids.max_id = team_snapshots.id
      ) latest_snapshots ON latest_snapshots.team_uid = m.team_uid
      JOIN team_roster_entries r ON r.snapshot_id = latest_snapshots.id
      WHERE m.league_uid = ${leagueUid}
      ORDER BY m.team_name, r.player_name
    `;

    const tradeBlock = await sql`
      SELECT tb.side, tb.player_key, tb.player_name,
             COALESCE(tb.salary, r.salary, 0) AS salary,
             COALESCE(tb.positions, r.positions) AS positions,
             r.status, r.mlb_team, COALESCE(r.section, 'hitter') AS section,
             r.games, r.innings_pitched, r.points_per_game, r.points_per_ip, r.points,
             m.league_uid, m.team_uid, m.team_name, m.standings_rank
      FROM league_team_memberships m
      JOIN (
        SELECT team_snapshots.*
        FROM team_snapshots
        INNER JOIN (
          SELECT team_uid, MAX(id) AS max_id FROM team_snapshots WHERE status = 'success' GROUP BY team_uid
        ) latest_ids ON latest_ids.max_id = team_snapshots.id
      ) latest_snapshots ON latest_snapshots.team_uid = m.team_uid
      JOIN team_trade_block tb ON tb.snapshot_id = latest_snapshots.id
      LEFT JOIN team_roster_entries r ON r.snapshot_id = latest_snapshots.id AND r.player_key = tb.player_key
      WHERE m.league_uid = ${leagueUid}
      ORDER BY tb.side, m.team_name, tb.player_name
    `;

    const availablePlayerStats = await sql`
      WITH league_teams AS (
        SELECT team_uid FROM league_team_memberships WHERE league_uid = ${leagueUid}
      ),
      latest_snapshots AS (
        SELECT team_snapshots.*
        FROM team_snapshots
        INNER JOIN (
          SELECT team_uid, MAX(id) AS max_id FROM team_snapshots WHERE status = 'success' GROUP BY team_uid
        ) latest_ids ON latest_ids.max_id = team_snapshots.id
        WHERE team_snapshots.team_uid IN (SELECT team_uid FROM league_teams)
      ),
      current_roster AS (
        SELECT DISTINCT r.player_key
        FROM latest_snapshots s
        JOIN team_roster_entries r ON r.snapshot_id = s.id
      ),
      historical_rows AS (
        SELECT r.*,
          ROW_NUMBER() OVER (
            PARTITION BY r.player_key
            ORDER BY s.fetched_at DESC, r.snapshot_id DESC, r.id DESC
          ) AS row_number
        FROM team_snapshots s
        JOIN team_roster_entries r ON r.snapshot_id = s.id
        WHERE s.status = 'success'
          AND s.team_uid IN (SELECT team_uid FROM league_teams)
          AND r.player_key NOT IN (SELECT player_key FROM current_roster)
      )
      SELECT player_key, player_name, positions, status, mlb_team, section,
             games, innings_pitched, points_per_game, points_per_ip, points
      FROM historical_rows
      WHERE row_number = 1
      ORDER BY player_name
    `;

    const valueCurve = buildLeagueValueCurve([...players]);

    return Response.json(
      {
        league,
        players: [...players],
        trade_block: [...tradeBlock],
        available_player_stats: [...availablePlayerStats],
        value_curve: valueCurve,
      },
      { headers: CORS },
    );
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: CORS });
  }
});
