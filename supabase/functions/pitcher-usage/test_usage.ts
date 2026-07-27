import assert from "node:assert/strict";
import {
  classifyPitcherUsage,
  extractPitcherAppearanceStarts,
  fallbackPitcherUsage,
  parseOttoneuFangraphsIdMap,
} from "../_shared/pitcher-usage.ts";

const player = {
  player_key: "test pitcher",
  player_name: "Test Pitcher",
  positions: "SP/RP",
  games: 8,
  games_started: 4,
};

assert.deepEqual(
  classifyPitcherUsage(player, [1, 0, 1, 0, 1, 0]).last_five,
  ["SP", "RP", "SP", "RP", "SP"],
);
assert.equal(classifyPitcherUsage(player, [1, 0, 1, 0, 1, 0]).role, "Mixed - SP");
assert.equal(classifyPitcherUsage(player, [1, 0, 1, 0]).role, "Mixed - RP");
assert.equal(classifyPitcherUsage(player, [1, 1]).role, "SP");
assert.equal(classifyPitcherUsage(player, [0, 0]).role, "RP");
assert.equal(fallbackPitcherUsage(player, "blocked").role, "Usage unavailable");
assert.equal(classifyPitcherUsage({ ...player, positions: "SP" }, [], 123).fangraphs_id, "123");

assert.deepEqual(
  extractPitcherAppearanceStarts({
    mlb: [
      { gamedate: "2050-01-01", G: 2, GS: 1 },
      { gamedate: "2026-04-02", G: 1, GS: 0 },
      { gamedate: "2026-04-03", G: 1, GS: 1 },
    ],
  }),
  [1, 0],
);

const idMap = parseOttoneuFangraphsIdMap(
  'Name,OttoneuID,"FG MajorLeagueID","FG MinorLeagueID"\n"Test, Jr.",99,123,sa123\n',
);
assert.equal(idMap.get(99), "123");

console.log("Pitcher usage tests passed.");
