// Port of the FanGraphs-fetching parts of backend/app/lineup_helper.py.
import { cleanPlayerName, normalizePlayerKey } from "./player-key.ts";

const FANGRAPHS_PROBABLES_URL = "https://www.fangraphs.com/roster-resource/probables-grid";
const FANGRAPHS_PLAYER_STATS_URL = "https://www.fangraphs.com/api/players/stats";
const FANGRAPHS_TEAM_OFFENSE_URL = "https://www.fangraphs.com/api/leaders/major-league/data";
const FANGRAPHS_TEAM_OFFENSE_PAGE_URL =
  "https://www.fangraphs.com/leaders/major-league?team=0%2Cts&type=1&sortcol=19&sortdir=default&pagenum=1";

const FANGRAPHS_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/json,text/plain,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const MLB_TO_OTTONEU_TEAM_CODES: Record<string, string> = {
  CWS: "CHW",
  KC: "KCR",
  SD: "SDP",
  SF: "SFG",
  TB: "TBR",
  WSH: "WSN",
};

export const MINOR_LEVEL_TOKENS = new Set(["A", "A+", "AA", "AAA", "CPX", "ROK"]);

export class ScrapeError extends Error {}

export type Row = Record<string, any>;

function assertNotCloudflareChallenge(text: string): void {
  if (text.includes("Just a moment") || text.includes("__cf_chl")) {
    throw new ScrapeError("FanGraphs returned a Cloudflare challenge.");
  }
}

export async function fetchProbablesGridGames(): Promise<Row[]> {
  const res = await fetch(FANGRAPHS_PROBABLES_URL, { headers: FANGRAPHS_HEADERS });
  if (!res.ok) throw new ScrapeError(`FanGraphs probables grid HTTP ${res.status}.`);
  const html = await res.text();
  assertNotCloudflareChallenge(html);

  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new ScrapeError("FanGraphs probables grid payload was not found.");
  let payload: Row;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    throw new ScrapeError("FanGraphs probables grid payload could not be parsed.");
  }
  const queries = payload?.props?.pageProps?.dehydratedState?.queries ?? [];
  for (const query of queries) {
    const key = query?.queryKey;
    if (Array.isArray(key) && key.length === 1 && key[0] === "roster-resource/probables-grid/data") {
      const games = query?.state?.data?.games;
      if (Array.isArray(games) && games.length) return games;
    }
  }
  throw new ScrapeError("FanGraphs probables grid did not contain game data.");
}

export function fangraphsProbablePitcher(container: Row | null | undefined): Row | null {
  const pitcher = container?.sp ?? container?.primaryPitcher ?? container?.opener;
  if (!pitcher) return null;
  const pitcherName = cleanPlayerName(pitcher.name ?? "");
  if (!pitcherName) return null;
  const playerId = pitcher.playerId;
  const playerUrl = pitcher.UPURL;
  const fangraphsId = playerId != null && String(playerId).trim() ? String(playerId).trim() : null;
  return {
    fangraphs_id: fangraphsId,
    fangraphs_url:
      playerUrl && String(playerUrl).startsWith("/") ? `https://www.fangraphs.com${playerUrl}` : playerUrl ?? null,
    pitcher_name: pitcherName,
    pitcher_key: normalizePlayerKey(pitcherName),
  };
}

export async function fetchPitcherXfipMinus(
  playerId: string | number,
  season: number,
  refererUrl: string,
): Promise<number | null> {
  const url = new URL(FANGRAPHS_PLAYER_STATS_URL);
  url.searchParams.set("playerid", String(playerId));
  url.searchParams.set("position", "P");
  url.searchParams.set("season", String(season));
  const res = await fetch(url.toString(), {
    headers: { ...FANGRAPHS_HEADERS, Accept: "application/json,text/plain,*/*", Referer: refererUrl },
  });
  if (!res.ok) return null;
  const text = await res.text();
  assertNotCloudflareChallenge(text);
  let payload: Row;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  return fangraphsSeasonMlbMetric(payload, season, "xFIP-");
}

export async function fetchHitterWrcPlus(
  playerId: string | number,
  season: number,
  refererUrl: string,
): Promise<number | null> {
  const url = new URL(FANGRAPHS_PLAYER_STATS_URL);
  url.searchParams.set("playerid", String(playerId));
  url.searchParams.set("position", "H");
  url.searchParams.set("season", String(season));
  const res = await fetch(url.toString(), {
    headers: { ...FANGRAPHS_HEADERS, Accept: "application/json,text/plain,*/*", Referer: refererUrl },
  });
  if (!res.ok) return null;
  const text = await res.text();
  assertNotCloudflareChallenge(text);
  let payload: Row;
  try {
    payload = JSON.parse(text);
  } catch {
    return null;
  }
  return fangraphsSeasonMlbMetric(payload, season, "wRC+");
}

export async function fetchTeamOffenseRanks(season: number): Promise<Record<string, Row>> {
  const url = new URL(FANGRAPHS_TEAM_OFFENSE_URL);
  const params: Record<string, string> = {
    age: "",
    pos: "all",
    stats: "bat",
    lg: "all",
    qual: "0",
    type: "1",
    season: String(season),
    season1: String(season),
    ind: "0",
    team: "0,ts",
    rost: "0",
    filter: "",
    players: "0",
    month: "0",
    sortcol: "19",
    sortdir: "default",
    startdate: "",
    enddate: "",
    pageitems: "30",
    pagenum: "1",
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = await fetch(url.toString(), {
    headers: {
      ...FANGRAPHS_HEADERS,
      Accept: "application/json,text/plain,*/*",
      Referer: FANGRAPHS_TEAM_OFFENSE_PAGE_URL,
    },
  });
  if (!res.ok) throw new ScrapeError(`FanGraphs team offense leaderboard HTTP ${res.status}.`);
  const text = await res.text();
  assertNotCloudflareChallenge(text);
  let payload: Row;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new ScrapeError("FanGraphs team offense payload could not be parsed.");
  }
  const rankings = buildTeamOffenseRanks(payload, season);
  if (!Object.keys(rankings).length) {
    throw new ScrapeError(`FanGraphs did not return ${season} team offense rows.`);
  }
  return rankings;
}

export function buildTeamOffenseRanks(payload: Row, season: number): Record<string, Row> {
  const metrics = ["wRC", "wRAA", "wOBA", "wRC+"] as const;
  const valuesByTeam: Record<string, Row> = {};
  for (const rawRow of payload?.data ?? []) {
    if (rawRow?.Season != null && Number(rawRow.Season) !== season) continue;
    const teamCode = fangraphsTeamCode(rawRow?.Team);
    if (!teamCode) continue;
    const values: Row = {};
    for (const metric of metrics) {
      const value = parseFloatOrNull(rawRow?.[metric]);
      if (value != null) values[metric] = value;
    }
    if (Object.keys(values).length) valuesByTeam[teamCode] = values;
  }

  const metricRanks: Record<string, Record<string, number>> = {};
  for (const metric of metrics) {
    const ordered = Object.entries(valuesByTeam)
      .filter(([, values]) => values[metric] != null)
      .map(([teamCode, values]) => [teamCode, Number(values[metric])] as const)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
    const ranks: Record<string, number> = {};
    let previousValue: number | null = null;
    let previousRank = 0;
    ordered.forEach(([teamCode, value], index) => {
      const rank = previousValue != null && value === previousValue ? previousRank : index + 1;
      ranks[teamCode] = rank;
      previousValue = value;
      previousRank = rank;
    });
    metricRanks[metric] = ranks;
  }

  const rows: Record<string, Row> = {};
  const teamCount = Object.keys(valuesByTeam).length;
  for (const [teamCode, values] of Object.entries(valuesByTeam)) {
    const ranks = metrics.map((metric) => metricRanks[metric]?.[teamCode]).filter((rank) => rank != null);
    const averageRank = ranks.length ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : null;
    rows[teamCode] = {
      team_code: teamCode,
      season,
      team_count: teamCount,
      aggregate_rank: null,
      average_rank: averageRank,
      wrc_rank: metricRanks.wRC?.[teamCode] ?? null,
      wraa_rank: metricRanks.wRAA?.[teamCode] ?? null,
      woba_rank: metricRanks.wOBA?.[teamCode] ?? null,
      wrc_plus_rank: metricRanks["wRC+"]?.[teamCode] ?? null,
      wrc: values.wRC ?? null,
      wraa: values.wRAA ?? null,
      woba: values.wOBA ?? null,
      wrc_plus: values["wRC+"] ?? null,
    };
  }

  const aggregateRows = Object.values(rows)
    .filter((row) => row.average_rank != null)
    .sort((left, right) => left.average_rank - right.average_rank || String(left.team_code).localeCompare(String(right.team_code)));
  let previousAverage: number | null = null;
  let previousRank = 0;
  aggregateRows.forEach((row, index) => {
    const rank = previousAverage != null && row.average_rank === previousAverage ? previousRank : index + 1;
    row.aggregate_rank = rank;
    previousAverage = row.average_rank;
    previousRank = rank;
  });
  return rows;
}

function fangraphsTeamCode(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return normalizeMlbTeamCode(text);
}

export function fangraphsSeasonMlbMetric(payload: Row, season: number, field: string): number | null {
  for (const row of payload?.data ?? []) {
    if (Number(row?.aseason) === season && Number(row?.type) === 0 && row?.AbbLevel === "MLB") {
      const value = row[field];
      return typeof value === "number" ? value : parseFloatOrNull(value);
    }
  }
  return null;
}

function parseFloatOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

// ── team-code + availability helpers ─────────────────────────────────────────

export function normalizeMlbTeamCode(value: unknown): string | null {
  if (value == null) return null;
  const code = String(value).trim().toUpperCase();
  if (!code) return null;
  return MLB_TO_OTTONEU_TEAM_CODES[code] ?? code;
}

export function isOffTeamCode(value: unknown): boolean {
  return ["OFF", "NO GAME", "NONE"].includes(String(value ?? "").trim().toUpperCase());
}

export function rosterMlbTeamCode(value: unknown): string | null {
  if (value == null) return null;
  const parts = String(value).trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length > 1 && MINOR_LEVEL_TOKENS.has(parts[1])) return null;
  return normalizeMlbTeamCode(parts[0]);
}

export function minorLeagueLevel(value: unknown): string | null {
  if (value == null) return null;
  const parts = String(value).trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (parts.length > 1 && MINOR_LEVEL_TOKENS.has(parts[1])) return parts[1];
  return null;
}

export function isIlPlayer(player: Row): boolean {
  const status = String(player.status ?? "").toUpperCase();
  return /(?:^|[^A-Z])(?:IL|DL)(?:$|[^A-Z])/.test(status);
}

export function isMinorLeaguePlayer(player: Row): boolean {
  const status = String(player.status ?? "").toUpperCase();
  if (status.includes("MILB")) return true;
  return minorLeagueLevel(player.mlb_team) !== null;
}

export function isSuspendedPlayer(player: Row): boolean {
  return String(player.status ?? "").toUpperCase().includes("SUSP");
}
