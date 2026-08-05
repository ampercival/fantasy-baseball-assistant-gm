import assert from "node:assert/strict";
import { buildMlbProbableDateOptions, buildMlbProbableMatchups } from "../_shared/mlb.ts";

const schedule = {
  dates: [
    {
      date: "2026-08-05",
      games: [
        {
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
      ],
    },
  ],
};

const dates = buildMlbProbableDateOptions(schedule, "2026-08-05", "2026-08-14");
assert.deepEqual(dates, [
  {
    date: "2026-08-05",
    game_count: 1,
    probable_starter_count: 2,
    source: "MLB Stats API schedule",
  },
]);

const matchups = buildMlbProbableMatchups(schedule, "2026-08-05");
assert.equal(matchups.game_count, 1);
assert.equal(matchups.probable_starter_count, 2);
assert.equal(matchups.matchups.NYY.opponent_team, "BOS");
assert.equal(matchups.matchups.NYY.starting_pitcher.pitcher_key, "gerrit cole");
assert.equal(matchups.matchups.BOS.opposing_pitcher.mlb_id, 123);
assert.equal(matchups.source, "MLB Stats API schedule");

console.log("MLB schedule fallback tests passed.");
