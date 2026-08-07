import type { AggregateBoard, SourceTag } from "./types";

// Only disagreement near the top of the board is interesting: whether two sources put a
// player at 640 or 690 says almost nothing, while 5 vs 60 says a lot. Pairs are compared
// when at least one side ranks the player inside this window, and ranks beyond it collapse
// to a single "outside" value so a deep ranking cannot dominate the average.
export const SOURCE_QUALITY_TOP_RANK = 200;

export type SourceQualityMetric = {
  comparisonCount: number;
  /** False when the source is excluded from the rankings, so it is not scored. */
  isIncluded: boolean;
  /** False when the source's own tag is not selected, so it is neither scored nor a peer. */
  inScoredTags: boolean;
  /** Size of the benchmark this source was measured against. */
  peerSourceCount: number;
  /** Mean rank distance from the benchmark sources, in ranks. 0 is perfect agreement. */
  qualityScore: number | null;
};

export function topRankWindowValue(rank: number) {
  return Math.min(rank, SOURCE_QUALITY_TOP_RANK + 1);
}

/**
 * How far each source sits from the consensus it is being judged against, as an average
 * rank distance.
 *
 * Both the benchmark and the scored set are the sources that are included in the rankings
 * and carry one of `scoredTags`. An excluded source is not part of the board, so it neither
 * pulls the consensus around nor gets a score of its own.
 *
 * Selecting the tags matters because a stale source is not the same as a bad one. Scoring
 * everything together makes an Old/Pre-season list look out of whack for being out of date,
 * which its source date already tells you.
 *
 * The average is over comparisons rather than a bare sum, which is the part that matters: a
 * sum rewards thin sources, since a source covering 75 players accumulates a fraction of the
 * distance of one covering 700 and lands at the top of the table for having less data.
 */
export function buildSourceQualityMetrics(board: AggregateBoard, scoredTags: SourceTag[]) {
  const scored = new Set(scoredTags);
  const referenceSources = board.sources.filter((source) => scored.has(source.source_tag) && source.included);
  const metrics = new Map<string, SourceQualityMetric>();

  for (const source of board.sources) {
    if (!scored.has(source.source_tag) || !source.included) {
      metrics.set(source.id, {
        comparisonCount: 0,
        inScoredTags: scored.has(source.source_tag),
        isIncluded: Boolean(source.included),
        peerSourceCount: 0,
        qualityScore: null
      });
      continue;
    }

    const peerSources = referenceSources.filter((peer) => peer.id !== source.id);
    let comparisonCount = 0;
    let totalRankDistance = 0;

    for (const player of board.players) {
      const sourceRank = player.source_ranks[source.id]?.rank;
      if (typeof sourceRank !== "number") continue;

      for (const peer of peerSources) {
        const peerRank = player.source_ranks[peer.id]?.rank;
        if (typeof peerRank !== "number") continue;

        if (sourceRank <= SOURCE_QUALITY_TOP_RANK || peerRank <= SOURCE_QUALITY_TOP_RANK) {
          comparisonCount += 1;
          totalRankDistance += Math.abs(topRankWindowValue(sourceRank) - topRankWindowValue(peerRank));
        }
      }
    }

    metrics.set(source.id, {
      comparisonCount,
      inScoredTags: true,
      isIncluded: true,
      peerSourceCount: peerSources.length,
      qualityScore: comparisonCount ? totalRankDistance / comparisonCount : null
    });
  }

  return metrics;
}
