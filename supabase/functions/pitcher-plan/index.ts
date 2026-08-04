// Supabase Edge Function: load or save one fantasy team's pitcher plan.
//
// GET  ?league_uid=...&team_uid=...
// POST { league_uid, team_uid, plan: { spTarget, bubbleTarget, rpTarget,
//        selectedSpKeys, bubbleSpKeys, selectedRpKeys, usageOverrides } }
import postgres from "npm:postgres@3.4.4";
import { CORS } from "../_shared/cors.ts";

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { prepare: false });
const MAX_SLOTS = 20;
const MAX_PLAYER_KEYS = 100;
const USAGE_OVERRIDE_ROLES = new Set(["SP", "RP", "Mixed - SP", "Mixed - RP"] as const);
type PitcherUsageOverride = "SP" | "RP" | "Mixed - SP" | "Mixed - RP";

type PitcherPlan = {
  bubbleSpKeys: string[];
  bubbleTarget: number;
  rpTarget: number;
  selectedRpKeys: string[];
  selectedSpKeys: string[];
  spTarget: number;
  usageOverrides: Record<string, PitcherUsageOverride>;
};

function clampTarget(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(MAX_SLOTS, Math.max(0, Math.trunc(parsed)));
}

function normalizeKeys(value: unknown, excluded = new Set<string>()): string[] {
  if (typeof value === "string") {
    try {
      return normalizeKeys(JSON.parse(value), excluded);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const key = candidate.trim();
    if (!key || seen.has(key) || excluded.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= MAX_PLAYER_KEYS) break;
  }
  return keys;
}

function normalizeUsageOverrides(value: unknown): Record<string, PitcherUsageOverride> {
  if (typeof value === "string") {
    try {
      return normalizeUsageOverrides(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const overrides: Record<string, PitcherUsageOverride> = {};
  for (const [candidateKey, candidateRole] of Object.entries(value as Record<string, unknown>)) {
    const key = candidateKey.trim();
    if (!key || !USAGE_OVERRIDE_ROLES.has(candidateRole as PitcherUsageOverride)) continue;
    overrides[key] = candidateRole as PitcherUsageOverride;
    if (Object.keys(overrides).length >= MAX_PLAYER_KEYS) break;
  }
  return overrides;
}

function normalizePlan(value: unknown): PitcherPlan {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const spTarget = clampTarget(raw.spTarget, 5);
  const selectedSpKeys = normalizeKeys(raw.selectedSpKeys);
  return {
    spTarget,
    bubbleTarget: Math.min(clampTarget(raw.bubbleTarget, 0), spTarget),
    rpTarget: clampTarget(raw.rpTarget, 5),
    selectedSpKeys,
    bubbleSpKeys: normalizeKeys(raw.bubbleSpKeys, new Set(selectedSpKeys)),
    selectedRpKeys: normalizeKeys(raw.selectedRpKeys),
    usageOverrides: normalizeUsageOverrides(raw.usageOverrides),
  };
}

function planFromRow(row: Record<string, unknown>): PitcherPlan {
  return normalizePlan({
    spTarget: row.sp_target,
    bubbleTarget: row.bubble_target,
    rpTarget: row.rp_target,
    selectedSpKeys: row.selected_sp_keys,
    bubbleSpKeys: row.bubble_sp_keys,
    selectedRpKeys: row.selected_rp_keys,
    usageOverrides: row.usage_overrides,
  });
}

async function teamBelongsToLeague(leagueUid: string, teamUid: string): Promise<boolean> {
  const [membership] = await sql`
    SELECT 1
    FROM league_team_memberships
    WHERE league_uid = ${leagueUid} AND team_uid = ${teamUid}
  `;
  return Boolean(membership);
}

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  return (async () => {
    try {
      if (req.method !== "GET" && req.method !== "POST") {
        return Response.json({ error: "Method not allowed." }, { status: 405, headers: CORS });
      }

      const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
      const url = new URL(req.url);
      const leagueUid = String(
        req.method === "POST" ? body.league_uid ?? "" : url.searchParams.get("league_uid") ?? "",
      ).trim();
      const teamUid = String(
        req.method === "POST" ? body.team_uid ?? "" : url.searchParams.get("team_uid") ?? "",
      ).trim();
      if (!leagueUid || !teamUid) {
        return Response.json({ error: "league_uid and team_uid are required." }, { status: 400, headers: CORS });
      }
      if (!await teamBelongsToLeague(leagueUid, teamUid)) {
        return Response.json({ error: "Unknown team for this league." }, { status: 404, headers: CORS });
      }

      if (req.method === "GET") {
        const [row] = await sql`
          SELECT *
          FROM pitcher_plans
          WHERE league_uid = ${leagueUid} AND team_uid = ${teamUid}
        `;
        return Response.json(
          {
            league_uid: leagueUid,
            team_uid: teamUid,
            plan: row ? planFromRow(row) : null,
            updated_at: row?.updated_at ?? null,
          },
          { headers: CORS },
        );
      }

      const plan = normalizePlan(body.plan);
      const now = new Date().toISOString();
      const [row] = await sql`
        INSERT INTO pitcher_plans (
          league_uid, team_uid, sp_target, bubble_target, rp_target,
          selected_sp_keys, bubble_sp_keys, selected_rp_keys, usage_overrides, created_at, updated_at
        )
        VALUES (
          ${leagueUid}, ${teamUid}, ${plan.spTarget}, ${plan.bubbleTarget}, ${plan.rpTarget},
          ${JSON.stringify(plan.selectedSpKeys)}::text::jsonb,
          ${JSON.stringify(plan.bubbleSpKeys)}::text::jsonb,
          ${JSON.stringify(plan.selectedRpKeys)}::text::jsonb,
          ${JSON.stringify(plan.usageOverrides)}::text::jsonb,
          ${now}, ${now}
        )
        ON CONFLICT (league_uid, team_uid)
        DO UPDATE SET
          sp_target = EXCLUDED.sp_target,
          bubble_target = EXCLUDED.bubble_target,
          rp_target = EXCLUDED.rp_target,
          selected_sp_keys = EXCLUDED.selected_sp_keys,
          bubble_sp_keys = EXCLUDED.bubble_sp_keys,
          selected_rp_keys = EXCLUDED.selected_rp_keys,
          usage_overrides = EXCLUDED.usage_overrides,
          updated_at = EXCLUDED.updated_at
        RETURNING *
      `;
      return Response.json(
        {
          league_uid: leagueUid,
          team_uid: teamUid,
          plan: planFromRow(row),
          updated_at: row.updated_at,
        },
        { headers: CORS },
      );
    } catch (err) {
      return Response.json(
        { error: String(err instanceof Error ? err.message : err) },
        { status: 500, headers: CORS },
      );
    }
  })();
});
