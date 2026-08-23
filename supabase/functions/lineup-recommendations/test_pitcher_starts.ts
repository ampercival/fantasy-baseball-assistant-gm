import assert from "node:assert/strict";
import { buildTeamOffenseRanks } from "../_shared/fangraphs.ts";
import { buildLineupRecommendations, buildProbableMatchups } from "../_shared/lineup.ts";

const offenseRanks = buildTeamOffenseRanks(
  {
    data: [
      { Team: '<a href="/leaders/major-league?team=6">DET</a>', Season: 2026, wRC: 100, wRAA: 10, wOBA: 0.330, "wRC+": 110 },
      { Team: '<a href="/leaders/major-league?team=5">CLE</a>', Season: 2026, wRC: 110, wRAA: 5, wOBA: 0.340, "wRC+": 115 },
      { Team: '<a href="/leaders/major-league?team=9">NYY</a>', Season: 2026, wRC: 90, wRAA: 15, wOBA: 0.320, "wRC+": 105 },
    ],
  },
  2026,
);
assert.equal(offenseRanks.CLE.aggregate_rank, 1);
assert.equal(offenseRanks.CLE.average_rank, 1.5);
assert.equal(offenseRanks.CLE.wraa_rank, 3);


const games = [
  {
    gameDate: "2026-07-27",
    abbName: "DET",
    team: {
      sp: {
        name: "Tarik Skubal",
        playerId: 18080,
        UPURL: "/players/tarik-skubal/18080/stats",
      },
    },
    opponent: {
      abbName: "CLE",
      sp: {
        name: "Gavin Williams",
        playerId: 29461,
        UPURL: "/players/gavin-williams/29461/stats",
      },
    },
  },
];

const probableData = buildProbableMatchups(games, "2026-07-27");
assert.equal(probableData.matchups.DET[0].starting_pitcher.pitcher_key, "tarik skubal");

const result = buildLineupRecommendations(
  [
    {
      player_key: "tarik skubal",
      player_name: "Tarik Skubal",
      positions: "SP",
      mlb_team: "DET",
      status: "",
      section: "pitcher",
      salary: 45,
      points: 800,
      points_per_ip: 6.1,
    },
    {
      player_key: "jack flaherty",
      player_name: "Jack Flaherty",
      positions: "SP",
      mlb_team: "DET",
      status: "",
      section: "pitcher",
      salary: 12,
      points: 500,
      points_per_ip: 4.8,
    },
  ],
  {},
  new Set(),
  new Set(),
  probableData,
  offenseRanks,
);

assert.deepEqual(result.pitcher_starts.map((row: Record<string, unknown>) => row.player_key), ["tarik skubal"]);
assert.equal(result.pitcher_starts[0].opponent_team, "CLE");
assert.equal(result.pitcher_starts[0].points_per_ip, 6.1);
assert.equal(result.pitcher_starts[0].opponent_offense_ranks.aggregate_rank, 1);
assert.equal(result.pitcher_starts[0].opponent_offense_ranks.wrc_plus_rank, 1);

const probablePitcher = (name: string, playerId: number) => ({
  name,
  playerId,
  UPURL: `/players/${playerId}/stats`,
});
const doubleheaderGames = [
  {
    gameDate: "2026-08-29",
    abbName: "BOS",
    dh: 2,
    seriesGameNumber: 4,
    team: { sp: probablePitcher("Brayan Bello", 3) },
    opponent: { abbName: "NYY", sp: probablePitcher("Carlos Rodon", 4) },
  },
  {
    gameDate: "2026-08-29",
    abbName: "NYY",
    dh: 2,
    seriesGameNumber: 4,
    team: { sp: probablePitcher("Carlos Rodon", 4) },
    opponent: { abbName: "BOS", sp: probablePitcher("Brayan Bello", 3) },
  },
  {
    gameDate: "2026-08-29",
    abbName: "BOS",
    dh: 1,
    seriesGameNumber: 3,
    team: { sp: probablePitcher("Jake Bennett", 1) },
    opponent: { abbName: "NYY", sp: probablePitcher("Elmer Rodriguez", 2) },
  },
  {
    gameDate: "2026-08-29",
    abbName: "NYY",
    dh: 1,
    seriesGameNumber: 3,
    team: { sp: probablePitcher("Elmer Rodriguez", 2) },
    opponent: { abbName: "BOS", sp: probablePitcher("Jake Bennett", 1) },
  },
];
const doubleheaderData = buildProbableMatchups(doubleheaderGames, "2026-08-29");
assert.equal(doubleheaderData.game_count, 2);
assert.equal(doubleheaderData.probable_starter_count, 4);
assert.deepEqual(doubleheaderData.matchups.BOS.map((row: Record<string, unknown>) => row.game_number), [1, 2]);
assert.deepEqual(
  doubleheaderData.matchups.BOS.map((row: Record<string, unknown>) => row.game_key),
  ["2026-08-29:BOS-NYY:1", "2026-08-29:BOS-NYY:2"],
);
const ordinarySeriesGame = buildProbableMatchups(
  [{
    gameDate: "2026-08-30",
    abbName: "DET",
    dh: 0,
    seriesGameNumber: 3,
    team: { sp: probablePitcher("Tarik Skubal", 5) },
    opponent: { abbName: "CLE", sp: probablePitcher("Gavin Williams", 6) },
  }],
  "2026-08-30",
);
assert.equal(ordinarySeriesGame.matchups.DET[0].game_number, 1);
assert.equal(ordinarySeriesGame.matchups.DET[0].game_key, "2026-08-30:CLE-DET:1");
assert.deepEqual(
  doubleheaderData.matchups.NYY.map((row: Record<string, unknown>) => row.game_key),
  ["2026-08-29:BOS-NYY:1", "2026-08-29:BOS-NYY:2"],
);

const doubleheaderResult = buildLineupRecommendations(
  [
    {
      player_key: "willson contreras",
      player_name: "Willson Contreras",
      positions: "1B",
      mlb_team: "BOS",
      status: "",
      section: "hitter",
      salary: 12,
      points: 700,
      points_per_game: 6.69,
    },
    {
      player_key: "jake bennett",
      player_name: "Jake Bennett",
      positions: "SP",
      mlb_team: "BOS",
      status: "",
      section: "pitcher",
      salary: 8,
      points: 350,
      points_per_ip: 5.03,
    },
    {
      player_key: "brayan bello",
      player_name: "Brayan Bello",
      positions: "SP",
      mlb_team: "BOS",
      status: "",
      section: "pitcher",
      salary: 10,
      points: 400,
      points_per_ip: 4.9,
    },
  ],
  {
    "elmer rodriguez": { xfip_minus: 80 },
    "carlos rodon": { xfip_minus: 160 },
  },
  new Set(),
  new Set(),
  doubleheaderData,
);
const hitterRow = doubleheaderResult.rows[0];
assert.equal(hitterRow.plays_today, true);
assert.deepEqual(hitterRow.games.map((game: Record<string, unknown>) => game.game_number), [1, 2]);
assert.deepEqual(
  hitterRow.games.map((game: Record<string, unknown>) => game.opposing_pitcher_key),
  ["elmer rodriguez", "carlos rodon"],
);
assert.equal(hitterRow.opposing_pitcher_key, "elmer rodriguez");
assert.equal(hitterRow.opposing_pitcher_xfip_minus, 80);
assert.equal(hitterRow.recommendation_code, "lean-start");
const startsByKey = Object.fromEntries(
  doubleheaderResult.pitcher_starts.map((row: Record<string, unknown>) => [row.player_key, row]),
);
assert.deepEqual(Object.keys(startsByKey).sort(), ["brayan bello", "jake bennett"]);
assert.equal(startsByKey["jake bennett"].game_number, 1);
assert.equal(startsByKey["brayan bello"].game_number, 2);

const missingProbableData = {
  date: "2026-08-29",
  matchups: {
    BOS: [
      doubleheaderData.matchups.BOS[0],
      { ...doubleheaderData.matchups.BOS[1], opposing_pitcher: null },
    ],
  },
};
const hitterOnlyRoster = [{
  player_key: "willson contreras",
  player_name: "Willson Contreras",
  positions: "1B",
  mlb_team: "BOS",
  status: "",
  section: "hitter",
}];
const missingProbableResult = buildLineupRecommendations(
  hitterOnlyRoster,
  { "elmer rodriguez": { xfip_minus: 146.4 } },
  new Set(),
  new Set(),
  missingProbableData,
);
assert.equal(missingProbableResult.rows[0].recommendation_code, "no-probable");
const missingXfipResult = buildLineupRecommendations(
  hitterOnlyRoster,
  { "elmer rodriguez": { xfip_minus: 146.4 } },
  new Set(),
  new Set(),
  doubleheaderData,
);
assert.equal(missingXfipResult.rows[0].recommendation_code, "no-xfip");

const hardStateResult = buildLineupRecommendations(
  [
    {
      player_key: "ronald acuna",
      player_name: "Ronald Acuna Jr.",
      positions: "OF",
      mlb_team: "ATL",
      status: "",
      section: "hitter",
    },
    {
      player_key: "unassigned hitter",
      player_name: "Unassigned Hitter",
      positions: "OF",
      mlb_team: null,
      status: "",
      section: "hitter",
    },
  ],
  {},
  new Set(["ronald acuna"]),
  new Set(["unassigned hitter"]),
  { date: "2026-08-24", matchups: {} },
);
const hardStatesByKey = Object.fromEntries(
  hardStateResult.rows.map((row: Record<string, unknown>) => [row.player_key, row]),
);
assert.equal(hardStatesByKey["ronald acuna"].plays_today, false);
assert.equal(hardStatesByKey["ronald acuna"].recommendation_code, "no-game");
assert.equal(hardStatesByKey["unassigned hitter"].plays_today, false);
assert.equal(hardStatesByKey["unassigned hitter"].recommendation_code, "no-mlb-team");

for (const status of ["15IL", "MiLB", "SUSP"]) {
  const unavailableResult = buildLineupRecommendations(
    [{
      player_key: "jake bennett",
      player_name: "Jake Bennett",
      positions: "SP",
      mlb_team: "BOS",
      status,
      section: "pitcher",
    }],
    {},
    new Set(),
    new Set(),
    doubleheaderData,
  );
  assert.deepEqual(unavailableResult.pitcher_starts, []);
}

console.log("Lineup pitcher-start tests passed.");
