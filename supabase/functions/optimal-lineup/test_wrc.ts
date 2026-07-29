import assert from "node:assert/strict";
import { fangraphsSeasonMlbMetric } from "../_shared/fangraphs.ts";

const payload = {
  data: [
    { aseason: 2025, type: 0, AbbLevel: "MLB", "wRC+": 111 },
    { aseason: "2026", type: "0", AbbLevel: "MLB", "wRC+": "127.08" },
    { aseason: 2026, type: 1, AbbLevel: "MLB", "wRC+": 140 },
    { aseason: 2026, type: 0, AbbLevel: "AAA", "wRC+": 150 },
  ],
};

assert.equal(fangraphsSeasonMlbMetric(payload, 2026, "wRC+"), 127.08);
assert.equal(fangraphsSeasonMlbMetric(payload, 2024, "wRC+"), null);

console.log("Optimal lineup wRC+ tests passed.");
