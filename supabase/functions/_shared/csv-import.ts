export type CsvRankingEntry = {
  age: number | null;
  player_name: string;
  positions: string | null;
  rank: number;
  team: string | null;
};

export class CsvImportError extends Error {}

const HEADER_ALIASES = {
  age: ["age"],
  player: ["player", "name", "player name"],
  position: ["pos", "position", "positions"],
  rank: ["rank", "ranking", "overall rank", "may rank"],
  team: ["team", "tm", "org", "organization"],
} as const;

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").replace(/\u00a0/g, " ").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function cleanValue(value: string | undefined): string | null {
  const cleaned = (value ?? "").replace(/\u00a0/g, " ").trim().replace(/\s+/g, " ");
  return cleaned || null;
}

function delimiterCounts(line: string): Map<string, number> {
  const counts = new Map([[",", 0], ["\t", 0], [";", 0], ["|", 0]]);
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && counts.has(character)) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
    }
  }
  return counts;
}

function detectDelimiter(csvText: string): string {
  const headerLine = csvText.split(/\r?\n/, 1)[0] ?? "";
  const counts = delimiterCounts(headerLine);
  let delimiter = ",";
  let maximum = -1;
  for (const candidate of [",", "\t", ";", "|"]) {
    const count = counts.get(candidate) ?? 0;
    if (count > maximum) {
      delimiter = candidate;
      maximum = count;
    }
  }
  return delimiter;
}

function parseRows(csvText: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const character = csvText[index];
    if (character === '"') {
      if (quoted && csvText[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && character === delimiter) {
      row.push(value);
      value = "";
    } else if (!quoted && (character === "\n" || character === "\r")) {
      if (character === "\r" && csvText[index + 1] === "\n") index += 1;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }

  if (quoted) throw new CsvImportError("CSV import contains an unclosed quoted value.");
  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

function findHeader(headerIndexes: Map<string, number>, aliases: readonly string[]): number | null {
  for (const alias of aliases) {
    const index = headerIndexes.get(alias);
    if (index !== undefined) return index;
  }
  return null;
}

function parseRank(value: string | undefined): number | null {
  const match = (value ?? "").replace(/,/g, "").match(/\d+/);
  if (!match) return null;
  const rank = Number(match[0]);
  return Number.isInteger(rank) && rank > 0 ? rank : null;
}

function parseAge(value: string | undefined): number | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  const age = Number(text);
  return Number.isFinite(age) ? age : null;
}

export function parseCsvImport(csvText: string): CsvRankingEntry[] {
  const text = csvText.trim();
  if (!text) throw new CsvImportError("CSV import needs a header row.");

  const rows = parseRows(text, detectDelimiter(text));
  const headers = rows.shift();
  if (!headers?.length) throw new CsvImportError("CSV import needs a header row.");

  const headerIndexes = new Map<string, number>();
  headers.forEach((header, index) => headerIndexes.set(normalizeHeader(header), index));
  const rankIndex = findHeader(headerIndexes, HEADER_ALIASES.rank);
  const playerIndex = findHeader(headerIndexes, HEADER_ALIASES.player);
  const teamIndex = findHeader(headerIndexes, HEADER_ALIASES.team);
  const positionIndex = findHeader(headerIndexes, HEADER_ALIASES.position);
  const ageIndex = findHeader(headerIndexes, HEADER_ALIASES.age);
  if (rankIndex === null || playerIndex === null) {
    throw new CsvImportError("CSV import requires rank and player/name columns.");
  }

  const entries: CsvRankingEntry[] = [];
  for (const row of rows) {
    const rank = parseRank(row[rankIndex]);
    const playerName = cleanValue(row[playerIndex]);
    if (rank === null || !playerName) continue;
    entries.push({
      age: ageIndex === null ? null : parseAge(row[ageIndex]),
      player_name: playerName,
      positions: positionIndex === null ? null : cleanValue(row[positionIndex]),
      rank,
      team: teamIndex === null ? null : cleanValue(row[teamIndex]),
    });
  }
  if (!entries.length) throw new CsvImportError("CSV import did not contain any valid ranking rows.");

  const deduped: CsvRankingEntry[] = [];
  const seenNames = new Set<string>();
  for (const entry of entries.sort((left, right) => left.rank - right.rank)) {
    const key = entry.player_name.toLocaleLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    deduped.push(entry);
  }
  return deduped;
}
