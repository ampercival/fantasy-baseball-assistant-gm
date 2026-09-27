import type { FantasyLeague, LeagueValueCurve, PlatformValueCurve } from "./types";

// The salary-rank curve fitted by backend/app/league_value.py and its port in
// supabase/functions/_shared/value-curve.ts. Those fit the parameters; this evaluates them.
// A smooth decline from A (rank 1) toward the floor c, plus an elite bump D that decays at k.

export type ValueCurveParameters = LeagueValueCurve["parameters"];

export const VALUE_CURVE_PARAMETER_NAMES = ["c", "A", "m", "s", "g", "D", "k"] as const;

export const VALUE_CURVE_FORMULA = "value(rank) = c + (A - c) / (1 + (rank / m)^s)^g + D * exp(-k * (rank - 1))";

export function fittedFantasyValue(rank: number, curve: Pick<LeagueValueCurve, "parameters">) {
  const { c, A, m, s, g, D, k } = curve.parameters;
  return c + (A - c) / Math.pow(1 + Math.pow(rank / m, s), g) + D * Math.exp(-k * (rank - 1));
}

// Downloadable league curve. Each refit overwrites the league's row in league_value_curves, so
// this file is how one season's fit survives to be uploaded into a later season's draft tools.
// Bump the version, and teach the parser the old shape, if the contents ever change.
export const LEAGUE_VALUE_CURVE_EXPORT_FORMAT = "fantasy-baseball-assistant-gm/league-value-curve";
export const LEAGUE_VALUE_CURVE_EXPORT_VERSION = 1;

export type LeagueValueCurveExport = {
  format: typeof LEAGUE_VALUE_CURVE_EXPORT_FORMAT;
  format_version: typeof LEAGUE_VALUE_CURVE_EXPORT_VERSION;
  exported_at: string;
  formula: string;
  league: Pick<FantasyLeague, "league_uid" | "league_name" | "url">;
  curve: LeagueValueCurve;
  // The salaried roster ranked the way the fit ranks it, so the curve can be refit if the
  // model changes. Rank 1 is the highest salary.
  fit_points: Array<{ rank: number; salary: number; player_name: string; team_name: string }>;
  platform_curve: Pick<
    PlatformValueCurve,
    "parameters" | "rank_count" | "rmse" | "successful_league_count" | "model_version" | "generated_at"
  > | null;
};

export function buildLeagueValueCurveExport({
  curve,
  exportedAt = new Date().toISOString(),
  fitPoints,
  league,
  platformCurve
}: {
  curve: LeagueValueCurve;
  exportedAt?: string;
  fitPoints: Array<{ rank: number; observedSalary: number; playerName: string; teamName: string }>;
  league: Pick<FantasyLeague, "league_uid" | "league_name" | "url">;
  platformCurve: PlatformValueCurve | null;
}): LeagueValueCurveExport {
  return {
    format: LEAGUE_VALUE_CURVE_EXPORT_FORMAT,
    format_version: LEAGUE_VALUE_CURVE_EXPORT_VERSION,
    exported_at: exportedAt,
    formula: VALUE_CURVE_FORMULA,
    league: { league_uid: league.league_uid, league_name: league.league_name, url: league.url },
    curve: {
      parameters: copyParameters(curve.parameters),
      player_count: curve.player_count,
      rmse: curve.rmse,
      source_snapshot_max_id: curve.source_snapshot_max_id,
      model_version: curve.model_version,
      generated_at: curve.generated_at
    },
    fit_points: fitPoints.map((point) => ({
      rank: point.rank,
      salary: point.observedSalary,
      player_name: point.playerName,
      team_name: point.teamName
    })),
    platform_curve: platformCurve
      ? {
          parameters: copyParameters(platformCurve.parameters),
          rank_count: platformCurve.rank_count,
          rmse: platformCurve.rmse,
          successful_league_count: platformCurve.successful_league_count,
          model_version: platformCurve.model_version,
          generated_at: platformCurve.generated_at
        }
      : null
  };
}

export function leagueValueCurveExportFilename(leagueName: string, generatedAt: string) {
  const slug =
    leagueName
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "league";
  const date = /^\d{4}-\d{2}-\d{2}/.exec(generatedAt)?.[0];
  return `${slug}-value-curve${date ? `-${date}` : ""}.json`;
}

// The upload side: accept a file only if it is this export and its parameters can be evaluated.
export function parseLeagueValueCurveExport(text: string): LeagueValueCurveExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!isRecord(data) || data.format !== LEAGUE_VALUE_CURVE_EXPORT_FORMAT) {
    throw new Error("This file is not a league value curve export.");
  }
  if (data.format_version !== LEAGUE_VALUE_CURVE_EXPORT_VERSION) {
    throw new Error(`Unsupported league value curve export version: ${String(data.format_version)}.`);
  }
  if (!isRecord(data.curve) || !hasCurveParameters(data.curve.parameters)) {
    throw new Error("The league curve's fitted parameters are missing or not numbers.");
  }
  if (data.platform_curve !== null && !(isRecord(data.platform_curve) && hasCurveParameters(data.platform_curve.parameters))) {
    throw new Error("The platform curve's fitted parameters are missing or not numbers.");
  }
  return data as LeagueValueCurveExport;
}

function copyParameters(parameters: ValueCurveParameters): ValueCurveParameters {
  const { c, A, m, s, g, D, k } = parameters;
  return { c, A, m, s, g, D, k };
}

function hasCurveParameters(value: unknown): value is ValueCurveParameters {
  return isRecord(value) && VALUE_CURVE_PARAMETER_NAMES.every((name) => Number.isFinite(value[name]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
