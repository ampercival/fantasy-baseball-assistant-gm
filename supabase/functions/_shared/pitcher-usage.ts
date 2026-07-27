export type PitcherBucket = "SP" | "RP";
export type RosterPitcher = Record<string, any>;
export type PitcherUsageRow = Record<string, any>;

export function isDualEligible(positions: unknown): boolean {
  const tokens = positionTokens(positions);
  return tokens.has("SP") && tokens.has("RP");
}

export function classifyPitcherUsage(
  player: RosterPitcher,
  appearanceStarts: number[],
  fangraphsId: string | number | null = null,
): PitcherUsageRow {
  if (!isDualEligible(player.positions)) {
    const bucket: PitcherBucket = positionTokens(player.positions).has("RP") ? "RP" : "SP";
    return usageRow(player, {
      bucket,
      role: bucket,
      usage_source: "eligibility",
    });
  }

  const starts: number[] = appearanceStarts.map((value) => (Number(value) > 0 ? 1 : 0));
  const seasonStarts = starts.reduce<number>((total, value) => total + value, 0);
  const seasonAppearances = starts.length;
  const seasonRelief = seasonAppearances - seasonStarts;
  if (seasonAppearances === 0) {
    return usageRow(player, {
      bucket: "SP",
      role: "No season usage",
      season_appearances: 0,
      season_starts: 0,
      season_relief_appearances: 0,
      fangraphs_id: fangraphsId,
      usage_source: "fangraphs-game-log",
    });
  }

  let bucket: PitcherBucket;
  let role: string;
  if (seasonRelief === 0) {
    bucket = "SP";
    role = "SP";
  } else if (seasonStarts === 0) {
    bucket = "RP";
    role = "RP";
  } else {
    const recent = starts.slice(0, 5);
    const recentStarts = recent.reduce<number>((total, value) => total + value, 0);
    bucket = recentStarts > recent.length - recentStarts ? "SP" : "RP";
    role = `Mixed - ${bucket}`;
  }

  return usageRow(player, {
    bucket,
    role,
    season_appearances: seasonAppearances,
    season_starts: seasonStarts,
    season_relief_appearances: seasonRelief,
    last_five: starts.slice(0, 5).map((value) => (value ? "SP" : "RP")),
    fangraphs_id: fangraphsId,
    usage_source: "fangraphs-game-log",
  });
}

export function fallbackPitcherUsage(
  player: RosterPitcher,
  error: string,
  fangraphsId: string | number | null = null,
): PitcherUsageRow {
  const games = integerOrNull(player.games);
  const starts = integerOrNull(player.games_started);
  const relief = games == null || starts == null ? null : Math.max(0, games - starts);
  let bucket: PitcherBucket = "SP";
  let role = "Usage unavailable";
  if (games != null && games > 0 && starts != null && relief != null) {
    if (relief === 0) {
      bucket = "SP";
      role = "SP";
    } else if (starts === 0) {
      bucket = "RP";
      role = "RP";
    } else {
      bucket = starts > relief ? "SP" : "RP";
    }
  }
  return usageRow(player, {
    bucket,
    role,
    season_appearances: games,
    season_starts: starts,
    season_relief_appearances: relief,
    fangraphs_id: fangraphsId,
    usage_source: "roster-fallback",
    error,
  });
}

export function extractPitcherAppearanceStarts(payload: any): number[] {
  const rows = Array.isArray(payload?.mlb) ? payload.mlb : [];
  return rows
    .filter((row: any) => String(row?.gamedate ?? "") !== "2050-01-01" && numberOrNull(row?.G) !== 0)
    .sort((left: any, right: any) => {
      const dateComparison = String(right?.gamedate ?? "").localeCompare(String(left?.gamedate ?? ""));
      return dateComparison || (integerOrNull(right?.dh) ?? 0) - (integerOrNull(left?.dh) ?? 0);
    })
    .map((row: any) => ((numberOrNull(row?.GS) ?? 0) > 0 ? 1 : 0));
}

export function parseOttoneuFangraphsIdMap(csvText: string): Map<number, string> {
  const rows = parseCsv(csvText.replace(/^\uFEFF/, ""));
  if (!rows.length) throw new Error("Ottoneu player-ID export was empty.");
  const headers = rows[0];
  const ottoneuIndex = headers.indexOf("OttoneuID");
  const fangraphsIndex = headers.indexOf("FG MajorLeagueID");
  if (ottoneuIndex < 0 || fangraphsIndex < 0) {
    throw new Error("Ottoneu player-ID export did not contain the expected columns.");
  }
  const result = new Map<number, string>();
  for (const row of rows.slice(1)) {
    const ottoneuId = integerOrNull(row[ottoneuIndex]);
    const fangraphsId = String(row[fangraphsIndex] ?? "").trim();
    if (ottoneuId != null && fangraphsId) result.set(ottoneuId, fangraphsId);
  }
  if (!result.size) throw new Error("Ottoneu player-ID export did not contain any FanGraphs IDs.");
  return result;
}

function usageRow(player: RosterPitcher, values: Record<string, any>): PitcherUsageRow {
  const fangraphsId = values.fangraphs_id == null ? null : String(values.fangraphs_id);
  return {
    player_key: player.player_key,
    player_name: player.player_name,
    positions: player.positions ?? null,
    bucket: values.bucket,
    role: values.role,
    season_appearances: values.season_appearances ?? null,
    season_starts: values.season_starts ?? null,
    season_relief_appearances: values.season_relief_appearances ?? null,
    last_five: values.last_five ?? [],
    fangraphs_id: fangraphsId,
    fangraphs_url: fangraphsId
      ? `https://www.fangraphs.com/players/${playerSlug(String(player.player_name ?? ""))}/${fangraphsId}/game-log?position=P`
      : null,
    usage_source: values.usage_source,
    error: values.error ?? null,
  };
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.length)) rows.push(row);
  return rows;
}

function positionTokens(value: unknown): Set<string> {
  return new Set(String(value ?? "").toUpperCase().split(/[^A-Z0-9+]+/).filter(Boolean));
}

function playerSlug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "player";
}

function integerOrNull(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
}

function numberOrNull(value: unknown): number | null {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
