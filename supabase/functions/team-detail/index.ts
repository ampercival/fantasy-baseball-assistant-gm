// Supabase Edge Function: GET team detail with board rankings.
// Ports get_team_detail + enrich_team_with_rankings: assembles the latest successful team
// snapshot (roster / penalties / loans / trade block) and attaches each roster player's
// aggregate-board ranking.
//
// Query params: team_uid (required), tdg_format=obp|points, fantrax_format=roto|points
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { loadBoard, formatExclusions } from "../_shared/board.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const teamUid = (url.searchParams.get("team_uid") ?? "").trim();
    if (!teamUid) return Response.json({ error: "team_uid is required" }, { status: 400, headers: CORS });
    const tdg = (url.searchParams.get("tdg_format") ?? "obp").toLowerCase();
    const fantrax = (url.searchParams.get("fantrax_format") ?? "roto").toLowerCase();

    const [team] = await sql`SELECT * FROM fantasy_teams WHERE team_uid = ${teamUid}`;
    if (!team) return Response.json({ error: "Unknown team." }, { status: 404, headers: CORS });

    const [snapshot] = await sql`
      SELECT * FROM team_snapshots
      WHERE team_uid = ${teamUid} AND status = 'success'
      ORDER BY id DESC LIMIT 1
    `;
    if (!snapshot) {
      return Response.json(
        { team, snapshot: null, roster: [], penalties: [], loans: [], trade_block: [] },
        { headers: CORS },
      );
    }
    const snapshotId = Number(snapshot.id);

    const [roster, penalties, loans, tradeBlock] = await Promise.all([
      sql`
        SELECT * FROM team_roster_entries WHERE snapshot_id = ${snapshotId}
        ORDER BY CASE section WHEN 'hitter' THEN 0 ELSE 1 END, salary DESC, player_name
      `,
      sql`
        SELECT * FROM team_cap_penalties WHERE snapshot_id = ${snapshotId}
        ORDER BY penalty DESC, cut_date, player_name
      `,
      sql`
        SELECT * FROM team_loans WHERE snapshot_id = ${snapshotId}
        ORDER BY direction, amount DESC, counterparty
      `,
      sql`
        SELECT * FROM team_trade_block WHERE snapshot_id = ${snapshotId}
        ORDER BY CASE side WHEN 'have' THEN 0 ELSE 1 END, salary DESC, player_name
      `,
    ]);

    const board = await loadBoard(sql, { excludeSourceIds: formatExclusions(tdg, fantrax) });
    const rankingLookup = new Map<string, unknown>();
    for (const p of board.players) {
      rankingLookup.set(p.player_key, {
        aggregate_rank: p.aggregate_rank,
        avg_rank: p.avg_rank,
        median_rank: p.median_rank,
        source_count: p.source_count,
      });
    }

    const enrichedRoster = [...roster].map((player) => ({
      ...player,
      ranking: rankingLookup.get(player.player_key) ?? null,
    }));

    return Response.json(
      {
        team,
        snapshot,
        roster: enrichedRoster,
        penalties: [...penalties],
        loans: [...loans],
        trade_block: [...tradeBlock],
      },
      { headers: CORS },
    );
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500, headers: CORS });
  }
});
