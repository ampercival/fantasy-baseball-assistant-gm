import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import { fetchHitterWrcPlus, isMinorLeaguePlayer } from "../_shared/fangraphs.ts";
import { parseOttoneuFangraphsIdMap, type RosterPitcher } from "../_shared/pitcher-usage.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
const OTTONEU_AVERAGE_VALUES_URL = "https://ottoneu.fangraphs.com/averageValues?export=csv";
const DATA_HEADERS = { "User-Agent": "okhttp/4.12.0", Accept: "text/csv,*/*" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const leagueUid = (url.searchParams.get("league_uid") ?? "").trim();
    const teamUid = (url.searchParams.get("team_uid") ?? "").trim();
    const currentYear = new Date().getUTCFullYear();
    const season = Number(url.searchParams.get("season") || currentYear);
    if (!leagueUid || !teamUid) {
      return Response.json({ error: "league_uid and team_uid are required" }, { status: 400, headers: CORS });
    }
    if (!Number.isInteger(season) || season < 1900 || season > currentYear + 1) {
      return Response.json({ error: "Use a valid baseball season." }, { status: 422, headers: CORS });
    }

    const roster = await sql`
      SELECT r.ottoneu_player_id, r.player_key, r.player_name, r.positions, r.status, r.mlb_team,
             r.salary, r.games, r.plate_appearances, r.points_per_game, r.points, r.section
      FROM league_team_memberships m
      JOIN LATERAL (
        SELECT * FROM team_snapshots
        WHERE team_uid = m.team_uid AND status = 'success'
        ORDER BY id DESC
        LIMIT 1
      ) latest_snapshot ON true
      JOIN team_roster_entries r ON r.snapshot_id = latest_snapshot.id
      WHERE m.league_uid = ${leagueUid}
        AND m.team_uid = ${teamUid}
        AND r.section = 'hitter'
      ORDER BY r.player_name
    `;
    if (!roster.length) {
      return Response.json({ error: "No loaded hitter roster found for that team in this league." }, { status: 404, headers: CORS });
    }

    const hitters = ([...roster] as RosterPitcher[]).filter((player) => !isMinorLeaguePlayer(player));
    const errors: string[] = [];
    let idMap = new Map<number, string>();
    try {
      idMap = await fetchOttoneuFangraphsIdMap();
    } catch (error) {
      errors.push(`Ottoneu/FanGraphs player-ID mapping failed: ${errorMessage(error)}`);
    }

    const rows = await mapWithConcurrency<RosterPitcher, Record<string, any>>(hitters, 6, async (player) => {
      const ottoneuId = Number(player.ottoneu_player_id);
      const fangraphsId = Number.isFinite(ottoneuId) ? idMap.get(ottoneuId) ?? null : null;
      const fangraphsUrl = fangraphsId
        ? `https://www.fangraphs.com/players/${playerSlug(String(player.player_name ?? ""))}/${fangraphsId}/stats?position=H`
        : null;
      let wrcPlus: number | null = null;
      let wrcError: string | null = null;
      if (!fangraphsId) {
        wrcError = `No FanGraphs player ID found for ${player.player_name}.`;
      } else {
        try {
          wrcPlus = await fetchHitterWrcPlus(fangraphsId, season, fangraphsUrl!);
          if (wrcPlus == null) wrcError = `No ${season} MLB wRC+ row found.`;
        } catch (error) {
          wrcError = errorMessage(error);
        }
      }
      if (wrcError) errors.push(`${player.player_name}: ${wrcError}`);
      return {
        player_key: player.player_key,
        player_name: player.player_name,
        positions: player.positions ?? null,
        status: player.status ?? null,
        mlb_team: player.mlb_team ?? null,
        salary: player.salary ?? null,
        games: player.games ?? null,
        plate_appearances: player.plate_appearances ?? null,
        points_per_game: player.points_per_game ?? null,
        points: player.points ?? null,
        fangraphs_id: fangraphsId,
        fangraphs_url: fangraphsUrl,
        wrc_plus: wrcPlus,
        wrc_error: wrcError,
      };
    });

    rows.sort((left, right) => String(left.player_name).localeCompare(String(right.player_name)));
    return Response.json(
      {
        league_uid: leagueUid,
        team_uid: teamUid,
        season,
        source: "Ottoneu roster scoring + FanGraphs player-page wRC+",
        fetched_at: new Date().toISOString(),
        rows,
        errors,
      },
      { headers: CORS },
    );
  } catch (error) {
    return Response.json({ error: errorMessage(error) }, { status: 500, headers: CORS });
  }
});

async function fetchOttoneuFangraphsIdMap(): Promise<Map<number, string>> {
  const response = await fetch(OTTONEU_AVERAGE_VALUES_URL, { headers: DATA_HEADERS });
  if (!response.ok) throw new Error(`Ottoneu player-ID export HTTP ${response.status}.`);
  return parseOttoneuFangraphsIdMap(await response.text());
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function playerSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "player";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
