// Parity test: run buildAggregateBoard on each fixture's raw inputs and deep-compare the
// result against the Python oracle output stored in the same fixture.
// Run from the project root:  npx tsx supabase/functions/aggregate-board/test_parity.ts
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildAggregateBoard } from "./logic.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "__fixtures__");

interface Diff {
  path: string;
  expected: unknown;
  actual: unknown;
}

function deepDiff(expected: any, actual: any, path: string, out: Diff[], limit = 40): void {
  if (out.length >= limit) return;
  if (typeof expected === "number" && typeof actual === "number") {
    if (expected !== actual) out.push({ path, expected, actual });
    return;
  }
  if (expected === null || actual === null || typeof expected !== "object") {
    if (expected !== actual) out.push({ path, expected, actual });
    return;
  }
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(expected) || !Array.isArray(actual)) {
      out.push({ path, expected, actual });
      return;
    }
    if (expected.length !== actual.length) {
      out.push({ path: `${path}.length`, expected: expected.length, actual: actual.length });
    }
    const n = Math.min(expected.length, actual.length);
    for (let i = 0; i < n; i++) deepDiff(expected[i], actual[i], `${path}[${i}]`, out, limit);
    return;
  }
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
  for (const k of keys) {
    deepDiff(expected[k], actual[k], path ? `${path}.${k}` : k, out, limit);
    if (out.length >= limit) return;
  }
}

let failed = 0;
for (const file of readdirSync(fixtureDir).filter((f) => f.endsWith(".json")).sort()) {
  const fixture = JSON.parse(readFileSync(join(fixtureDir, file), "utf-8"));
  const actual = buildAggregateBoard(fixture.sources, fixture.entries, {
    includedTags: fixture.params.includedTags,
  });
  const diffs: Diff[] = [];
  deepDiff(fixture.board, actual, "", diffs);
  if (diffs.length === 0) {
    console.log(`PASS  ${file}  (players=${actual.players.length})`);
  } else {
    failed++;
    console.log(`FAIL  ${file}  (${diffs.length}+ diffs)`);
    for (const d of diffs.slice(0, 12)) {
      console.log(`   ${d.path}\n      expected: ${JSON.stringify(d.expected)?.slice(0, 120)}\n      actual:   ${JSON.stringify(d.actual)?.slice(0, 120)}`);
    }
  }
}

console.log(failed === 0 ? "\nALL FIXTURES MATCH" : `\n${failed} FIXTURE(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
