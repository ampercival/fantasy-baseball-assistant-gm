// Supabase Edge Function: GET lineup recommendations for a team on a date.
// Ports /api/lineup/recommendations: reads roster + always-start/sit prefs from Supabase,
// fetches FanGraphs probables + opposing-pitcher xFIP-, and computes start/sit recommendations.
// Query params: league_uid, team_uid, date (YYYY-MM-DD).
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { fetchPitcherXfipMinus, fetchProbablesGridGames, fetchTeamOffenseRanks, ScrapeError } from "../_shared/fangraphs.ts";
import type { Row } from "../_shared/fangraphs.ts";
import { buildLineupRecommendations, buildProbableMatchups, parseIsoDate } from "../_shared/lineup.ts";
import { fetchMlbProbableMatchups } from "../_shared/mlb.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
function jsonValue<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

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

      // Prefer the home-worker cache, then live FanGraphs, then MLB's official schedule API.
      let probableData: Row | undefined;
      let cachedStats: Record<string, Row> | null = null;
      let cachedOffenseRanks: Record<string, Row> | null = null;
      let cacheGeneratedAt: string | null = null;
      try {
        const [cache] = await sql`
          SELECT games, pitcher_stats, team_offense_ranks, generated_at
          FROM lineup_data_cache
          WHERE cache_key = 'current'
        `;
        if (cache) {
          probableData = buildProbableMatchups(jsonValue<Row[]>(cache.games), date);
          probableData.source = "FanGraphs via home worker";
          cachedStats = jsonValue<Record<string, Row>>(cache.pitcher_stats);
          cachedOffenseRanks = jsonValue<Record<string, Row>>(cache.team_offense_ranks);
          cacheGeneratedAt = cache.generated_at;
        }
      } catch {
        // A missing, stale-for-this-date, or malformed cache falls through to live sources.
      }

      if (!probableData) {
        try {
          try {
            const games = await fetchProbablesGridGames();
            probableData = buildProbableMatchups(games, date);
            probableData.source = "FanGraphs probables grid";
          } catch {
            probableData = await fetchMlbProbableMatchups(date);
          }
        } catch (err) {
          return Response.json(
            { error: `Probable starter fetch failed: ${err instanceof Error ? err.message : err}` },
            { status: 502, headers: CORS },
          );
        }
      }
      if (!probableData) {
        return Response.json({ error: "No probable starter data was available." }, { status: 502, headers: CORS });
      }

      const opposingPitchers = new Map<string, Row>();
      for (const matchup of Object.values(probableData.matchups as Record<string, Row>)) {
        const pitcher = matchup.opposing_pitcher;
        if (pitcher?.pitcher_key) opposingPitchers.set(pitcher.pitcher_key, pitcher);
      }

      const statsByKey: Record<string, Row> = {};
      let errorCount = 0;
      let offenseResult: { rankings: Record<string, Row>; error: string | null };
      let xfipMessage: string;
      if (cachedStats && cachedOffenseRanks) {
        for (const pitcher of opposingPitchers.values()) {
          const cached = cachedStats[pitcher.pitcher_key];
          if (cached) statsByKey[pitcher.pitcher_key] = cached;
        }
        offenseResult = { rankings: cachedOffenseRanks, error: null };
        xfipMessage =
          `Loaded ${Object.keys(statsByKey).length}/${opposingPitchers.size} probable-starter xFIP- rows ` +
          `from the home-worker cache${cacheGeneratedAt ? ` (${cacheGeneratedAt})` : ""}.`;
      } else {
        const season = Number(date.slice(0, 4));
        const fetchablePitchers = [...opposingPitchers.values()].filter(
          (pitcher) => pitcher.fangraphs_id && pitcher.fangraphs_url,
        );
        const offenseRanksPromise = fetchTeamOffenseRanks(season)
          .then((rankings) => ({ rankings, error: null }))
          .catch((error) => ({
            rankings: {} as Record<string, Row>,
            error: String(error instanceof Error ? error.message : error),
          }));
        await Promise.all(
          fetchablePitchers.map(async (pitcher) => {
            try {
              const xfipMinus = await fetchPitcherXfipMinus(
                pitcher.fangraphs_id,
                season,
                pitcher.fangraphs_url,
              );
              if (xfipMinus != null) statsByKey[pitcher.pitcher_key] = { xfip_minus: xfipMinus };
            } catch {
              errorCount++;
            }
          }),
        );
        offenseResult = await offenseRanksPromise;
        xfipMessage =
          `Refreshed ${Object.keys(statsByKey).length}/${fetchablePitchers.length} ` +
          "probable-starter xFIP- rows from FanGraphs.";
      }

      const xfipRefresh = {
        row_count: Object.keys(statsByKey).length,
        error_count: errorCount,
        message: xfipMessage,
      };
      const opponentOffenseRefresh = {
        team_count: Object.keys(offenseResult.rankings).length,
        error: offenseResult.error,
        message: cachedOffenseRanks
          ? `Loaded ${Object.keys(offenseResult.rankings).length} cached MLB offense rankings from the home worker.`
          : offenseResult.error
          ? `FanGraphs team offense rankings could not be loaded: ${offenseResult.error}`
          : `Ranked ${Object.keys(offenseResult.rankings).length} MLB offenses from FanGraphs.`,
      };
      const recommendation = buildLineupRecommendations(
        [...roster], statsByKey, alwaysStart, alwaysSit, probableData, offenseResult.rankings,
      );
      const source = cachedStats
        ? "FanGraphs probables, pitcher xFIP-, and team offense via home worker"
        : `${probableData.source ?? "Probable starter schedule"} + player-page xFIP- + team offense leaderboard`;

      return Response.json(
        {
          league,
          team_uid: teamUid,
          ...recommendation,
          source,
          cache_generated_at: cacheGeneratedAt,
          xfip_refresh: xfipRefresh,
          opponent_offense_refresh: opponentOffenseRefresh,
        },
        { headers: CORS },
      );
    } catch (err) {
      const status = err instanceof ScrapeError ? 422 : 500;
      return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status, headers: CORS });
    }
  })();
});
