import assert from "node:assert/strict";
import { buildMlbProbableDateOptions, buildMlbProbableMatchups } from "../_shared/mlb.ts";

const schedule = {
  dates: [
    {
      date: "2026-08-05",
      games: [
        {
          gamePk: 1001,
          gameNumber: 1,
          seriesGameNumber: 3,
          teams: {
            away: {
              team: { name: "New York Yankees", abbreviation: "NYY" },
              probablePitcher: { id: 123, fullName: "Gerrit Cole" },
            },
            home: {
              team: { name: "Boston Red Sox", abbreviation: "BOS" },
              probablePitcher: { id: 456, fullName: "Garrett Crochet" },
            },
          },
        },
        {
          gamePk: 1002,
          gameNumber: 2,
          seriesGameNumber: 4,
          teams: {
            away: {
              team: { name: "New York Yankees", abbreviation: "NYY" },
              probablePitcher: { id: 789, fullName: "Carlos Rodon" },
            },
            home: {
              team: { name: "Boston Red Sox", abbreviation: "BOS" },
              probablePitcher: { id: 987, fullName: "Brayan Bello" },
            },
          },
        },
      ],
    },
  ],
};

const dates = buildMlbProbableDateOptions(schedule, "2026-08-05", "2026-08-14");
assert.deepEqual(dates, [
  {
    date: "2026-08-05",
    game_count: 2,
    probable_starter_count: 4,
    source: "MLB Stats API schedule",
  },
]);

const matchups = buildMlbProbableMatchups(schedule, "2026-08-05");
assert.equal(matchups.game_count, 2);
assert.equal(matchups.probable_starter_count, 4);
assert.equal(matchups.matchups.NYY.length, 2);
assert.deepEqual(matchups.matchups.NYY.map((row: Record<string, unknown>) => row.game_key), ["1001", "1002"]);
assert.deepEqual(matchups.matchups.NYY.map((row: Record<string, unknown>) => row.game_number), [1, 2]);
assert.equal(matchups.matchups.NYY[0].opponent_team, "BOS");
assert.equal(matchups.matchups.NYY[0].starting_pitcher.pitcher_key, "gerrit cole");
assert.equal(matchups.matchups.BOS[0].opposing_pitcher.mlb_id, 123);
assert.equal(matchups.matchups.BOS[1].opposing_pitcher.pitcher_key, "carlos rodon");
assert.equal(matchups.source, "MLB Stats API schedule");

const ordinarySeriesGame = buildMlbProbableMatchups(
  {
    dates: [{
      date: "2026-08-06",
      games: [{
        seriesGameNumber: 4,
        teams: {
          away: { team: { name: "New York Yankees", abbreviation: "NYY" } },
          home: { team: { name: "Boston Red Sox", abbreviation: "BOS" } },
        },
      }],
    }],
  },
  "2026-08-06",
);
assert.equal(ordinarySeriesGame.matchups.NYY[0].game_number, 1);
assert.equal(ordinarySeriesGame.matchups.NYY[0].game_key, "2026-08-06:BOS-NYY:1");

console.log("MLB schedule fallback tests passed.");
