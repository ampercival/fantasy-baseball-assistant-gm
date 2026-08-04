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
  Row,
  ScrapeError,
} from "./fangraphs.ts";

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

  const matchups: Record<string, Row> = {};
  for (const game of dateGames) {
    const teamCode = normalizeMlbTeamCode(game.abbName);
    const opponent = game.opponent ?? {};
    const opponentCode = normalizeMlbTeamCode(opponent.abbName);
    if (isOffTeamCode(teamCode) || isOffTeamCode(opponentCode)) continue;
    if (!teamCode || !opponentCode) continue;
    matchups[teamCode] = {
      opponent_team: opponentCode,
      opponent_name: opponentCode,
      starting_pitcher: fangraphsProbablePitcher(game.team ?? {}),
      opposing_pitcher: fangraphsProbablePitcher(opponent),
    };
  }
  return {
    date: targetDate,
    game_count: Math.max(1, Math.round(dateGames.length / 2)),
    probable_starter_count: dateGames.filter((g) => fangraphsProbablePitcher(g.team ?? {})).length,
    matchups,
  };
}

function lineupRecommendation(
  alwaysStart: boolean,
  alwaysSit: boolean,
  teamCode: string | null,
  matchup: Row | null,
  opposingPitcher: Row | null,
  xfipMinus: number | null,
): [string, string] {
  if (alwaysSit) return ["always-sit", "Sit"];
  if (alwaysStart) return ["always-start", "Always start"];
  if (!teamCode) return ["no-mlb-team", "No MLB team"];
  if (!matchup) return ["no-game", "No game"];
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
  const matchups: Record<string, Row> = probableData.matchups ?? {};
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
    const teamCode = rosterMlbTeamCode(player.mlb_team);
    const matchup = matchups[teamCode ?? ""] ?? null;
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
      opponent_team: matchup?.opponent_team ?? null,
      opponent_name: matchup?.opponent_name ?? null,
      opponent_offense_ranks: teamOffenseRanks[matchup?.opponent_team ?? ""] ?? null,
      fangraphs_url: startingPitcher.fangraphs_url ?? null,
    });
  }
  pitcherStarts.sort((a, b) => String(a.player_name).localeCompare(String(b.player_name)));

  const rows: Row[] = [];
  for (const player of rosterRows) {
    if (player.section !== "hitter") continue;
    if (isIlPlayer(player) || isMinorLeaguePlayer(player) || isSuspendedPlayer(player)) continue;
    const teamCode = rosterMlbTeamCode(player.mlb_team);
    const matchup = matchups[teamCode ?? ""] ?? null;
    const opposingPitcher = matchup?.opposing_pitcher ?? null;
    const pitcherKey = opposingPitcher?.pitcher_key ?? null;
    const pitcherStat = statsByKey[pitcherKey ?? ""] ?? null;
    const xfipMinus = pitcherStat?.xfip_minus ?? null;
    const alwaysSit = alwaysSitKeys.has(player.player_key);
    const alwaysStart = alwaysStartKeys.has(player.player_key) && !alwaysSit;
    const [code, rec] = lineupRecommendation(alwaysStart, alwaysSit, teamCode, matchup, opposingPitcher, xfipMinus);
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
      opponent_team: matchup?.opponent_team ?? null,
      opponent_name: matchup?.opponent_name ?? null,
      opposing_pitcher_key: pitcherKey,
      opposing_pitcher_name: opposingPitcher?.pitcher_name ?? null,
      opposing_pitcher_xfip_minus: xfipMinus,
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
