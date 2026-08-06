import type { OptimalLineupHitter } from "./types";

const HITTER_POSITION_TOKENS = new Set(["C", "1B", "2B", "3B", "SS", "OF", "LF", "CF", "RF", "DH", "UT", "UTL", "UTIL", "UTI"]);

export const LINEUP_SLOTS = [
  { id: "C1", label: "C", token: "C" },
  { id: "C2", label: "C", token: "C" },
  { id: "1B", label: "1B", token: "1B" },
  { id: "2B", label: "2B", token: "2B" },
  { id: "SS", label: "SS", token: "SS" },
  { id: "MI", label: "MI", token: "MI" },
  { id: "3B", label: "3B", token: "3B" },
  { id: "OF1", label: "OF", token: "OF" },
  { id: "OF2", label: "OF", token: "OF" },
  { id: "OF3", label: "OF", token: "OF" },
  { id: "OF4", label: "OF", token: "OF" },
  { id: "OF5", label: "OF", token: "OF" },
  { id: "UTIL", label: "UTIL", token: "UTI" }
] as const;

const POSITION_STRENGTH_GROUPS = [
  { label: "C", token: "C" },
  { label: "1B", token: "1B" },
  { label: "2B", token: "2B" },
  { label: "SS", token: "SS" },
  { label: "MI", token: "MI" },
  { label: "3B", token: "3B" },
  { label: "OF", token: "OF" },
  { label: "UTIL", token: "UTI" }
] as const;

export type LineupSlot = (typeof LINEUP_SLOTS)[number];

export type LineupAssignment = {
  label: LineupSlot["label"];
  slotIndex: number;
};

export type LineupOptimizerResult = {
  assignments: Map<string, LineupAssignment>;
  lockedCount: number;
  starterCount: number;
  totalPoints: number;
  warning: string;
};

export type OptimalLineupDisplayRow = {
  assignment: LineupAssignment | null;
  row: OptimalLineupHitter;
  score: number | null;
};

export type StrengthTier = "strong" | "solid" | "weak";
export type DepthTier = "strong" | "covered" | "thin";

export type PositionMapPlayerRow = {
  dropoff: number | null;
  entry: OptimalLineupDisplayRow;
  role: "Starter" | "Tandem" | `Depth ${1 | 2 | 3}`;
};

export type PositionStrengthRow = {
  position: string;
  players: PositionMapPlayerRow[];
  starterScore: number | null;
  starterTier: StrengthTier;
  depthScore: number | null;
  depthTier: DepthTier;
};

export function expandedPositionTokens(value: string | null | undefined) {
  const tokens = new Set<string>();
  const normalizedValue = value?.toUpperCase().replace(/C\.I\./g, "CI").replace(/M\.I\./g, "MI") || "";
  for (const rawToken of normalizedValue.match(/[A-Z0-9]+/g) || []) {
    const token = rawToken === "UTIL" || rawToken === "UTL" || rawToken === "UT" ? "UTI" : rawToken;
    tokens.add(token);
  }

  if (tokens.has("LF") || tokens.has("CF") || tokens.has("RF")) {
    tokens.add("OF");
  }
  if (tokens.has("SP") || tokens.has("RP")) {
    tokens.add("P");
  }
  if (tokens.has("1B") || tokens.has("3B") || tokens.has("CI")) {
    tokens.add("CI");
  }
  if (tokens.has("2B") || tokens.has("SS") || tokens.has("MI")) {
    tokens.add("MI");
  }

  const hitterEligible = [...tokens].some((token) => HITTER_POSITION_TOKENS.has(token) || token === "MI" || token === "CI");
  if (hitterEligible) {
    tokens.add("UTI");
  }

  return tokens;
}

export function optimizeBestCaseLineup(rows: OptimalLineupHitter[]): LineupOptimizerResult {
  type FlowEdge = {
    capacity: number;
    cost: number;
    reverseIndex: number;
    slotIndex?: number;
    to: number;
  };
  const source = 0;
  const playerOffset = 1;
  const slotOffset = playerOffset + rows.length;
  const sink = slotOffset + LINEUP_SLOTS.length;
  const graph: FlowEdge[][] = Array.from({ length: sink + 1 }, () => []);

  function addEdge(from: number, to: number, capacity: number, cost: number, slotIndex?: number) {
    const forward: FlowEdge = { capacity, cost, reverseIndex: graph[to].length, slotIndex, to };
    const reverse: FlowEdge = { capacity: 0, cost: -cost, reverseIndex: graph[from].length, to: from };
    graph[from].push(forward);
    graph[to].push(reverse);
  }

  rows.forEach((row, playerIndex) => {
    addEdge(source, playerOffset + playerIndex, 1, 0);
    const ppg = finiteNumber(row.points_per_game) ?? 0;
    const tieBreak = (finiteNumber(row.points) ?? 0) / 1_000_000 + (finiteNumber(row.wrc_plus) ?? 0) / 1_000_000_000;
    LINEUP_SLOTS.forEach((slot, slotIndex) => {
      if (lineupSlotEligible(row, slot)) {
        addEdge(playerOffset + playerIndex, slotOffset + slotIndex, 1, -(ppg + tieBreak), slotIndex);
      }
    });
  });
  LINEUP_SLOTS.forEach((_, slotIndex) => addEdge(slotOffset + slotIndex, sink, 1, 0));

  for (let flow = 0; flow < LINEUP_SLOTS.length; flow += 1) {
    const distances = Array<number>(graph.length).fill(Infinity);
    const previousNode = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    distances[source] = 0;
    for (let pass = 0; pass < graph.length - 1; pass += 1) {
      let changed = false;
      for (let node = 0; node < graph.length; node += 1) {
        if (!Number.isFinite(distances[node])) continue;
        graph[node].forEach((edge, edgeIndex) => {
          if (edge.capacity <= 0) return;
          const nextDistance = distances[node] + edge.cost;
          if (nextDistance + 0.000000001 < distances[edge.to]) {
            distances[edge.to] = nextDistance;
            previousNode[edge.to] = node;
            previousEdge[edge.to] = edgeIndex;
            changed = true;
          }
        });
      }
      if (!changed) break;
    }
    if (previousNode[sink] < 0) break;
    for (let node = sink; node !== source; node = previousNode[node]) {
      const edge = graph[previousNode[node]][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.reverseIndex].capacity += 1;
    }
  }

  const assignments = new Map<string, LineupAssignment>();
  const assignedRows: OptimalLineupDisplayRow[] = [];
  rows.forEach((row, playerIndex) => {
    const usedEdge = graph[playerOffset + playerIndex].find(
      (edge) => edge.slotIndex !== undefined && edge.capacity === 0
    );
    if (usedEdge?.slotIndex === undefined) return;
    assignments.set(row.player_key, {
      label: LINEUP_SLOTS[usedEdge.slotIndex].label,
      slotIndex: usedEdge.slotIndex
    });
    assignedRows.push({
      assignment: {
        label: LINEUP_SLOTS[usedEdge.slotIndex].label,
        slotIndex: usedEdge.slotIndex
      },
      row,
      score: hitterQualityScore(row)
    });
  });
  const totalPoints = bestCaseLineupRate(assignedRows);

  return {
    assignments,
    lockedCount: 0,
    starterCount: assignments.size,
    totalPoints,
    warning:
      assignments.size < LINEUP_SLOTS.length
        ? `${LINEUP_SLOTS.length - assignments.size} lineup ${LINEUP_SLOTS.length - assignments.size === 1 ? "slot is" : "slots are"} unfilled because no eligible MLB hitter is available.`
        : ""
  };
}

export function buildOptimalLineupDisplayRows(
  rows: OptimalLineupHitter[],
  optimizer: LineupOptimizerResult
): OptimalLineupDisplayRow[] {
  return rows
    .map((row) => ({
      assignment: optimizer.assignments.get(row.player_key) || null,
      row,
      score: hitterQualityScore(row)
    }))
    .sort((left, right) => {
      if (left.assignment && right.assignment) {
        return left.assignment.slotIndex - right.assignment.slotIndex || left.row.player_name.localeCompare(right.row.player_name);
      }
      if (left.assignment) return -1;
      if (right.assignment) return 1;
      return (
        (right.score ?? -Infinity) - (left.score ?? -Infinity) ||
        (right.row.points_per_game ?? -Infinity) - (left.row.points_per_game ?? -Infinity) ||
        left.row.player_name.localeCompare(right.row.player_name)
      );
    });
}

export function buildPositionStrengthRows(
  starters: OptimalLineupDisplayRow[],
  bench: OptimalLineupDisplayRow[]
): PositionStrengthRow[] {
  return POSITION_STRENGTH_GROUPS.map((group) => {
    const positionStarters = starters.filter((entry) => entry.assignment?.label === group.label);
    const catcherTandem = group.token === "C"
      ? [...positionStarters].sort(compareOptimalHitterQuality)
      : [];
    const backupCandidates = bench
      .filter((entry) => expandedPositionTokens(entry.row.positions).has(group.token))
      .sort(compareOptimalHitterQuality);
    const backupEntry = group.token === "C" ? catcherTandem[1] || null : backupCandidates[0] || null;
    const starterPpg = group.token === "C"
      ? catcherTandemMetric(positionStarters, (entry) => entry.row.points_per_game)
      : averageMetric(positionStarters.map((entry) => entry.row.points_per_game));
    const starterWrcPlus = group.token === "C"
      ? catcherTandemMetric(positionStarters, (entry) => entry.row.wrc_plus)
      : averageMetric(positionStarters.map((entry) => entry.row.wrc_plus));
    const starterScore = group.token === "C"
      ? hitterQualityScore({ points_per_game: starterPpg, wrc_plus: starterWrcPlus })
      : averageMetric(positionStarters.map((entry) => entry.score));
    const starterPpgValues = positionStarters
      .map((entry) => finiteNumber(entry.row.points_per_game))
      .filter((value): value is number => value !== null);
    const weakestStarterPpg = group.token === "C"
      ? finiteNumber(catcherTandem[0]?.row.points_per_game)
      : starterPpgValues.length ? Math.min(...starterPpgValues) : null;
    const backupPpg = finiteNumber(backupEntry?.row.points_per_game);
    const backupDropoff =
      weakestStarterPpg !== null && backupPpg !== null ? weakestStarterPpg - backupPpg : null;
    const backupScore = backupEntry?.score ?? null;
    const depthScore =
      backupScore === null ? null : clampNumber(backupScore - Math.max(backupDropoff ?? 0, 0) * 12, 0, 100);
    const orderedStarters = group.token === "C"
      ? catcherTandem
      : [...positionStarters].sort(compareOptimalHitterQuality);
    const depthBaselinePpg = group.token === "C"
      ? finiteNumber(catcherTandem[catcherTandem.length - 1]?.row.points_per_game)
      : weakestStarterPpg;
    const playerRows: PositionMapPlayerRow[] = [
      ...orderedStarters.map((entry, index): PositionMapPlayerRow => ({
        dropoff: null,
        entry,
        role: group.token === "C" && index === 1 ? "Tandem" : "Starter"
      })),
      ...backupCandidates.slice(0, 3).map((entry, index): PositionMapPlayerRow => {
        const entryPpg = finiteNumber(entry.row.points_per_game);
        return {
          dropoff: depthBaselinePpg !== null && entryPpg !== null ? depthBaselinePpg - entryPpg : null,
          entry,
          role: `Depth ${index + 1}` as `Depth ${1 | 2 | 3}`
        };
      })
    ];
    return {
      position: group.label,
      players: playerRows,
      starterScore,
      starterTier:
        group.token === "C" && positionStarters.length < 2
          ? "weak"
          : positionStarters.length ? strengthTier(starterScore) : "weak",
      depthScore,
      depthTier: depthTier(backupEntry?.row || null, depthScore)
    };
  });
}

function compareOptimalHitterQuality(left: OptimalLineupDisplayRow, right: OptimalLineupDisplayRow) {
  return (
    (right.row.points_per_game ?? -Infinity) - (left.row.points_per_game ?? -Infinity) ||
    (right.score ?? -Infinity) - (left.score ?? -Infinity) ||
    left.row.player_name.localeCompare(right.row.player_name)
  );
}

function catcherTandemMetric(
  catchers: OptimalLineupDisplayRow[],
  getter: (entry: OptimalLineupDisplayRow) => number | null | undefined
) {
  const weighted = catchers
    .map((entry) => ({
      games: finiteNumber(entry.row.games),
      value: finiteNumber(getter(entry))
    }))
    .filter((entry): entry is { games: number; value: number } => entry.games !== null && entry.value !== null);
  const totalGames = sumMetric(weighted.map((entry) => entry.games));
  if (totalGames > 0) {
    return weighted.reduce((total, entry) => total + entry.value * entry.games, 0) / totalGames;
  }
  return averageMetric(catchers.map(getter));
}

function catcherTandemSeasonPoints(
  catchers: OptimalLineupDisplayRow[],
  referenceGames: number | null
) {
  const combinedPoints = sumMetric(catchers.map((entry) => entry.row.points));
  const combinedGames = sumMetric(catchers.map((entry) => entry.row.games));
  if (combinedGames <= 0 || referenceGames === null || combinedGames <= referenceGames) return combinedPoints;
  return combinedPoints * (referenceGames / combinedGames);
}

function bestCaseLineupRate(starters: OptimalLineupDisplayRow[]) {
  const catcherRows = starters.filter((entry) => entry.assignment?.label === "C");
  const nonCatcherTotal = sumMetric(
    starters
      .filter((entry) => entry.assignment?.label !== "C")
      .map((entry) => entry.row.points_per_game)
  );
  return nonCatcherTotal + (catcherTandemMetric(catcherRows, (entry) => entry.row.points_per_game) ?? 0);
}

export function bestCaseLineupSeasonPoints(starters: OptimalLineupDisplayRow[]) {
  const catcherRows = starters.filter((entry) => entry.assignment?.label === "C");
  const nonCatcherRows = starters.filter((entry) => entry.assignment?.label !== "C");
  const referenceGames = maximumMetric(nonCatcherRows.map((entry) => entry.row.games));
  return (
    sumMetric(nonCatcherRows.map((entry) => entry.row.points)) +
    catcherTandemSeasonPoints(catcherRows, referenceGames)
  );
}

export function bestCaseLineupAverageMetric(
  starters: OptimalLineupDisplayRow[],
  getter: (entry: OptimalLineupDisplayRow) => number | null | undefined
) {
  const catcherRows = starters.filter((entry) => entry.assignment?.label === "C");
  const positionValues = starters
    .filter((entry) => entry.assignment?.label !== "C")
    .map(getter);
  positionValues.push(catcherTandemMetric(catcherRows, getter));
  return averageMetric(positionValues);
}

function hitterQualityScore(row: Pick<OptimalLineupHitter, "points_per_game" | "wrc_plus">): number | null {
  const scores: number[] = [];
  const ppg = finiteNumber(row.points_per_game);
  const wrcPlus = finiteNumber(row.wrc_plus);
  if (ppg !== null) scores.push(clampNumber(50 + (ppg - 4.5) * 20, 0, 100));
  if (wrcPlus !== null) scores.push(clampNumber(50 + (wrcPlus - 100) * 0.7, 0, 100));
  return averageMetric(scores);
}

export function strengthTier(score: number | null | undefined): StrengthTier {
  if (typeof score !== "number" || !Number.isFinite(score)) return "weak";
  if (score >= 65) return "strong";
  if (score < 40) return "weak";
  return "solid";
}

export function strengthTierLabel(tier: StrengthTier) {
  return tier === "strong" ? "Strong" : tier === "weak" ? "Weak" : "Solid";
}

function depthTier(
  backup: OptimalLineupHitter | null,
  depthScore: number | null
): DepthTier {
  if (!backup) return "thin";
  if ((depthScore ?? -Infinity) >= 52) return "strong";
  if ((depthScore ?? -Infinity) >= 38) return "covered";
  return "thin";
}

export function depthTierLabel(tier: DepthTier) {
  return tier === "strong" ? "Strong" : tier === "covered" ? "Covered" : "Thin";
}

export function depthTone(tier: DepthTier): StrengthTier {
  return tier === "strong" ? "strong" : tier === "covered" ? "solid" : "weak";
}

export function bestPositionBy(
  rows: PositionStrengthRow[],
  getter: (row: PositionStrengthRow) => number | null,
  direction: "min" | "max"
) {
  return rows.reduce<PositionStrengthRow | null>((best, row) => {
    const value = getter(row);
    if (!best) return row;
    const bestValue = getter(best);
    if (direction === "max") {
      if (value === null) return best;
      if (bestValue === null || value > bestValue) return row;
      return best;
    }
    const comparableValue = value ?? -Infinity;
    const comparableBest = bestValue ?? -Infinity;
    return comparableValue < comparableBest ? row : best;
  }, null);
}

export function averageMetric(values: (number | null | undefined)[]) {
  const finiteValues = values
    .map((value) => finiteNumber(value))
    .filter((value): value is number => value !== null);
  return finiteValues.length ? finiteValues.reduce((total, value) => total + value, 0) / finiteValues.length : null;
}

function maximumMetric(values: (number | null | undefined)[]) {
  const finiteValues = values
    .map((value) => finiteNumber(value))
    .filter((value): value is number => value !== null);
  return finiteValues.length ? Math.max(...finiteValues) : null;
}

function sumMetric(values: (number | null | undefined)[]) {
  return values.reduce<number>((total, value) => total + (finiteNumber(value) ?? 0), 0);
}

function finiteNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampNumber(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function lineupSlotEligible(row: Pick<OptimalLineupHitter, "positions">, slot: LineupSlot) {
  return expandedPositionTokens(row.positions).has(slot.token);
}
