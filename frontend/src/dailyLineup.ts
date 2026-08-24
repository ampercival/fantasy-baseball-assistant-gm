import { LINEUP_SLOTS, expandedPositionTokens, type LineupAssignment, type LineupOptimizerResult, type LineupSlot } from "./optimalLineup";
import type {
  LineupMatchupCode,
  LineupRecommendationGame,
  LineupRecommendationRow,
  LineupXfipConfidence,
  LineupXfipProvenance
} from "./types";

type DailyLineupPlayer = {
  eligibleSlotIndexes: number[];
  index: number;
  locked: boolean;
  points: number;
  row: LineupRecommendationRow;
};

type AssignmentState = {
  assignedLockedCount: number;
  assignedPlayerIndexes: number[];
  mask: bigint;
  points: number;
  starterCount: number;
};

export type DailyLineupOptimizerResult = LineupOptimizerResult & {
  lockWarning: string;
  missingSlotWarning: string;
  projectionWarning: string;
};

export function lineupPointsAdjustment(xfipMinus: number | null | undefined, factor: number = 1) {
  const baseline = typeof xfipMinus === "number" && Number.isFinite(xfipMinus) ? xfipMinus : 100;
  return (100 + (baseline - 100) * factor) / 100;
}

/**
 * The Edge response now supplies every game. The scalar fallback keeps a newly deployed
 * client safe while an older cached/function response is still in flight.
 */
export function lineupGames(row: LineupRecommendationRow): LineupRecommendationGame[] {
  if (Array.isArray(row.games) && row.games.length) return row.games.map(normalizeLineupGame);
  if (!row.opponent_team) return [];
  return [
    {
      game_key: `${row.mlb_team || "team"}-1`,
      game_number: 1,
      opponent_team: row.opponent_team,
      opponent_name: row.opponent_name,
      opposing_pitcher_key: row.opposing_pitcher_key,
      opposing_pitcher_name: row.opposing_pitcher_name,
      opposing_pitcher_xfip_minus: row.opposing_pitcher_xfip_minus,
      opposing_pitcher_xfip_provenance:
        row.opposing_pitcher_xfip_provenance ||
        (typeof row.opposing_pitcher_xfip_minus === "number" ? "saved-reference" : "missing"),
      opposing_pitcher_xfip_confidence:
        row.opposing_pitcher_xfip_confidence ||
        (typeof row.opposing_pitcher_xfip_minus === "number" ? "high" : "missing"),
      opposing_pitcher_xfip_source: row.opposing_pitcher_xfip_source || null
    }
  ];
}

function normalizeLineupGame(game: LineupRecommendationGame): LineupRecommendationGame {
  const hasXfip = typeof game.opposing_pitcher_xfip_minus === "number" &&
    Number.isFinite(game.opposing_pitcher_xfip_minus);
  return {
    ...game,
    opposing_pitcher_xfip_provenance:
      game.opposing_pitcher_xfip_provenance || (hasXfip ? "saved-reference" : "missing"),
    opposing_pitcher_xfip_confidence:
      game.opposing_pitcher_xfip_confidence || (hasXfip ? "high" : "missing"),
    opposing_pitcher_xfip_source: game.opposing_pitcher_xfip_source || null
  };
}

export function lineupRowPlaysToday(row: LineupRecommendationRow) {
  if (!hasSingleMlbTeam(row.mlb_team)) return false;
  const explicit = (row as LineupRecommendationRow & { plays_today?: boolean }).plays_today;
  return typeof explicit === "boolean" ? explicit : lineupGames(row).length > 0;
}

export function estimatedLineupPoints(row: LineupRecommendationRow, factor: number = 1) {
  if (typeof row.points_per_game !== "number" || !Number.isFinite(row.points_per_game)) return null;
  if (!lineupRowPlaysToday(row)) return null;
  const games = lineupGames(row);
  if (!games.length) return null;
  return games.reduce(
    (total, game) => total + row.points_per_game! * lineupPointsAdjustment(game.opposing_pitcher_xfip_minus, factor),
    0
  );
}

export function matchupAssessmentForLineupRow(
  row: LineupRecommendationRow
): { code: LineupMatchupCode; label: string } {
  if (!hasSingleMlbTeam(row.mlb_team)) return { code: "no-game", label: "No game" };
  const games = lineupGames(row);
  if (!lineupRowPlaysToday(row) || !games.length) return { code: "no-game", label: "No game" };
  if (games.some((game) => !game.opposing_pitcher_name)) return { code: "no-probable", label: "No probable" };
  const xfipValues = games.map((game) => game.opposing_pitcher_xfip_minus);
  if (xfipValues.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    return { code: "no-xfip", label: "No xFIP-" };
  }
  const averageXfip = (xfipValues as number[]).reduce((total, value) => total + value, 0) / xfipValues.length;
  if (averageXfip < 90) return { code: "tough", label: "Tough" };
  if (averageXfip > 110) return { code: "favorable", label: "Favorable" };
  return { code: "neutral", label: "Neutral" };
}

export function lineupXfipProvenanceLabel(
  provenance: LineupXfipProvenance | null | undefined,
  value?: number | null
) {
  if (provenance === "home-worker-cache") return "Cache";
  if (provenance === "live-fangraphs") return "Live";
  if (provenance === "saved-reference" || (!provenance && typeof value === "number" && Number.isFinite(value))) {
    return "Saved";
  }
  return "Missing";
}

export function lineupXfipConfidenceLabel(confidence: LineupXfipConfidence | null | undefined) {
  if (confidence === "high") return "High";
  if (confidence === "medium") return "Medium";
  if (confidence === "low") return "Low";
  return "Missing";
}

export function lineupCacheAgeHours(fetchedAt: string | null | undefined, now: Date = new Date()) {
  if (!fetchedAt) return null;
  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) return null;
  return Math.max(0, (now.getTime() - fetchedAtMs) / 3_600_000);
}

export function formatLineupCacheAge(ageHours: number | null | undefined) {
  if (typeof ageHours !== "number" || !Number.isFinite(ageHours)) return "age unknown";
  const normalizedHours = Math.max(0, ageHours);
  if (normalizedHours < 1) return `${Math.round(normalizedHours * 60)}m old`;
  if (normalizedHours < 48) return `${normalizedHours.toLocaleString(undefined, { maximumFractionDigits: 1 })}h old`;
  return `${(normalizedHours / 24).toLocaleString(undefined, { maximumFractionDigits: 1 })}d old`;
}

export function optimizeLineup(rows: LineupRecommendationRow[], factor: number = 1): DailyLineupOptimizerResult {
  const players: DailyLineupPlayer[] = rows.map((row, index) => {
    const points = estimatedLineupPoints(row, factor);
    const canStart = lineupRowPlaysToday(row) && !row.always_sit && points !== null;
    return {
      eligibleSlotIndexes: !canStart
        ? []
        : LINEUP_SLOTS.map((slot, slotIndex) => (lineupSlotEligible(row, slot) ? slotIndex : -1)).filter(
            (slotIndex) => slotIndex >= 0
          ),
      index,
      locked: canStart && row.always_start,
      points: points ?? 0,
      row
    };
  });
  const result = solveLineupAssignment(players);
  const assignments = new Map<string, LineupAssignment>();
  let totalPoints = 0;

  if (result) {
    result.assignedPlayerIndexes.forEach((playerIndex, slotIndex) => {
      if (playerIndex < 0) return;
      const player = players[playerIndex];
      if (!player) return;
      assignments.set(player.row.player_key, {
        label: LINEUP_SLOTS[slotIndex].label,
        slotIndex
      });
      totalPoints += player.points;
    });
  }

  const unassignedLocked = rows.filter((row) => row.always_start && !row.always_sit && !assignments.has(row.player_key));
  const missingProjection = rows.filter(
    (row) =>
      lineupRowPlaysToday(row) &&
      !row.always_sit &&
      (typeof row.points_per_game !== "number" || !Number.isFinite(row.points_per_game))
  );
  const assignedSlotIndexes = new Set([...assignments.values()].map((assignment) => assignment.slotIndex));
  const missingSlots = LINEUP_SLOTS.filter((_, slotIndex) => !assignedSlotIndexes.has(slotIndex));
  const missingSlotWarning = missingSlots.length
    ? `Lineup incomplete: ${missingSlots.length} of ${LINEUP_SLOTS.length} lineup ${missingSlots.length === 1 ? "slot is" : "slots are"} unfilled (${formatMissingSlotLabels(missingSlots)}). ` +
      "The available eligible hitters cannot fill every slot for this date."
    : "";
  const lockWarning = unassignedLocked.length
    ? `Locked players could not all be assigned: ${unassignedLocked.map((row) => row.player_name).join(", ")}. ` +
      "The largest compatible lock set was preserved in the best valid lineup."
    : "";
  const projectionWarning = missingProjection.length
    ? `Excluded players with no P/G projection: ${missingProjection.map((row) => row.player_name).join(", ")}.`
    : "";
  const warnings = [missingSlotWarning, lockWarning, projectionWarning].filter(Boolean);

  return {
    assignments,
    lockWarning,
    lockedCount: rows.filter((row) => row.always_start && !row.always_sit).length,
    missingSlotWarning,
    projectionWarning,
    starterCount: assignments.size,
    totalPoints,
    warning: warnings.join(" ")
  };
}

function formatMissingSlotLabels(slots: readonly LineupSlot[]) {
  const counts = new Map<string, number>();
  slots.forEach((slot) => counts.set(slot.label, (counts.get(slot.label) || 0) + 1));
  return [...counts.entries()]
    .map(([label, count]) => (count === 1 ? label : `${label} x${count}`))
    .join(", ");
}

function solveLineupAssignment(players: DailyLineupPlayer[]): AssignmentState | null {
  let states = new Map<bigint, AssignmentState>([
    [
      0n,
      {
        assignedLockedCount: 0,
        assignedPlayerIndexes: [],
        mask: 0n,
        points: 0,
        starterCount: 0
      }
    ]
  ]);

  for (let slotIndex = 0; slotIndex < LINEUP_SLOTS.length; slotIndex += 1) {
    const nextStates = new Map<bigint, AssignmentState>();
    const slotCandidates = players.filter((player) => player.eligibleSlotIndexes.includes(slotIndex));
    for (const state of states.values()) {
      saveAssignmentState(nextStates, {
        ...state,
        assignedPlayerIndexes: [...state.assignedPlayerIndexes, -1]
      });

      for (const player of slotCandidates) {
        const bit = 1n << BigInt(player.index);
        if ((state.mask & bit) !== 0n) continue;
        saveAssignmentState(nextStates, {
          assignedLockedCount: state.assignedLockedCount + (player.locked ? 1 : 0),
          assignedPlayerIndexes: [...state.assignedPlayerIndexes, player.index],
          mask: state.mask | bit,
          points: state.points + player.points,
          starterCount: state.starterCount + 1
        });
      }
    }
    states = nextStates;
  }

  let best: AssignmentState | null = null;
  for (const state of states.values()) {
    if (!best || betterLineupState(state, best)) best = state;
  }
  return best;
}

function saveAssignmentState(states: Map<bigint, AssignmentState>, state: AssignmentState) {
  const existing = states.get(state.mask);
  if (!existing || betterLineupState(state, existing)) states.set(state.mask, state);
}

function betterLineupState(candidate: AssignmentState, incumbent: AssignmentState) {
  if (candidate.assignedLockedCount !== incumbent.assignedLockedCount) {
    return candidate.assignedLockedCount > incumbent.assignedLockedCount;
  }
  const pointDifference = candidate.points - incumbent.points;
  if (Math.abs(pointDifference) > 0.000001) return pointDifference > 0;
  return candidate.starterCount > incumbent.starterCount;
}

function lineupSlotEligible(row: Pick<LineupRecommendationRow, "positions">, slot: LineupSlot) {
  return expandedPositionTokens(row.positions).has(slot.token);
}

function hasSingleMlbTeam(value: string | null | undefined) {
  return Boolean(value && value.trim().split(/\s+/).length === 1);
}
