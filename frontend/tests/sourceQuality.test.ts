import { describe, expect, test } from "vitest";
import { buildSourceQualityMetrics, SOURCE_QUALITY_TOP_RANK } from "../src/sourceQuality";
import type { AggregateBoard, BoardSource, SourceTag } from "../src/types";

function source(id: string, source_tag: SourceTag = "Continuous", included = 1): BoardSource {
  return { id, source_tag, included } as unknown as BoardSource;
}

// Only the fields buildSourceQualityMetrics reads; the real board type carries far more.
function board(sources: BoardSource[], players: Array<Record<string, number>>): AggregateBoard {
  return {
    sources,
    players: players.map((ranksBySource, index) => ({
      player_key: `p${index}`,
      source_ranks: Object.fromEntries(
        Object.entries(ranksBySource).map(([sourceId, rank]) => [sourceId, { rank }])
      )
    }))
  } as unknown as AggregateBoard;
}

const ALL: SourceTag[] = ["Continuous", "Updated", "Old/Pre-season"];

describe("buildSourceQualityMetrics", () => {
  test("scores the average rank distance, not the accumulated total", () => {
    const metrics = buildSourceQualityMetrics(
      board([source("a"), source("b")], [
        { a: 1, b: 11 },
        { a: 2, b: 32 }
      ]),
      ALL
    );
    // Distances of 10 and 30 over two comparisons.
    expect(metrics.get("a")?.qualityScore).toBe(20);
    expect(metrics.get("a")?.comparisonCount).toBe(2);
    expect(metrics.get("b")?.qualityScore).toBe(20);
  });

  test("a thin source does not out-score a broad one that disagrees by the same margin", () => {
    // Both "wide" and "sparse" sit exactly 10 ranks off "broad" and never overlap each
    // other, so only their coverage differs. Summing distances used to hand the win to the
    // thin source on volume alone.
    const players: Array<Record<string, number>> = Array.from({ length: 20 }, (_, index) => ({
      broad: index + 1,
      wide: index + 11
    }));
    players.push({ broad: 21, sparse: 31 });

    const metrics = buildSourceQualityMetrics(board([source("broad"), source("wide"), source("sparse")], players), ALL);
    expect(metrics.get("wide")?.qualityScore).toBe(10);
    expect(metrics.get("sparse")?.qualityScore).toBe(10);
    expect(metrics.get("sparse")?.comparisonCount).toBe(1);
    expect(metrics.get("wide")?.comparisonCount).toBe(20);
  });

  test("only scores sources in the selected tags, against each other", () => {
    const metrics = buildSourceQualityMetrics(
      board([source("live", "Continuous"), source("fresh", "Updated"), source("stale", "Old/Pre-season")], [
        { live: 1, fresh: 11, stale: 101 }
      ]),
      ["Continuous", "Updated"]
    );

    expect(metrics.get("live")?.qualityScore).toBe(10);
    expect(metrics.get("live")?.peerSourceCount).toBe(1);
    expect(metrics.get("fresh")?.qualityScore).toBe(10);

    // The excluded tag is neither scored nor allowed to drag the others.
    const stale = metrics.get("stale");
    expect(stale?.inScoredTags).toBe(false);
    expect(stale?.qualityScore).toBeNull();
  });

  test("a source alone in the selected tags has no peers to score against", () => {
    const metrics = buildSourceQualityMetrics(
      board([source("live", "Continuous"), source("stale", "Old/Pre-season")], [{ live: 1, stale: 40 }]),
      ["Continuous"]
    );
    expect(metrics.get("live")?.inScoredTags).toBe(true);
    expect(metrics.get("live")?.peerSourceCount).toBe(0);
    expect(metrics.get("live")?.qualityScore).toBeNull();
  });

  test("collapses ranks past the window and skips pairs outside it entirely", () => {
    const metrics = buildSourceQualityMetrics(
      board([source("a"), source("b")], [
        { a: 1, b: 900 },   // 900 collapses to 201, so the distance is 200
        { a: 640, b: 690 }  // neither side is inside the window, so it is not compared
      ]),
      ALL
    );
    expect(metrics.get("a")?.comparisonCount).toBe(1);
    expect(metrics.get("a")?.qualityScore).toBe(SOURCE_QUALITY_TOP_RANK);
  });

  test("measures against included sources only, without letting an excluded one skew them", () => {
    const metrics = buildSourceQualityMetrics(
      board([source("a"), source("b"), source("wild", "Continuous", 0)], [{ a: 1, b: 11, wild: 191 }]),
      ALL
    );

    // a and b see only each other, so the excluded source cannot drag the consensus.
    expect(metrics.get("a")?.qualityScore).toBe(10);
    expect(metrics.get("a")?.peerSourceCount).toBe(1);
    expect(metrics.get("a")?.comparisonCount).toBe(1);

    // The excluded source is still scored, against the included pair: 190 and 180.
    expect(metrics.get("wild")?.qualityScore).toBe(185);
    expect(metrics.get("wild")?.peerSourceCount).toBe(2);
  });

  test("reports no score when nothing overlaps", () => {
    const metrics = buildSourceQualityMetrics(board([source("a"), source("b")], [{ a: 1 }, { b: 2 }]), ALL);
    expect(metrics.get("a")?.qualityScore).toBeNull();
    expect(metrics.get("a")?.comparisonCount).toBe(0);
  });
});
