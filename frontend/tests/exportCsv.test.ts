import assert from "node:assert/strict";
import test from "node:test";
import { aggregatePlayersToCsv } from "../src/exportCsv";
import type { AggregateBoard, AggregatePlayer } from "../src/types";

const board = {
  sources: [{ id: "site_one", short_name: "Site, One" }],
  source_groups: [{ source_tag: "Continuous" }]
} as AggregateBoard;

const includedPlayer = {
  aggregate_rank: 1,
  player_key: "doe_jane",
  player_name: 'Doe, "Jane"',
  team: "NYM",
  positions: "SS",
  age: null,
  avg_rank: 1.5,
  median_rank: 1.5,
  best_rank: 1,
  worst_rank: 2,
  rank_spread: 1,
  source_count: 1,
  rank_stddev: 0.5,
  avg_percentile: 0.99,
  source_ranks: { site_one: { rank: 2 } },
  group_ranks: { Continuous: { aggregate_rank: 1 } }
} as AggregatePlayer;

test("exports only supplied rows with the aggregate CSV schema and valid escaping", () => {
  const csv = aggregatePlayersToCsv(board, [includedPlayer]);
  const lines = csv.replace(/^\ufeff/, "").trimEnd().split("\n");

  assert.equal(lines.length, 2);
  assert.equal(
    lines[0],
    'aggregate_rank,player,team,positions,age,avg_rank,median_rank,best_rank,worst_rank,rank_spread,source_count,Continuous sub_aggregate_rank,"Site, One"'
  );
  assert.equal(lines[1], '1,"Doe, ""Jane""",NYM,SS,,1.5,1.5,1,2,1,1,1,2');
});
