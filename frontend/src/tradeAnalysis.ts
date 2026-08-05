import type { SourceTag } from "./types";

export type TradeAvailabilityCode = "il" | "minors" | "susp";

export type TradeSourceValue = {
  sourceId: string;
  sourceName: string;
  shortName: string;
  sourceTag: SourceTag;
  sourceDate: string | null;
  rank: number;
  value: number;
};

export type TradePlayerRow = {
  player_key: string;
  player_name: string;
  positions: string | null;
  status: string | null;
  ownerTeamName: string | null;
  ownerTeamUid: string | null;
  mlbTeam: string | null;
  section: "hitter" | "pitcher";
  age: number | null;
  salary: number | null;
  availabilityCodes: TradeAvailabilityCode[];
  seasonPoints: number | null;
  pointsPerGame: number | null;
  pointsPerIp: number | null;
  aggregate_rank: number | null;
  scoringRank: number | null;
  value: number | null;
  scoredValue: number | null;
  sourceValues: TradeSourceValue[];
};

export type TradeValueRange = {
  minValue: number | null;
  maxValue: number | null;
  spread: number | null;
};

export type TradeTotal = {
  cash: number;
  count: number;
  dropCount: number;
  salary: number;
  unknownSalaryCount: number;
  salaryDelta: number | null;
  scoredSalaryDelta: number | null;
  scoredValue: number;
  value: number;
  minValue: number;
  maxValue: number;
};

export type TradeResultWinner = "Even" | "Side A" | "Side B";

export type TradeResult = {
  badge: string;
  close: boolean;
  copy: string;
  label: string;
  winner: TradeResultWinner;
  sideABandLeft: number;
  sideABandWidth: number;
  sideAPoint: number;
  sideBBandLeft: number;
  sideBBandWidth: number;
  sideBPoint: number;
};

export function tradePlayerValueRange(
  row: Pick<TradePlayerRow, "sourceValues" | "value">
): TradeValueRange {
  const values = row.sourceValues
    .map((sourceValue) => sourceValue.value)
    .filter((value) => Number.isFinite(value));
  if (values.length) {
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    return { minValue, maxValue, spread: maxValue - minValue };
  }
  if (typeof row.value === "number" && Number.isFinite(row.value)) {
    return { minValue: row.value, maxValue: row.value, spread: 0 };
  }
  return { minValue: null, maxValue: null, spread: null };
}
