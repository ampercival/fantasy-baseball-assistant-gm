// Port of backend/app/player_keys.py — normalize a player name to a stable key.
const PLAYER_KEY_ALIASES: Record<string, string> = {
  "leodalis de vries": "leo de vries",
};

export function normalizePlayerKey(name: string): string {
  // NFKD + drop combining marks + strip any remaining non-ASCII (mirrors Python's
  // unicodedata.normalize('NFKD').encode('ascii','ignore')).
  let s = (name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = [...s].filter((c) => c.charCodeAt(0) < 128).join("");
  s = s.replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/gi, ""); // drop generational suffixes
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const key = s.split(/\s+/).filter(Boolean).join(" ");
  return PLAYER_KEY_ALIASES[key] ?? key;
}

export function cleanPlayerName(name: string): string {
  return (name ?? "").replace(/ /g, " ").split(/\s+/).filter(Boolean).join(" ");
}
