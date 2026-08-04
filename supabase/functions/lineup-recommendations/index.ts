// Supabase Edge Function: GET lineup recommendations for a team on a date.
// Ports /api/lineup/recommendations: reads roster + always-start/sit prefs from Supabase,
// fetches FanGraphs probables + opposing-pitcher xFIP-, and computes start/sit recommendations.
// Query params: league_uid, team_uid, date (YYYY-MM-DD).
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { fetchPitcherXfipMinus, fetchProbablesGridGames, fetchTeamOffenseRanks, Row, ScrapeError } from "../_shared/fangraphs.ts";
import { buildLineupRecommendations, buildProbableMatchups, parseIsoDate } from "../_shared/lineup.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return (async () => {
    try {
      const url = new URL(req.url);
      const leagueUid = (url.searchParams.get("league_uid") ?? "").trim();
      const teamUid = (url.searchParams.get("team_uid") ?? "").trim();
      const date = parseIsoDate((url.searchParams.get("date") ?? "").trim());
      if (!leagueUid || !teamUid) {
        return Response.json({ error: "league_uid and team_uid are required" }, { status: 400, headers: CORS });
      }

      const [league] = await sql`SELECT * FROM fantasy_leagues WHERE league_uid = ${leagueUid}`;
      if (!league) return Response.json({ error: "Unknown league." }, { status: 404, headers: CORS });

      const roster = await sql`
        SELECT r.player_key, r.player_name, r.positions, r.status, r.mlb_team, r.section,
               r.salary, r.points, r.points_per_game, r.points_per_ip
        FROM team_roster_entries r
        WHERE r.snapshot_id = (
          SELECT MAX(id) FROM team_snapshots WHERE team_uid = ${teamUid} AND status = 'success'
        )
      `;
      if (!roster.length) {
        return Response.json({ error: "No loaded roster found for that team in this league." }, { status: 404, headers: CORS });
      }

      const startRows = await sql`SELECT player_key FROM lineup_always_start_players WHERE league_uid = ${leagueUid} AND team_uid = ${teamUid}`;
      const sitRows = await sql`SELECT player_key FROM lineup_always_sit_players WHERE league_uid = ${leagueUid} AND team_uid = ${teamUid}`;
      const alwaysStart = new Set<string>(startRows.map((r) => r.player_key));
      const alwaysSit = new Set<string>(sitRows.map((r) => r.player_key));

      // FanGraphs probables + opposing-pitcher xFIP-.
      let probableData: Row;
      try {
        const games = await fetchProbablesGridGames();
        try {
          probableData = buildProbableMatchups(games, date);
        } catch {
          probableData = { date, game_count: 0, probable_starter_count: 0, matchups: {} };
        }
      } catch (err) {
        return Response.json(
          { error: `FanGraphs probables fetch failed: ${err instanceof Error ? err.message : err}` },
          { status: 502, headers: CORS },
        );
      }

      const pitchers = new Map<string, Row>();
      for (const matchup of Object.values(probableData.matchups as Record<string, Row>)) {
        const p = matchup.opposing_pitcher;
        if (p?.fangraphs_id && p?.fangraphs_url) pitchers.set(p.fangraphs_id, p);
      }
      const season = Number(date.slice(0, 4));
      const offenseRanksPromise = fetchTeamOffenseRanks(season)
        .then((rankings) => ({ rankings, error: null }))
        .catch((error) => ({
          rankings: {} as Record<string, Row>,
          error: String(error instanceof Error ? error.message : error),
        }));
      const statsByKey: Record<string, Row> = {};
      let errorCount = 0;
      await Promise.all(
        [...pitchers.values()].map(async (p) => {
          try {
            const x = await fetchPitcherXfipMinus(p.fangraphs_id, season, p.fangraphs_url);
            if (x != null) statsByKey[p.pitcher_key] = { xfip_minus: x };
          } catch {
            errorCount++;
          }
        }),
      );
      const offenseResult = await offenseRanksPromise;

      const xfipRefresh = {
        row_count: Object.keys(statsByKey).length,
        error_count: errorCount,
        message: `Refreshed ${Object.keys(statsByKey).length}/${pitchers.size} probable-starter xFIP- rows from FanGraphs.`,
      };
      const opponentOffenseRefresh = {
        team_count: Object.keys(offenseResult.rankings).length,
        error: offenseResult.error,
        message: offenseResult.error
          ? `FanGraphs team offense rankings could not be loaded: ${offenseResult.error}`
          : `Ranked ${Object.keys(offenseResult.rankings).length} MLB offenses from FanGraphs.`,
      };
      const recommendation = buildLineupRecommendations(
        [...roster], statsByKey, alwaysStart, alwaysSit, probableData, offenseResult.rankings,
      );

      return Response.json(
        {
          league,
          team_uid: teamUid,
          source: "FanGraphs probables grid + player-page xFIP- + team offense leaderboard",
          xfip_refresh: xfipRefresh,
          opponent_offense_refresh: opponentOffenseRefresh,
          ...recommendation,
        },
        { headers: CORS },
      );
    } catch (err) {
      const status = err instanceof ScrapeError ? 422 : 500;
      return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status, headers: CORS });
    }
  })();
});
