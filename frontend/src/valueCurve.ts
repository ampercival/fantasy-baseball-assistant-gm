import type { FantasyLeague, LeagueValueCurve, PlatformSampledLeague, PlatformValueCurve, PlatformValueCurvePoint } from "./types";

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

// Downloadable curves. Every refit replaces the stored league or platform curve, so these files
// are how one season's fit survives to be uploaded into a later season's draft tools. Both
// formats keep the fitted parameters at curve.parameters. Bump a version, and teach the parser
// the old shape, if its contents ever change.
export const LEAGUE_VALUE_CURVE_EXPORT_FORMAT = "fantasy-baseball-assistant-gm/league-value-curve";
export const LEAGUE_VALUE_CURVE_EXPORT_VERSION = 1;
export const PLATFORM_VALUE_CURVE_EXPORT_FORMAT = "fantasy-baseball-assistant-gm/platform-value-curve";
export const PLATFORM_VALUE_CURVE_EXPORT_VERSION = 1;

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

export type PlatformValueCurveExport = {
  format: typeof PLATFORM_VALUE_CURVE_EXPORT_FORMAT;
  format_version: typeof PLATFORM_VALUE_CURVE_EXPORT_VERSION;
  exported_at: string;
  formula: string;
  platform: "ottoneu";
  curve: Pick<
    PlatformValueCurve,
    | "parameters"
    | "rank_count"
    | "observation_count"
    | "rmse"
    | "sample_size"
    | "successful_league_count"
    | "attempted_league_count"
    | "model_version"
    | "generated_at"
  >;
  // The points the curve was fitted to: the mean salary at each rank across the sampled leagues,
  // and how many of those leagues had a player at that rank.
  fit_points: PlatformValueCurvePoint[];
  sampled_leagues: PlatformSampledLeague[];
  failed_leagues: PlatformValueCurve["failed_leagues"];
};

export type ValueCurveExport = LeagueValueCurveExport | PlatformValueCurveExport;

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

export function buildPlatformValueCurveExport({
  curve,
  exportedAt = new Date().toISOString()
}: {
  curve: PlatformValueCurve;
  exportedAt?: string;
}): PlatformValueCurveExport {
  return {
    format: PLATFORM_VALUE_CURVE_EXPORT_FORMAT,
    format_version: PLATFORM_VALUE_CURVE_EXPORT_VERSION,
    exported_at: exportedAt,
    formula: VALUE_CURVE_FORMULA,
    platform: "ottoneu",
    curve: {
      parameters: copyParameters(curve.parameters),
      rank_count: curve.rank_count,
      observation_count: curve.observation_count,
      rmse: curve.rmse,
      sample_size: curve.sample_size,
      successful_league_count: curve.successful_league_count,
      attempted_league_count: curve.attempted_league_count,
      model_version: curve.model_version,
      generated_at: curve.generated_at
    },
    fit_points: curve.points.map((point) => ({ rank: point.rank, salary: point.salary, sample_count: point.sample_count })),
    sampled_leagues: curve.sampled_leagues.map((league) => ({
      league_id: league.league_id,
      league_name: league.league_name,
      game_type: league.game_type,
      player_count: league.player_count,
      url: league.url
    })),
    failed_leagues: curve.failed_leagues.map((league) => ({
      league_id: league.league_id,
      league_name: league.league_name,
      message: league.message
    }))
  };
}

export function leagueValueCurveExportFilename(leagueName: string, generatedAt: string) {
  return `${slugify(leagueName) || "league"}-value-curve${fileDate(generatedAt)}.json`;
}

export function platformValueCurveExportFilename(generatedAt: string) {
  return `ottoneu-platform-value-curve${fileDate(generatedAt)}.json`;
}

// The upload side: accept a league or platform curve file only if its parameters can be evaluated.
export function parseValueCurveExport(text: string): ValueCurveExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  const expectedVersion = !isRecord(data)
    ? null
    : data.format === LEAGUE_VALUE_CURVE_EXPORT_FORMAT
      ? LEAGUE_VALUE_CURVE_EXPORT_VERSION
      : data.format === PLATFORM_VALUE_CURVE_EXPORT_FORMAT
        ? PLATFORM_VALUE_CURVE_EXPORT_VERSION
        : null;
  if (!isRecord(data) || expectedVersion === null) {
    throw new Error("This file is not a value curve export.");
  }
  if (data.format_version !== expectedVersion) {
    throw new Error(`Unsupported value curve export version: ${String(data.format_version)}.`);
  }
  if (!isRecord(data.curve) || !hasCurveParameters(data.curve.parameters)) {
    throw new Error("The curve's fitted parameters are missing or not numbers.");
  }
  if (
    data.format === LEAGUE_VALUE_CURVE_EXPORT_FORMAT &&
    data.platform_curve !== null &&
    !(isRecord(data.platform_curve) && hasCurveParameters(data.platform_curve.parameters))
  ) {
    throw new Error("The platform benchmark's fitted parameters are missing or not numbers.");
  }
  return data as ValueCurveExport;
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function fileDate(generatedAt: string) {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(generatedAt)?.[0];
  return date ? `-${date}` : "";
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
