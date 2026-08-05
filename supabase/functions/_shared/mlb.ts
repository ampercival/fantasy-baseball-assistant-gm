import { normalizeMlbTeamCode, ScrapeError } from "./fangraphs.ts";
import type { Row } from "./fangraphs.ts";
import { normalizePlayerKey } from "./player-key.ts";

const MLB_SCHEDULE_URL = "https://statsapi.mlb.com/api/v1/schedule";

function scheduleTeam(game: Row, side: "away" | "home"): Row | null {
  const team = game?.teams?.[side]?.team;
  const code = normalizeMlbTeamCode(team?.abbreviation ?? team?.name);
  if (!code) return null;
  return { code, name: String(team?.name ?? code).trim() || code };
}

function scheduleProbablePitcher(game: Row, side: "away" | "home"): Row | null {
  const pitcher = game?.teams?.[side]?.probablePitcher;
  const name = String(pitcher?.fullName ?? "").trim();
  if (!name) return null;
  return {
    mlb_id: pitcher?.id ?? null,
    pitcher_name: name,
    pitcher_key: normalizePlayerKey(name),
  };
}

function scheduleDates(payload: Row): Row[] {
  return Array.isArray(payload?.dates) ? payload.dates : [];
}

function probableStarterCount(games: Row[]): number {
  return games.reduce(
    (count, game) => count
      + (scheduleProbablePitcher(game, "away") ? 1 : 0)
      + (scheduleProbablePitcher(game, "home") ? 1 : 0),
    0,
  );
}

export function buildMlbProbableDateOptions(payload: Row, startDate: string, endDate: string): Row[] {
  return scheduleDates(payload)
    .filter((dateRow) => dateRow?.date >= startDate && dateRow?.date <= endDate)
    .map((dateRow) => {
      const games = Array.isArray(dateRow?.games) ? dateRow.games : [];
      return {
        date: dateRow.date,
        game_count: games.length,
        probable_starter_count: probableStarterCount(games),
        source: "MLB Stats API schedule",
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

export function buildMlbProbableMatchups(payload: Row, targetDate: string): Row {
  const dateRow = scheduleDates(payload).find((row) => row?.date === targetDate);
  const games: Row[] = Array.isArray(dateRow?.games) ? dateRow.games : [];
  const matchups: Record<string, Row> = {};

  for (const game of games) {
    const away = scheduleTeam(game, "away");
    const home = scheduleTeam(game, "home");
    if (!away || !home) continue;
    const awayPitcher = scheduleProbablePitcher(game, "away");
    const homePitcher = scheduleProbablePitcher(game, "home");
    matchups[away.code] = {
      opponent_team: home.code,
      opponent_name: home.name,
      starting_pitcher: awayPitcher,
      opposing_pitcher: homePitcher,
    };
    matchups[home.code] = {
      opponent_team: away.code,
      opponent_name: away.name,
      starting_pitcher: homePitcher,
      opposing_pitcher: awayPitcher,
    };
  }

  return {
    date: targetDate,
    game_count: games.length,
    probable_starter_count: probableStarterCount(games),
    matchups,
    source: "MLB Stats API schedule",
  };
}

async function fetchMlbSchedule(startDate: string, endDate: string): Promise<Row> {
  const url = new URL(MLB_SCHEDULE_URL);
  url.searchParams.set("sportId", "1");
  url.searchParams.set("startDate", startDate);
  url.searchParams.set("endDate", endDate);
  url.searchParams.set("hydrate", "probablePitcher,team");
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "fantasy-baseball-assistant-gm/1.0",
    },
  });
  if (!response.ok) throw new ScrapeError(`MLB schedule HTTP ${response.status}.`);
  try {
    return await response.json();
  } catch {
    throw new ScrapeError("MLB schedule returned invalid JSON.");
  }
}

export async function fetchMlbProbableDateOptions(startDate: string, endDate: string): Promise<Row[]> {
  return buildMlbProbableDateOptions(await fetchMlbSchedule(startDate, endDate), startDate, endDate);
}

export async function fetchMlbProbableMatchups(targetDate: string): Promise<Row> {
  return buildMlbProbableMatchups(await fetchMlbSchedule(targetDate, targetDate), targetDate);
}
