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

export type TradeMetricTotal = {
  cashValue: number;
  complete: boolean;
  knownPlayerValue: number;
  knownTotal: number;
  missingCount: number;
  notApplicableCount: number;
};

export type TradeTotal = {
  ageCount: number;
  ageSum: number;
  cash: number;
  count: number;
  hitterCount: number;
  ilCount: number;
  milbCount: number;
  pitcherCount: number;
  salary: number;
  seasonPoints: number;
  suspendedCount: number;
  unknownSeasonPointsCount: number;
  unknownSalaryCount: number;
  dynasty: TradeMetricTotal;
  scoring: TradeMetricTotal;
  dynastySurplus: TradeMetricTotal;
  scoringSurplus: TradeMetricTotal;
  minValue: number;
  maxValue: number;
};

export type TradeRosterImpact = {
  capLimitChange: number;
  knownSalaryChange: number;
  rosterCountChange: number;
  salaryChange: number | null;
  unknownSalaryCount: number;
};

export type TradeSourceNet = Omit<TradeSourceValue, "rank" | "value"> & {
  coveredPlayerCount: number;
  fullCoverage: boolean;
  netValue: number;
  substitutedPlayerCount: number;
  totalPlayerCount: number;
};

export type TradeSourceNetRange = {
  crossesZero: boolean;
  fullCoverageNets: TradeSourceNet[];
  maxNet: number | null;
  minNet: number | null;
  partialCoverageNets: TradeSourceNet[];
};

export type TradeResultWinner = "Even" | "Side A" | "Side B" | null;

export type TradeResult = {
  badge: string;
  close: boolean;
  complete: boolean;
  copy: string;
  knownNetToYou: number;
  label: string;
  missingCount: number;
  notApplicableCount: number;
  sourceRangeCrossesZero: boolean;
  threshold: number;
  winner: TradeResultWinner;
  sideABandLeft: number;
  sideABandWidth: number;
  sideAPoint: number;
  sideBBandLeft: number;
  sideBBandWidth: number;
  sideBPoint: number;
};

export type TradeAnalysisInput = {
  cashReceived: number;
  cashSent: number;
  myDrops: TradePlayerRow[];
  opponentDrops: TradePlayerRow[];
  playersGiven: TradePlayerRow[];
  playersReceived: TradePlayerRow[];
};

export type TradeAnalysis = {
  dynastyResult: TradeResult;
  dynastySourceNetRange: TradeSourceNetRange;
  given: TradeTotal;
  myRosterImpact: TradeRosterImpact;
  opponentRosterImpact: TradeRosterImpact;
  received: TradeTotal;
  scoringResult: TradeResult;
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

export function analyzeTrade(input: TradeAnalysisInput): TradeAnalysis {
  const given = buildTradeTotal(input.playersGiven, input.cashSent);
  const received = buildTradeTotal(input.playersReceived, input.cashReceived);
  const dynastySourceNetRange = buildSourceNetRange(
    input.playersGiven,
    input.playersReceived,
    input.cashSent,
    input.cashReceived
  );
  return {
    dynastyResult: compareTradeMetrics(
      "Dynasty",
      given.dynasty,
      received.dynasty,
      { minValue: given.minValue, maxValue: given.maxValue },
      { minValue: received.minValue, maxValue: received.maxValue },
      dynastySourceNetRange
    ),
    dynastySourceNetRange,
    given,
    myRosterImpact: buildRosterImpact(
      input.playersGiven,
      input.playersReceived,
      input.myDrops,
      input.cashSent,
      input.cashReceived
    ),
    opponentRosterImpact: buildRosterImpact(
      input.playersReceived,
      input.playersGiven,
      input.opponentDrops,
      input.cashReceived,
      input.cashSent
    ),
    received,
    scoringResult: compareTradeMetrics("Scoring", given.scoring, received.scoring)
  };
}

export function buildTradeTotal(rows: TradePlayerRow[], cash: number = 0): TradeTotal {
  const dynasty = buildMetricTotal(rows, "dynasty", cash, false);
  const scoring = buildMetricTotal(rows, "scoring", cash, false);
  let ageCount = 0;
  let ageSum = 0;
  let minValue = cash;
  let maxValue = cash;
  let salary = 0;
  let seasonPoints = 0;
  let unknownSeasonPointsCount = 0;
  let unknownSalaryCount = 0;
  for (const row of rows) {
    const range = tradePlayerValueRange(row);
    if (typeof range.minValue === "number") minValue += range.minValue;
    if (typeof range.maxValue === "number") maxValue += range.maxValue;
    if (typeof row.salary === "number") salary += row.salary;
    else unknownSalaryCount += 1;
    if (typeof row.seasonPoints === "number" && Number.isFinite(row.seasonPoints)) seasonPoints += row.seasonPoints;
    else unknownSeasonPointsCount += 1;
    if (typeof row.age === "number" && Number.isFinite(row.age)) {
      ageCount += 1;
      ageSum += row.age;
    }
  }
  return {
    ageCount,
    ageSum,
    cash,
    count: rows.length,
    hitterCount: rows.filter((row) => row.section === "hitter").length,
    ilCount: rows.filter((row) => row.availabilityCodes.includes("il")).length,
    milbCount: rows.filter((row) => row.availabilityCodes.includes("minors")).length,
    pitcherCount: rows.filter((row) => row.section === "pitcher").length,
    salary,
    seasonPoints,
    suspendedCount: rows.filter((row) => row.availabilityCodes.includes("susp")).length,
    unknownSeasonPointsCount,
    unknownSalaryCount,
    dynasty,
    scoring,
    dynastySurplus: buildMetricTotal(rows, "dynasty", 0, true),
    scoringSurplus: buildMetricTotal(rows, "scoring", 0, true),
    minValue,
    maxValue
  };
}

function buildMetricTotal(
  rows: TradePlayerRow[],
  metric: "dynasty" | "scoring",
  cashValue: number,
  subtractSalary: boolean
): TradeMetricTotal {
  let knownPlayerValue = 0;
  let missingCount = 0;
  let notApplicableCount = 0;
  for (const row of rows) {
    const value = metric === "dynasty" ? row.value : row.scoredValue;
    if (metric === "scoring" && typeof value !== "number" && row.availabilityCodes.includes("minors")) {
      notApplicableCount += 1;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || (subtractSalary && typeof row.salary !== "number")) {
      missingCount += 1;
      continue;
    }
    knownPlayerValue += subtractSalary ? value - (row.salary ?? 0) : value;
  }
  return {
    cashValue,
    complete: missingCount === 0,
    knownPlayerValue,
    knownTotal: knownPlayerValue + cashValue,
    missingCount,
    notApplicableCount
  };
}

function buildRosterImpact(
  outgoingRows: TradePlayerRow[],
  incomingRows: TradePlayerRow[],
  dropRows: TradePlayerRow[],
  cashSent: number,
  cashReceived: number
): TradeRosterImpact {
  const relevantRows = [...outgoingRows, ...incomingRows, ...dropRows];
  const unknownSalaryCount = relevantRows.filter((row) => row.salary === null).length;
  const knownSalaryChange =
    sumKnownSalary(incomingRows) - sumKnownSalary(outgoingRows) - sumKnownSalary(dropRows);
  return {
    capLimitChange: cashReceived - cashSent,
    knownSalaryChange,
    rosterCountChange: incomingRows.length - outgoingRows.length - dropRows.length,
    salaryChange: unknownSalaryCount ? null : knownSalaryChange,
    unknownSalaryCount
  };
}

function buildSourceNetRange(
  playersGiven: TradePlayerRow[],
  playersReceived: TradePlayerRow[],
  cashSent: number,
  cashReceived: number
): TradeSourceNetRange {
  const exchangedPlayers = [...playersGiven, ...playersReceived];
  if (!exchangedPlayers.length) {
    return { crossesZero: false, fullCoverageNets: [], maxNet: null, minNet: null, partialCoverageNets: [] };
  }

  const sourceMetadata = new Map<string, TradeSourceValue>();
  for (const row of exchangedPlayers) {
    for (const sourceValue of row.sourceValues) {
      if (!sourceMetadata.has(sourceValue.sourceId)) sourceMetadata.set(sourceValue.sourceId, sourceValue);
    }
  }

  const allNets = [...sourceMetadata.values()].flatMap((metadata): TradeSourceNet[] => {
    const givenEstimate = estimateSourcePackageValue(playersGiven, metadata.sourceId);
    const receivedEstimate = estimateSourcePackageValue(playersReceived, metadata.sourceId);
    if (!givenEstimate.complete || !receivedEstimate.complete) return [];
    const coveredPlayerCount = givenEstimate.coveredPlayerCount + receivedEstimate.coveredPlayerCount;
    const totalPlayerCount = exchangedPlayers.length;
    return [{
      coveredPlayerCount,
      fullCoverage: coveredPlayerCount === totalPlayerCount,
      sourceId: metadata.sourceId,
      sourceName: metadata.sourceName,
      shortName: metadata.shortName,
      sourceTag: metadata.sourceTag,
      sourceDate: metadata.sourceDate,
      netValue: receivedEstimate.value + cashReceived - givenEstimate.value - cashSent,
      substitutedPlayerCount: totalPlayerCount - coveredPlayerCount,
      totalPlayerCount
    }];
  });
  const fullCoverageNets = allNets.filter((source) => source.fullCoverage);
  const partialCoverageNets = allNets.filter((source) => !source.fullCoverage);
  const netValues = fullCoverageNets.map((source) => source.netValue);
  const minNet = netValues.length ? Math.min(...netValues) : null;
  const maxNet = netValues.length ? Math.max(...netValues) : null;
  return {
    crossesZero: minNet !== null && maxNet !== null && minNet <= 0 && maxNet >= 0,
    fullCoverageNets,
    maxNet,
    minNet,
    partialCoverageNets
  };
}

function compareTradeMetrics(
  metricLabel: "Dynasty" | "Scoring",
  given: TradeMetricTotal,
  received: TradeMetricTotal,
  givenRange: Pick<TradeValueRange, "minValue" | "maxValue"> = {
    minValue: given.knownTotal,
    maxValue: given.knownTotal
  },
  receivedRange: Pick<TradeValueRange, "minValue" | "maxValue"> = {
    minValue: received.knownTotal,
    maxValue: received.knownTotal
  },
  sourceNetRange: TradeSourceNetRange = {
    crossesZero: false,
    fullCoverageNets: [],
    maxNet: null,
    minNet: null,
    partialCoverageNets: []
  }
): TradeResult {
  const sideAValue = given.knownTotal;
  const sideBValue = received.knownTotal;
  const knownNetToYou = sideBValue - sideAValue;
  const average = (Math.abs(sideAValue) + Math.abs(sideBValue)) / 2;
  const threshold = Math.max(1, average * 0.05);
  const missingCount = given.missingCount + received.missingCount;
  const notApplicableCount = given.notApplicableCount + received.notApplicableCount;
  const complete = missingCount === 0;
  const valueMax = Math.max(
    sideAValue,
    sideBValue,
    givenRange.maxValue ?? 0,
    receivedRange.maxValue ?? 0,
    1
  );
  const sideAMin = givenRange.minValue ?? sideAValue;
  const sideAMax = givenRange.maxValue ?? sideAValue;
  const sideBMin = receivedRange.minValue ?? sideBValue;
  const sideBMax = receivedRange.maxValue ?? sideBValue;
  const sideABandLeft = percentOfValue(sideAMin, valueMax);
  const sideABandRight = percentOfValue(sideAMax, valueMax);
  const sideBBandLeft = percentOfValue(sideBMin, valueMax);
  const sideBBandRight = percentOfValue(sideBMax, valueMax);
  const exclusionCopy = notApplicableCount
    ? ` ${notApplicableCount} MiLB ${notApplicableCount === 1 ? "player is" : "players are"} excluded from scoring value.`
    : "";

  if (!complete) {
    return {
      badge: `${missingCount} missing ${missingCount === 1 ? "value" : "values"}`,
      close: false,
      complete,
      copy: `${metricLabel} comparison is incomplete: Side A has ${formatKnownValue(sideAValue)} known and Side B has ${formatKnownValue(sideBValue)} known; ${missingCount} exchanged ${missingCount === 1 ? "player is" : "players are"} missing a required value.${exclusionCopy}`,
      knownNetToYou,
      label: `${metricLabel} Incomplete`,
      missingCount,
      notApplicableCount,
      sourceRangeCrossesZero: false,
      threshold,
      winner: null,
      sideABandLeft,
      sideABandWidth: Math.max(1, sideABandRight - sideABandLeft),
      sideAPoint: percentOfValue(sideAValue, valueMax),
      sideBBandLeft,
      sideBBandWidth: Math.max(1, sideBBandRight - sideBBandLeft),
      sideBPoint: percentOfValue(sideBValue, valueMax)
    };
  }

  if (average === 0 && notApplicableCount === 0 && sourceNetRange.fullCoverageNets.length === 0) {
    return {
      badge: "Awaiting package",
      close: true,
      complete,
      copy: "Select players from each side to evaluate the package.",
      knownNetToYou,
      label: "Select Players",
      missingCount,
      notApplicableCount,
      sourceRangeCrossesZero: false,
      threshold,
      winner: "Even",
      sideABandLeft,
      sideABandWidth: Math.max(1, sideABandRight - sideABandLeft),
      sideAPoint: percentOfValue(sideAValue, valueMax),
      sideBBandLeft,
      sideBBandWidth: Math.max(1, sideBBandRight - sideBBandLeft),
      sideBPoint: percentOfValue(sideBValue, valueMax)
    };
  }

  const sourceRangeCrossesZero = metricLabel === "Dynasty" && sourceNetRange.crossesZero;
  const insideThreshold = Math.abs(knownNetToYou) <= threshold;
  const winner: TradeResultWinner = sourceRangeCrossesZero || insideThreshold
    ? "Even"
    : knownNetToYou > 0
      ? "Side A"
      : "Side B";
  const label = winner === "Even" ? "Even Trade" : `${winner} Wins`;
  const margin = average > 0 ? Math.abs(knownNetToYou) / average : 0;
  const badge = sourceRangeCrossesZero
    ? "Full-source range crosses even"
    : insideThreshold
      ? `Within ${formatKnownValue(threshold)} threshold`
      : `${(margin * 100).toFixed(1)}% edge`;
  const copy = sourceRangeCrossesZero
    ? `${metricLabel} midpoint favors ${knownNetToYou >= 0 ? "Side A" : "Side B"}, but full-coverage sources cross even. Treat this as effectively even.${exclusionCopy}`
    : insideThreshold
      ? `${metricLabel} difference is ${formatKnownValue(Math.abs(knownNetToYou))}, inside the ${formatKnownValue(threshold)} materiality threshold. Treat this as effectively even.${exclusionCopy}`
      : `${label} by ${(margin * 100).toFixed(1)}% based on ${metricLabel.toLowerCase()} value.${exclusionCopy}`;
  return {
    badge,
    close: winner === "Even",
    complete,
    copy,
    knownNetToYou,
    label,
    missingCount,
    notApplicableCount,
    sourceRangeCrossesZero,
    threshold,
    winner,
    sideABandLeft,
    sideABandWidth: Math.max(1, sideABandRight - sideABandLeft),
    sideAPoint: percentOfValue(sideAValue, valueMax),
    sideBBandLeft,
    sideBBandWidth: Math.max(1, sideBBandRight - sideBBandLeft),
    sideBPoint: percentOfValue(sideBValue, valueMax)
  };
}

function sumKnownSalary(rows: TradePlayerRow[]) {
  return rows.reduce((total, row) => total + (row.salary ?? 0), 0);
}

function estimateSourcePackageValue(rows: TradePlayerRow[], sourceId: string) {
  let coveredPlayerCount = 0;
  let value = 0;
  for (const row of rows) {
    const sourceValue = row.sourceValues.find((candidate) => candidate.sourceId === sourceId)?.value;
    if (typeof sourceValue === "number" && Number.isFinite(sourceValue)) {
      coveredPlayerCount += 1;
      value += sourceValue;
      continue;
    }
    if (typeof row.value !== "number" || !Number.isFinite(row.value)) {
      return { complete: false, coveredPlayerCount, value };
    }
    value += row.value;
  }
  return { complete: true, coveredPlayerCount, value };
}

function percentOfValue(value: number, maxValue: number) {
  if (maxValue <= 0) return 0;
  return Math.max(0, Math.min(100, (value / maxValue) * 100));
}

function formatKnownValue(value: number) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
}
