// Port of the recommendation logic in backend/app/lineup_helper.py (FanGraphs path).
import {
  fangraphsProbablePitcher,
  isIlPlayer,
  isMinorLeaguePlayer,
  isSuspendedPlayer,
  isOffTeamCode,
  minorLeagueLevel,
  normalizeMlbTeamCode,
  rosterMlbTeamCode,
  ScrapeError,
} from "./fangraphs.ts";

import type { Row } from "./fangraphs.ts";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseIsoDate(value: string): string {
  if (!ISO_DATE.test(value ?? "")) throw new ScrapeError("Date must use YYYY-MM-DD format.");
  return value;
}

export function buildProbableDateOptions(games: Row[], startDate: string, endDate: string): Row[] {
  const byDate = new Map<string, Row[]>();
  for (const game of games) {
    const gameDate = game.gameDate;
    if (!gameDate || gameDate < startDate || gameDate > endDate) continue;
    if (!byDate.has(gameDate)) byDate.set(gameDate, []);
    byDate.get(gameDate)!.push(game);
  }
  return [...byDate.keys()].sort().map((gameDate) => {
    const dateGames = byDate.get(gameDate)!;
    return {
      date: gameDate,
      game_count: Math.max(1, Math.round(dateGames.length / 2)),
      probable_starter_count: dateGames.filter((g) => fangraphsProbablePitcher(g.team ?? {})).length,
      source: "FanGraphs probables grid",
    };
  });
}

export function buildProbableMatchups(games: Row[], targetDate: string): Row {
  const dateGames = games.filter((g) => g.gameDate === targetDate);
  if (!dateGames.length) throw new ScrapeError(`No FanGraphs probable starter rows found for ${targetDate}.`);

  const matchups: Record<string, Row[]> = {};
  const matchupCounts = new Map<string, number>();
  for (const game of dateGames) {
    const teamCode = normalizeMlbTeamCode(game.abbName);
    const opponent = game.opponent ?? {};
    const opponentCode = normalizeMlbTeamCode(opponent.abbName);
    if (isOffTeamCode(teamCode) || isOffTeamCode(opponentCode)) continue;
    if (!teamCode || !opponentCode) continue;
    const countKey = `${teamCode}:${opponentCode}`;
    const fallbackNumber = (matchupCounts.get(countKey) ?? 0) + 1;
    matchupCounts.set(countKey, fallbackNumber);
    const { gameKey, gameNumber } = probableGameIdentity(
      game,
      targetDate,
      teamCode,
      opponentCode,
      fallbackNumber,
    );
    if (!matchups[teamCode]) matchups[teamCode] = [];
    matchups[teamCode].push({
      game_key: gameKey,
      game_number: gameNumber,
      opponent_team: opponentCode,
      opponent_name: opponentCode,
      starting_pitcher: fangraphsProbablePitcher(game.team ?? {}),
      opposing_pitcher: fangraphsProbablePitcher(opponent),
    });
  }
  for (const teamCode of Object.keys(matchups)) matchups[teamCode].sort(matchupSortCompare);
  return {
    date: targetDate,
    game_count: Math.max(1, Math.round(dateGames.length / 2)),
    probable_starter_count: dateGames.filter((g) => fangraphsProbablePitcher(g.team ?? {})).length,
    matchups,
  };
}

function probableGameIdentity(
  game: Row,
  targetDate: string,
  teamCode: string,
  opponentCode: string,
  fallbackNumber: number,
): { gameKey: string; gameNumber: number } {
  const explicitNumber = [game.dh, game.gameNumber]
    .map((value) => Number(value))
    .find((value) => Number.isInteger(value) && value > 0);
  const gameNumber = explicitNumber ?? fallbackNumber;
  const rawKey = game.gamePk ?? game.gameId;
  if (rawKey != null && String(rawKey).trim()) {
    return { gameKey: String(rawKey).trim(), gameNumber };
  }
  const teamPair = [teamCode, opponentCode].sort().join("-");
  return { gameKey: `${targetDate}:${teamPair}:${gameNumber}`, gameNumber };
}

function matchupSortCompare(a: Row, b: Row): number {
  const aNumber = Number.isInteger(Number(a.game_number)) && Number(a.game_number) > 0
    ? Number(a.game_number)
    : Number.MAX_SAFE_INTEGER;
  const bNumber = Number.isInteger(Number(b.game_number)) && Number(b.game_number) > 0
    ? Number(b.game_number)
    : Number.MAX_SAFE_INTEGER;
  return aNumber - bNumber || String(a.game_key ?? "").localeCompare(String(b.game_key ?? ""));
}

function lineupRecommendation(
  alwaysStart: boolean,
  alwaysSit: boolean,
  teamCode: string | null,
  matchup: Row | null,
  opposingPitcher: Row | null,
  xfipMinus: number | null,
): [string, string] {
  if (!teamCode) return ["no-mlb-team", "No MLB team"];
  if (!matchup) return ["no-game", "No game"];
  if (alwaysSit) return ["always-sit", "Sit"];
  if (alwaysStart) return ["always-start", "Always start"];
  if (!opposingPitcher) return ["no-probable", "No probable"];
  if (xfipMinus == null) return ["no-xfip", "No xFIP-"];
  if (xfipMinus < 90) return ["lean-sit", "Lean sit"];
  if (xfipMinus > 110) return ["lean-start", "Lean start"];
  return ["neutral", "Neutral"];
}

const SORT_ORDER: Record<string, number> = {
  "always-start": 0,
  "lean-start": 1,
  neutral: 2,
  "no-xfip": 3,
  "no-probable": 4,
  "lean-sit": 5,
  "always-sit": 6,
  "no-game": 7,
  "no-mlb-team": 8,
};

function lineupSortCompare(a: Row, b: Row): number {
  const oa = SORT_ORDER[a.recommendation_code] ?? 99;
  const ob = SORT_ORDER[b.recommendation_code] ?? 99;
  if (oa !== ob) return oa - ob;
  const sa = -(Number(a.salary) || 0);
  const sb = -(Number(b.salary) || 0);
  if (sa !== sb) return sa - sb;
  return String(a.player_name) < String(b.player_name) ? -1 : String(a.player_name) > String(b.player_name) ? 1 : 0;
}

function rosterAvailabilityLabel(player: Row, availabilityCode: string): string {
  if (availabilityCode === "il") return String(player.status ?? "IL") || "IL";
  if (availabilityCode === "suspended") return String(player.status ?? "SUSP") || "SUSP";
  return minorLeagueLevel(player.mlb_team) ?? "MiLB";
}

function unavailableLineupPlayer(player: Row, availabilityCode: string): Row {
  return {
    player_key: player.player_key,
    player_name: player.player_name,
    positions: player.positions ?? null,
    mlb_team: player.mlb_team ?? null,
    status: player.status ?? null,
    section: player.section ?? null,
    salary: player.salary ?? null,
    points: player.points ?? null,
    points_per_game: player.points_per_game ?? null,
    points_per_ip: player.points_per_ip ?? null,
    availability_code: availabilityCode,
    availability_label: rosterAvailabilityLabel(player, availabilityCode),
  };
}

function unavailableSortCompare(a: Row, b: Row): number {
  const sa = String(a.section ?? "");
  const sb = String(b.section ?? "");
  if (sa !== sb) return sa < sb ? -1 : 1;
  const na = String(a.player_name ?? "");
  const nb = String(b.player_name ?? "");
  return na < nb ? -1 : na > nb ? 1 : 0;
}

export function buildLineupRecommendations(
  rosterRows: Row[],
  statsByKey: Record<string, Row>,
  alwaysStartKeys: Set<string>,
  alwaysSitKeys: Set<string>,
  probableData: Row,
  teamOffenseRanks: Record<string, Row> = {},
): Row {
  const matchups: Record<string, Row | Row[]> = probableData.matchups ?? {};
  const ilPlayers: Row[] = [];
  const minorLeaguePlayers: Row[] = [];
  const suspendedPlayers: Row[] = [];
  for (const player of rosterRows) {
    if (isIlPlayer(player)) ilPlayers.push(unavailableLineupPlayer(player, "il"));
    else if (isMinorLeaguePlayer(player)) minorLeaguePlayers.push(unavailableLineupPlayer(player, "minors"));
    else if (isSuspendedPlayer(player)) suspendedPlayers.push(unavailableLineupPlayer(player, "suspended"));
  }

  const pitcherStarts: Row[] = [];
  for (const player of rosterRows) {
    if (player.section !== "pitcher") continue;
    if (isIlPlayer(player) || isMinorLeaguePlayer(player) || isSuspendedPlayer(player)) continue;
    const teamCode = rosterMlbTeamCode(player.mlb_team);
    const teamMatchups = matchupRows(matchups[teamCode ?? ""]);
    for (const matchup of teamMatchups) {
      const startingPitcher = matchup?.starting_pitcher ?? null;
      if (!startingPitcher || startingPitcher.pitcher_key !== player.player_key) continue;
      pitcherStarts.push({
        player_key: player.player_key,
        player_name: player.player_name,
        positions: player.positions ?? null,
        mlb_team: player.mlb_team ?? null,
        status: player.status ?? null,
        section: "pitcher",
        salary: player.salary ?? null,
        points: player.points ?? null,
        points_per_ip: player.points_per_ip ?? null,
        game_key: matchup.game_key ?? null,
        game_number: matchup.game_number ?? null,
        opponent_team: matchup.opponent_team ?? null,
        opponent_name: matchup.opponent_name ?? null,
        opponent_offense_ranks: teamOffenseRanks[matchup.opponent_team ?? ""] ?? null,
        fangraphs_url: startingPitcher.fangraphs_url ?? null,
      });
    }
  }
  pitcherStarts.sort((a, b) =>
    String(a.player_name).localeCompare(String(b.player_name))
    || Number(a.game_number ?? 0) - Number(b.game_number ?? 0)
    || String(a.game_key ?? "").localeCompare(String(b.game_key ?? ""))
  );

  const rows: Row[] = [];
  for (const player of rosterRows) {
    if (player.section !== "hitter") continue;
    if (isIlPlayer(player) || isMinorLeaguePlayer(player) || isSuspendedPlayer(player)) continue;
    const teamCode = rosterMlbTeamCode(player.mlb_team);
    const teamMatchups = matchupRows(matchups[teamCode ?? ""]);
    const games = teamMatchups.map((matchup, index) => hitterGameMatchup(matchup, statsByKey, index + 1));
    const primaryGame = games[0] ?? null;
    const alwaysSit = alwaysSitKeys.has(player.player_key);
    const alwaysStart = alwaysStartKeys.has(player.player_key) && !alwaysSit;
    const [code, rec] = lineupRecommendationForGames(alwaysStart, alwaysSit, teamCode, games);
    rows.push({
      player_key: player.player_key,
      player_name: player.player_name,
      positions: player.positions ?? null,
      mlb_team: player.mlb_team ?? null,
      status: player.status ?? null,
      section: player.section ?? null,
      salary: player.salary ?? null,
      points: player.points ?? null,
      points_per_game: player.points_per_game ?? null,
      plays_today: games.length > 0,
      games,
      opponent_team: primaryGame?.opponent_team ?? null,
      opponent_name: primaryGame?.opponent_name ?? null,
      opposing_pitcher_key: primaryGame?.opposing_pitcher_key ?? null,
      opposing_pitcher_name: primaryGame?.opposing_pitcher_name ?? null,
      opposing_pitcher_xfip_minus: primaryGame?.opposing_pitcher_xfip_minus ?? null,
      opposing_pitcher_xfip_provenance: primaryGame?.opposing_pitcher_xfip_provenance ?? "missing",
      opposing_pitcher_xfip_confidence: primaryGame?.opposing_pitcher_xfip_confidence ?? "missing",
      opposing_pitcher_xfip_source: primaryGame?.opposing_pitcher_xfip_source ?? null,
      recommendation: rec,
      recommendation_code: code,
      always_start: alwaysStart,
      always_sit: alwaysSit,
    });
  }
  rows.sort(lineupSortCompare);

  return {
    ...probableData,
    pitcher_stats_count: Object.keys(statsByKey).length,
    il_players: ilPlayers.sort(unavailableSortCompare),
    minor_league_players: minorLeaguePlayers.sort(unavailableSortCompare),
    suspended_players: suspendedPlayers.sort(unavailableSortCompare),
    pitcher_starts: pitcherStarts,
    rows,
  };
}

function matchupRows(value: unknown): Row[] {
  const rows = Array.isArray(value)
    ? value.filter((row): row is Row => row != null && typeof row === "object")
    : value != null && typeof value === "object"
    ? [value as Row]
    : [];
  return [...rows].sort(matchupSortCompare);
}

function hitterGameMatchup(matchup: Row, statsByKey: Record<string, Row>, fallbackNumber: number): Row {
  const opposingPitcher = matchup.opposing_pitcher ?? null;
  const pitcherKey = opposingPitcher?.pitcher_key ?? null;
  const pitcherStat = statsByKey[pitcherKey ?? ""] ?? null;
  const xfipMinus = pitcherStat?.xfip_minus ?? null;
  const xfipProvenance = xfipMinus == null ? "missing" : pitcherStat?.reference_provenance || "saved-reference";
  const xfipConfidence = xfipMinus == null ? "missing" : pitcherStat?.reference_confidence || "high";
  const xfipSource = xfipMinus == null ? null : pitcherStat?.source || null;
  return {
    game_key: matchup.game_key ?? null,
    game_number: matchup.game_number ?? fallbackNumber,
    opponent_team: matchup.opponent_team ?? null,
    opponent_name: matchup.opponent_name ?? null,
    opposing_pitcher_key: pitcherKey,
    opposing_pitcher_name: opposingPitcher?.pitcher_name ?? null,
    opposing_pitcher_xfip_minus: xfipMinus,
    opposing_pitcher_xfip_provenance: xfipProvenance,
    opposing_pitcher_xfip_confidence: xfipConfidence,
    opposing_pitcher_xfip_source: xfipSource,
  };
}

function lineupRecommendationForGames(
  alwaysStart: boolean,
  alwaysSit: boolean,
  teamCode: string | null,
  games: Row[],
): [string, string] {
  if (!teamCode) return ["no-mlb-team", "No MLB team"];
  if (!games.length) return ["no-game", "No game"];
  const allProbablesKnown = games.every((game) => Boolean(game.opposing_pitcher_name));
  const xfipValues = games.map((game) => game.opposing_pitcher_xfip_minus);
  const allXfipKnown = xfipValues.every((value) => value != null);
  const averageXfip = allXfipKnown
    ? xfipValues.reduce((sum, value) => sum + Number(value), 0) / xfipValues.length
    : null;
  return lineupRecommendation(
    alwaysStart,
    alwaysSit,
    teamCode,
    games[0],
    allProbablesKnown ? { pitcher_name: games[0].opposing_pitcher_name } : null,
    averageXfip,
  );
}
