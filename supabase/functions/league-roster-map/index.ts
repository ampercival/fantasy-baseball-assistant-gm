// Supabase Edge Function: GET league roster map.
// Ports the /api/leagues/{uid}/roster-map endpoint: league + roster map + trade block +
// available-player stats + fitted value curve. (Board rankings are matched client-side.)
//
// Query param: league_uid (required)
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { buildLeagueValueCurve } from "../_shared/value-curve.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
const VALUE_CURVE_MODEL_VERSION = 1;

function curveResponse(row: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!row) return null;
  const parameters = typeof row.parameters === "string" ? JSON.parse(row.parameters) : row.parameters;
  return {
    parameters,
    player_count: Number(row.player_count),
    rmse: Number(row.rmse),
    source_snapshot_max_id: Number(row.source_snapshot_max_id),
    model_version: Number(row.model_version),
    generated_at: row.generated_at,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const leagueUid = (url.searchParams.get("league_uid") ?? "").trim();
    if (!leagueUid) return Response.json({ error: "league_uid is required" }, { status: 400, headers: CORS });

    const [league] = await sql`SELECT * FROM fantasy_leagues WHERE league_uid = ${leagueUid}`;
    if (!league) return Response.json({ error: "Unknown league." }, { status: 404, headers: CORS });

    const players = await sql`
      SELECT r.ottoneu_player_id, r.player_key, r.player_name, r.salary, r.positions, r.status, r.mlb_team, r.section,
             r.games, r.games_started, r.innings_pitched, r.points_per_game, r.points_per_ip, r.points,
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

    // Players currently up for auction or on waivers, refreshed with the league scrape.
    const marketEntries = await sql`
      SELECT market, ottoneu_player_id, player_name, player_key, mlb_team, positions,
             handedness, status, amount, deadline_text, cut_by, fetched_at
      FROM league_market_entries
      WHERE league_uid = ${leagueUid}
      ORDER BY market, amount DESC NULLS LAST, player_name
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

    const [snapshotState] = await sql`
      SELECT COALESCE(MAX(latest_ids.max_id), 0) AS source_snapshot_max_id
      FROM league_team_memberships m
      LEFT JOIN (
        SELECT team_uid, MAX(id) AS max_id
        FROM team_snapshots
        WHERE status = 'success'
        GROUP BY team_uid
      ) latest_ids ON latest_ids.team_uid = m.team_uid
      WHERE m.league_uid = ${leagueUid}
    `;
    const sourceSnapshotMaxId = Number(snapshotState?.source_snapshot_max_id ?? 0);
    const [cachedCurve] = await sql`
      SELECT * FROM league_value_curves WHERE league_uid = ${leagueUid}
    `;

    let valueCurve: Record<string, unknown> | null;
    if (
      cachedCurve &&
      Number(cachedCurve.source_snapshot_max_id) === sourceSnapshotMaxId &&
      Number(cachedCurve.model_version) === VALUE_CURVE_MODEL_VERSION
    ) {
      valueCurve = curveResponse(cachedCurve);
    } else {
      const fittedCurve = buildLeagueValueCurve([...players]);
      if (!fittedCurve) {
        await sql`DELETE FROM league_value_curves WHERE league_uid = ${leagueUid}`;
        valueCurve = null;
      } else {
        const generatedAt = new Date().toISOString();
        const [savedCurve] = await sql`
          INSERT INTO league_value_curves (
            league_uid, parameters, player_count, rmse,
            source_snapshot_max_id, model_version, generated_at
          )
          VALUES (
            ${leagueUid}, ${JSON.stringify(fittedCurve.parameters)}::text::jsonb,
            ${fittedCurve.player_count}, ${fittedCurve.rmse},
            ${sourceSnapshotMaxId}, ${VALUE_CURVE_MODEL_VERSION}, ${generatedAt}
          )
          ON CONFLICT (league_uid)
          DO UPDATE SET
            parameters = EXCLUDED.parameters,
            player_count = EXCLUDED.player_count,
            rmse = EXCLUDED.rmse,
            source_snapshot_max_id = EXCLUDED.source_snapshot_max_id,
            model_version = EXCLUDED.model_version,
            generated_at = EXCLUDED.generated_at
          RETURNING *
        `;
        valueCurve = curveResponse(savedCurve);
      }
    }

    return Response.json(
      {
        league,
        market_entries: [...marketEntries],
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
