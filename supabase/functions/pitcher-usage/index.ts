import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";
import {
  classifyPitcherUsage,
  extractPitcherAppearanceStarts,
  fallbackPitcherUsage,
  isDualEligible,
  parseOttoneuFangraphsIdMap,
  type RosterPitcher,
} from "../_shared/pitcher-usage.ts";
import { fetchPitcherXfipMinus } from "../_shared/fangraphs.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
const OTTONEU_AVERAGE_VALUES_URL = "https://ottoneu.fangraphs.com/averageValues?export=csv";
const FANGRAPHS_GAME_LOG_URL = "https://www.fangraphs.com/api/players/game-log";
const DATA_HEADERS = { "User-Agent": "okhttp/4.12.0", Accept: "application/json,text/csv,*/*" };

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
      SELECT r.ottoneu_player_id, r.player_key, r.player_name, r.positions,
             r.games, r.games_started, r.section
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
        AND r.section = 'pitcher'
      ORDER BY r.player_name
    `;
    if (!roster.length) {
      return Response.json({ error: "No loaded pitcher roster found for that team in this league." }, { status: 404, headers: CORS });
    }

    const players = [...roster] as RosterPitcher[];
    const errors: string[] = [];
    let idMap = new Map<number, string>();
    let idMapError: string | null = null;
    try {
      idMap = await fetchOttoneuFangraphsIdMap();
    } catch (error) {
      idMapError = `Ottoneu/FanGraphs player-ID mapping failed: ${errorMessage(error)}`;
      if (players.some((player) => isDualEligible(player.positions))) errors.push(idMapError);
    }

    const rows = await mapWithConcurrency<RosterPitcher, Record<string, any>>(players, 4, async (player) => {
      const ottoneuId = Number(player.ottoneu_player_id);
      const fangraphsId = Number.isFinite(ottoneuId) ? idMap.get(ottoneuId) ?? null : null;
      let usage: Record<string, any>;
      if (!isDualEligible(player.positions)) {
        usage = classifyPitcherUsage(player, [], fangraphsId);
      } else if (!fangraphsId) {
        const message = `No FanGraphs player ID found for ${player.player_name}.`;
        errors.push(message);
        usage = fallbackPitcherUsage(player, message);
      } else {
        try {
          const starts = await fetchPitcherAppearanceStarts(fangraphsId, season);
          usage = classifyPitcherUsage(player, starts, fangraphsId);
        } catch (error) {
          const message = `${player.player_name}: ${errorMessage(error)}`;
          errors.push(message);
          usage = fallbackPitcherUsage(player, errorMessage(error), fangraphsId);
        }
      }

      let xfipMinus: number | null = null;
      let xfipError = fangraphsId ? null : idMapError ?? `No FanGraphs player ID found for ${player.player_name}.`;
      if (fangraphsId) {
        try {
          xfipMinus = await fetchPitcherXfipMinus(fangraphsId, season, usage.fangraphs_url);
          if (xfipMinus == null) xfipError = `No ${season} MLB xFIP- row found.`;
        } catch (error) {
          xfipError = errorMessage(error);
        }
      }
      return { ...usage, xfip_minus: xfipMinus, xfip_error: xfipError };
    });

    rows.sort(
      (left, right) => String(left.bucket).localeCompare(String(right.bucket)) || String(left.player_name).localeCompare(String(right.player_name)),
    );
    return Response.json(
      {
        league_uid: leagueUid,
        team_uid: teamUid,
        season,
        source: "Ottoneu player-ID export + FanGraphs pitching game logs and player-page xFIP-",
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

async function fetchPitcherAppearanceStarts(playerId: string, season: number): Promise<number[]> {
  const url = new URL(FANGRAPHS_GAME_LOG_URL);
  url.searchParams.set("playerid", playerId);
  url.searchParams.set("position", "P");
  url.searchParams.set("type", "0");
  url.searchParams.set("season", String(season));
  const response = await fetch(url, { headers: DATA_HEADERS });
  if (!response.ok) throw new Error(`FanGraphs game log HTTP ${response.status}.`);
  return extractPitcherAppearanceStarts(await response.json());
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
