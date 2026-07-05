// Aggregate dynasty board — TypeScript port of backend/app/aggregate.py:build_aggregate_board.
// Pure, runtime-agnostic logic (no Deno/Node APIs) so it can be unit-tested under Node and
// run inside a Supabase Edge Function. Snapshot selection (excludeSourceIds / includedOnly) is
// applied upstream by the SQL query that produces `sources` and `entries`; this module performs
// the aggregation that follows. Verified against the Python oracle via __fixtures__.

export const SOURCE_TAGS = ["Continuous", "Updated", "Old/Pre-season"] as const;

export interface BoardParams {
  includedTags?: string[] | null;
}

type Row = Record<string, any>;

// ── numeric helpers (match CPython semantics) ────────────────────────────────

function incrementDigits(d: string): string {
  const arr = d.split("");
  let i = arr.length - 1;
  while (i >= 0) {
    if (arr[i] === "9") {
      arr[i] = "0";
      i--;
    } else {
      arr[i] = String(Number(arr[i]) + 1);
      break;
    }
  }
  if (i < 0) arr.unshift("1");
  return arr.join("");
}

/**
 * Round half-to-even like Python's round(x, ndigits). Works on the decimal expansion of the
 * true double value (via toFixed with guard digits) rather than scaling by 10^n, which would
 * lose the precision that distinguishes a true tie from a near-tie.
 */
export function pyRound(x: number, ndigits = 0): number {
  if (!Number.isFinite(x)) return x;
  if (x < 0) return -pyRound(-x, ndigits);
  const guard = 20;
  const s = x.toFixed(ndigits + guard); // e.g. "24.05000000000000071..."
  const dot = s.indexOf(".");
  const intPart = dot < 0 ? s : s.slice(0, dot);
  const frac = dot < 0 ? "" : s.slice(dot + 1);
  const keepFrac = frac.slice(0, ndigits);
  const rest = frac.slice(ndigits); // guard digits used to decide rounding
  let digits = intPart + keepFrac; // implied decimal point after intPart

  const firstRest = rest.charCodeAt(0) - 48;
  let roundUp: boolean;
  if (firstRest > 5) {
    roundUp = true;
  } else if (firstRest < 5) {
    roundUp = false;
  } else if (/[1-9]/.test(rest.slice(1))) {
    roundUp = true; // > 0.5
  } else {
    roundUp = (digits.charCodeAt(digits.length - 1) - 48) % 2 === 1; // exact tie -> to even
  }
  if (roundUp) digits = incrementDigits(digits);

  return Number(digits) / 10 ** ndigits;
}

// Compensated (Neumaier) summation to match Python's math.fsum / statistics.fmean precision,
// so 4-decimal avg_percentile rounding agrees with the Python oracle.
function fsum(values: number[]): number {
  let sum = 0;
  let c = 0;
  for (const v of values) {
    const t = sum + v;
    c += Math.abs(sum) >= Math.abs(v) ? sum - t + v : v - t + sum;
    sum = t;
  }
  return sum + c;
}

function mean(values: number[]): number {
  return fsum(values) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function pstdev(values: number[]): number {
  const c = mean(values);
  let ss = 0;
  for (const v of values) ss += (v - c) * (v - c);
  return Math.sqrt(ss / values.length);
}

/** Counter.most_common(1)[0][0]: highest count, ties broken by first-seen order. */
function mostCommon(values: any[]): any {
  const counts = new Map<any, number>(); // preserves insertion order
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let bestKey: any;
  let bestCount = -Infinity;
  for (const [k, count] of counts) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = k;
    }
  }
  return bestKey;
}

// ── entry transforms ─────────────────────────────────────────────────────────

function effectiveEntry(row: Row): Row {
  const correctedName = row.corrected_name;
  const correctedKey = row.corrected_player_key;
  const e: Row = { ...row };
  delete e.corrected_name;
  delete e.corrected_player_key;
  if (correctedName && correctedKey) {
    e.raw_player_name = e.player_name;
    e.raw_player_key = e.player_key;
    e.player_name = correctedName;
    e.player_key = correctedKey;
    e.name_corrected = true;
  } else {
    e.raw_player_name = null;
    e.raw_player_key = null;
    e.name_corrected = false;
  }
  return e;
}

function appendGroupedEntry(entries: Row[], entry: Row): void {
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].source_id === entry.source_id) {
      if (Number(entry.rank) < Number(entries[i].rank)) entries[i] = entry;
      return;
    }
  }
  entries.push(entry);
}

// ── summaries ────────────────────────────────────────────────────────────────

function summarizeRankEntries(playerKey: string, entries: Row[], sourceLengths: Map<string, number>): Row {
  const ranks = entries.map((e) => Number(e.rank));
  const normalized = entries.map((e) => {
    const len = sourceLengths.has(e.source_id) ? sourceLengths.get(e.source_id)! : Number(e.rank);
    return Number(e.rank) / Math.max(1, len);
  });
  return {
    player_key: playerKey,
    avg_rank: pyRound(mean(ranks), 1),
    median_rank: pyRound(median(ranks), 1),
    best_rank: Math.min(...ranks),
    worst_rank: Math.max(...ranks),
    rank_spread: Math.max(...ranks) - Math.min(...ranks),
    source_count: entries.length,
    rank_stddev: ranks.length > 1 ? pyRound(pstdev(ranks), 1) : 0,
    avg_percentile: pyRound(mean(normalized), 4),
  };
}

function displayFields(playerKey: string, entries: Row[], includeSourceRanks = true): Row {
  const names = entries.map((e) => e.player_name);
  const teams = entries.filter((e) => e.team).map((e) => e.team);
  const positions = entries.filter((e) => e.positions).map((e) => e.positions);
  const ages = entries.filter((e) => e.age !== null && e.age !== undefined).map((e) => Number(e.age));
  const fields: Row = {
    player_key: playerKey,
    player_name: mostCommon(names),
    team: teams.length ? mostCommon(teams) : null,
    positions: positions.length ? mostCommon(positions) : null,
    age: ages.length ? pyRound(median(ages), 1) : null,
  };
  if (includeSourceRanks) {
    const sourceRanks: Row = {};
    for (const e of entries) {
      sourceRanks[e.source_id] = {
        rank: Number(e.rank),
        team: e.team,
        positions: e.positions,
        player_name: e.player_name,
        raw_player_name: e.raw_player_name ?? null,
        name_corrected: Boolean(e.name_corrected),
      };
    }
    fields.source_ranks = sourceRanks;
  }
  return fields;
}

// ── tag ordering + sort ──────────────────────────────────────────────────────

function orderedTags(tags: Set<string>): string[] {
  const known = SOURCE_TAGS.filter((t) => tags.has(t));
  const extra = [...tags].filter((t) => !SOURCE_TAGS.includes(t as any)).sort();
  return [...known, ...extra];
}

function rankSortCompare(a: Row, b: Row): number {
  if (a.avg_rank !== b.avg_rank) return a.avg_rank - b.avg_rank;
  if (a.avg_percentile !== b.avg_percentile) return a.avg_percentile - b.avg_percentile;
  if (a.source_count !== b.source_count) return b.source_count - a.source_count; // -source_count
  return a.player_name < b.player_name ? -1 : a.player_name > b.player_name ? 1 : 0;
}

function buildGroupRankLookup(
  grouped: Map<string, Row[]>,
  sourceLengths: Map<string, number>,
): Map<string, Map<string, Row>> {
  const groupSummaries = new Map<string, Row[]>();
  for (const [playerKey, entries] of grouped) {
    const entriesByTag = new Map<string, Row[]>();
    for (const e of entries) {
      if (!entriesByTag.has(e.source_tag)) entriesByTag.set(e.source_tag, []);
      entriesByTag.get(e.source_tag)!.push(e);
    }
    for (const [tag, tagEntries] of entriesByTag) {
      const summary = summarizeRankEntries(playerKey, tagEntries, sourceLengths);
      Object.assign(summary, displayFields(playerKey, tagEntries, false));
      if (!groupSummaries.has(tag)) groupSummaries.set(tag, []);
      groupSummaries.get(tag)!.push(summary);
    }
  }

  const lookup = new Map<string, Map<string, Row>>();
  for (const [tag, summaries] of groupSummaries) {
    summaries.sort(rankSortCompare);
    const m = new Map<string, Row>();
    summaries.forEach((s, i) => {
      m.set(s.player_key, {
        aggregate_rank: i + 1,
        avg_rank: s.avg_rank,
        median_rank: s.median_rank,
        source_count: s.source_count,
        rank_spread: s.rank_spread,
        avg_percentile: s.avg_percentile,
      });
    });
    lookup.set(tag, m);
  }
  return lookup;
}

function buildSourceGroups(sources: Row[], selectedTags: Set<string>): Row[] {
  const present = new Set<string>(sources.map((s) => s.source_tag));
  const groups: Row[] = [];
  for (const tag of orderedTags(present)) {
    const groupSources = sources.filter((s) => s.source_tag === tag);
    if (!groupSources.length) continue;
    groups.push({
      source_tag: tag,
      source_ids: groupSources.map((s) => s.id),
      source_count: groupSources.length,
      row_count: groupSources.reduce((acc, s) => acc + Number(s.row_count), 0),
      included: selectedTags.has(tag),
    });
  }
  return groups;
}

// ── main ─────────────────────────────────────────────────────────────────────

export function buildAggregateBoard(sources: Row[], entries: Row[], params: BoardParams = {}): Row {
  const selectedTags = params.includedTags != null ? new Set(params.includedTags) : new Set<string>(SOURCE_TAGS);

  if (!sources.length) {
    return { sources: [], source_groups: [], included_source_tags: orderedTags(selectedTags), players: [] };
  }

  const sourceLengths = new Map<string, number>(sources.map((s) => [s.id, Number(s.row_count)]));
  const sourceTags = new Map<string, string>(sources.map((s) => [s.id, s.source_tag]));

  const grouped = new Map<string, Row[]>();
  for (const row of entries) {
    const entry = effectiveEntry(row);
    entry.source_tag = sourceTags.has(entry.source_id) ? sourceTags.get(entry.source_id) : entry.source_tag;
    if (!grouped.has(entry.player_key)) grouped.set(entry.player_key, []);
    appendGroupedEntry(grouped.get(entry.player_key)!, entry);
  }

  const groupRankLookup = buildGroupRankLookup(grouped, sourceLengths);

  const players: Row[] = [];
  for (const [playerKey, groupEntries] of grouped) {
    const rankingEntries = groupEntries.filter((e) => selectedTags.has(e.source_tag));
    if (!rankingEntries.length) continue;
    const player = summarizeRankEntries(playerKey, rankingEntries, sourceLengths);
    Object.assign(player, displayFields(playerKey, groupEntries, true));
    const groupRanks: Row = {};
    for (const [tag, byPlayer] of groupRankLookup) {
      if (byPlayer.has(playerKey)) groupRanks[tag] = byPlayer.get(playerKey);
    }
    player.group_ranks = groupRanks;
    players.push(player);
  }

  players.sort(rankSortCompare);
  players.forEach((p, i) => (p.aggregate_rank = i + 1));

  return {
    sources,
    source_groups: buildSourceGroups(sources, selectedTags),
    included_source_tags: orderedTags(selectedTags),
    players,
  };
}
