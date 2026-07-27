import assert from "node:assert/strict";
import { buildLineupRecommendations, buildProbableMatchups } from "../_shared/lineup.ts";

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
assert.equal(probableData.matchups.DET.starting_pitcher.pitcher_key, "tarik skubal");

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
);

assert.deepEqual(result.pitcher_starts.map((row: Record<string, unknown>) => row.player_key), ["tarik skubal"]);
assert.equal(result.pitcher_starts[0].opponent_team, "CLE");
assert.equal(result.pitcher_starts[0].points_per_ip, 6.1);

console.log("Lineup pitcher-start tests passed.");
