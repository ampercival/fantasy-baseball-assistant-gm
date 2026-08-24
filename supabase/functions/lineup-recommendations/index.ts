// Supabase Edge Function: GET lineup recommendations for a team on a date.
// Ports /api/lineup/recommendations: reads roster + always-start/sit prefs from Supabase,
// fetches FanGraphs probables + opposing-pitcher xFIP-, and computes start/sit recommendations.
// Query params: league_uid, team_uid, date (YYYY-MM-DD).
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { fetchPitcherXfipReference, fetchProbablesGridGames, fetchTeamOffenseRanks, ScrapeError } from "../_shared/fangraphs.ts";
import type { Row } from "../_shared/fangraphs.ts";
import { buildLineupRecommendations, buildProbableMatchups, parseIsoDate } from "../_shared/lineup.ts";
import { fetchMlbProbableMatchups } from "../_shared/mlb.ts";
import { resolveLineupReferenceData } from "./reference-data.ts";
import {
  persistLineupReferencePatch,
  type ReferenceCachePatchWrite,
} from "./reference-persistence.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
function jsonValue<T>(value: T | string): T {
  return typeof value === "string" ? JSON.parse(value) as T : value;
}

async function writeReferenceCachePatch(patch: ReferenceCachePatchWrite): Promise<boolean> {
  const pitcherRowCount = Object.keys(patch.pitcherStats).length;
  const offenseTeamCount = patch.offenseRanksSnapshot == null
    ? 0
    : Object.keys(patch.offenseRanksSnapshot).length;

  if (pitcherRowCount > 0 && offenseTeamCount > 0) {
    const updatedRows = await sql`
      UPDATE lineup_reference_cache
      SET pitcher_stats = COALESCE(pitcher_stats, '{}'::jsonb) || ${JSON.stringify(patch.pitcherStats)}::jsonb,
          team_offense_ranks = ${JSON.stringify(patch.offenseRanksSnapshot)}::jsonb
      WHERE season = ${patch.season}
        AND fetched_at = ${patch.expectedFetchedAt}
        AND fetched_at::timestamptz <= CURRENT_TIMESTAMP
        AND fetched_at::timestamptz >= CURRENT_TIMESTAMP - (${patch.maxAgeHours}::double precision * INTERVAL '1 hour')
      RETURNING season
    `;
    return updatedRows.length === 1;
  } else if (pitcherRowCount > 0) {
    const updatedRows = await sql`
      UPDATE lineup_reference_cache
      SET pitcher_stats = COALESCE(pitcher_stats, '{}'::jsonb) || ${JSON.stringify(patch.pitcherStats)}::jsonb
      WHERE season = ${patch.season}
        AND fetched_at = ${patch.expectedFetchedAt}
        AND fetched_at::timestamptz <= CURRENT_TIMESTAMP
        AND fetched_at::timestamptz >= CURRENT_TIMESTAMP - (${patch.maxAgeHours}::double precision * INTERVAL '1 hour')
      RETURNING season
    `;
    return updatedRows.length === 1;
  } else if (offenseTeamCount > 0) {
    const updatedRows = await sql`
      UPDATE lineup_reference_cache
      SET team_offense_ranks = ${JSON.stringify(patch.offenseRanksSnapshot)}::jsonb
      WHERE season = ${patch.season}
        AND fetched_at = ${patch.expectedFetchedAt}
        AND fetched_at::timestamptz <= CURRENT_TIMESTAMP
        AND fetched_at::timestamptz >= CURRENT_TIMESTAMP - (${patch.maxAgeHours}::double precision * INTERVAL '1 hour')
      RETURNING season
    `;
    return updatedRows.length === 1;
  }

  return false;
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
      let referenceCacheFetchedAt: string | null = null;
      try {
        const season = Number(date.slice(0, 4));
        const [dateRows, referenceRows] = await Promise.all([
          sql`
            SELECT games, source, fetched_at
            FROM lineup_date_cache
            WHERE game_date = ${date}
          `,
          sql`
            SELECT pitcher_stats, team_offense_ranks, fetched_at
            FROM lineup_reference_cache
            WHERE season = ${season}
          `,
        ]);
        const [dateCache] = dateRows;
        if (dateCache) {
          probableData = buildProbableMatchups(jsonValue<Row[]>(dateCache.games), date);
          probableData.source = dateCache.source;
          cacheGeneratedAt = dateCache.fetched_at;
        }
        const [referenceCache] = referenceRows;
        if (referenceCache) {
          cachedStats = jsonValue<Record<string, Row>>(referenceCache.pitcher_stats);
          cachedOffenseRanks = jsonValue<Record<string, Row>>(referenceCache.team_offense_ranks);
          referenceCacheFetchedAt = referenceCache.fetched_at;
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
      const opponentTeamCodes = new Set<string>();
      for (const teamMatchups of Object.values(probableData.matchups as Record<string, Row | Row[]>)) {
        const matchupRows = Array.isArray(teamMatchups) ? teamMatchups : [teamMatchups];
        for (const matchup of matchupRows) {
          const pitcher = matchup.opposing_pitcher;
          if (pitcher?.pitcher_key) opposingPitchers.set(pitcher.pitcher_key, pitcher);
          if (matchup.opponent_team) opponentTeamCodes.add(String(matchup.opponent_team));
        }
      }

      const referenceData = await resolveLineupReferenceData({
        season: Number(date.slice(0, 4)),
        probablePitchers: opposingPitchers.values(),
        opponentTeamCodes,
        cachedStats,
        cachedOffenseRanks,
        referenceCacheFetchedAt,
        fetchPitcherXfipMinus: fetchPitcherXfipReference,
        fetchTeamOffenseRanks,
      });
      const referenceCachePersistence = await persistLineupReferencePatch({
        season: Number(date.slice(0, 4)),
        referenceCache: referenceData.referenceCache,
        patch: referenceData.persistencePatch,
        writer: writeReferenceCachePatch,
      });
      const recommendation = buildLineupRecommendations(
        [...roster], referenceData.statsByKey, alwaysStart, alwaysSit, probableData, referenceData.offenseRanks,
      );
      const source = `${probableData.source ?? "Probable starter schedule"}; ${referenceData.source}`;

      return Response.json(
        {
          league,
          team_uid: teamUid,
          ...recommendation,
          source,
          cache_generated_at: cacheGeneratedAt,
          reference_cache_fetched_at: referenceCacheFetchedAt,
          reference_cache: referenceData.referenceCache,
          reference_cache_persistence: referenceCachePersistence,
          xfip_refresh: referenceData.xfipRefresh,
          opponent_offense_refresh: referenceData.opponentOffenseRefresh,
        },
        { headers: CORS },
      );
    } catch (err) {
      const status = err instanceof ScrapeError ? 422 : 500;
      return Response.json({ error: String(err instanceof Error ? err.message : err) }, { status, headers: CORS });
    }
  })();
});
