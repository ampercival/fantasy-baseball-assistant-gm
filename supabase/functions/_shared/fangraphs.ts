// Port of the FanGraphs-fetching parts of backend/app/lineup_helper.py.
import { cleanPlayerName, normalizePlayerKey } from "./player-key.ts";

const FANGRAPHS_PROBABLES_URL = "https://www.fangraphs.com/roster-resource/probables-grid";
const FANGRAPHS_PLAYER_STATS_URL = "https://www.fangraphs.com/api/players/stats";

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
  for (const row of payload?.data ?? []) {
    if (row?.aseason === season && row?.type === 0 && row?.AbbLevel === "MLB") {
      const value = row["xFIP-"];
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
  return status.includes("IL") || status.includes("DL");
}

export function isMinorLeaguePlayer(player: Row): boolean {
  const status = String(player.status ?? "").toUpperCase();
  if (status.includes("MILB")) return true;
  return minorLeagueLevel(player.mlb_team) !== null;
}

export function isSuspendedPlayer(player: Row): boolean {
  return String(player.status ?? "").toUpperCase().includes("SUSP");
}
