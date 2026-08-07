import type { AggregateBoard, SourceTag } from "./types";

// Only disagreement near the top of the board is interesting: whether two sources put a
// player at 640 or 690 says almost nothing, while 5 vs 60 says a lot. Pairs are compared
// when at least one side ranks the player inside this window, and ranks beyond it collapse
// to a single "outside" value so a deep ranking cannot dominate the average.
export const SOURCE_QUALITY_TOP_RANK = 200;

export type SourceQualityMetric = {
  comparisonCount: number;
  /** False when the source's own tag is not selected, so it is neither scored nor a peer. */
  inScoredTags: boolean;
  /** Size of the reference set this source was measured against. */
  peerSourceCount: number;
  /** Mean rank distance from the reference sources, in ranks. 0 is perfect agreement. */
  qualityScore: number | null;
};

export function topRankWindowValue(rank: number) {
  return Math.min(rank, SOURCE_QUALITY_TOP_RANK + 1);
}

/**
 * How far each source sits from the consensus it is being judged against, as an average
 * rank distance.
 *
 * The reference set is the sources that are both included in the rankings and carry one of
 * `scoredTags`. Measuring against anything else answers the wrong question: an excluded
 * source is not part of your board, so letting it pull the consensus around would score a
 * source against numbers it never contributes to.
 *
 * Sources in the selected tags are still scored even when excluded, measured against that
 * reference set rather than joining it. That is the number you want when deciding whether
 * to bring an excluded source back in.
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
    if (!scored.has(source.source_tag)) {
      metrics.set(source.id, {
        comparisonCount: 0,
        inScoredTags: false,
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
      peerSourceCount: peerSources.length,
      qualityScore: comparisonCount ? totalRankDistance / comparisonCount : null
    });
  }

  return metrics;
}
