# Hybrid Plan — local ingest → Supabase → static Pages frontend

Branch: `github-pages-supabase`. `main` stays the pure-local SQLite app.

## Architecture

```
LOCAL (operator's machine)                 SUPABASE                     GITHUB PAGES
Python backend:                            Postgres (the only DB)        Static React frontend
 - scrape ranking sources        ── writes ──►  tables + views          reads via supabase-js
 - import Ottoneu teams/leagues                 Edge Functions:         + Edge Functions;
 - compute aggregates                            aggregate-board         trade eval / sorting
                                                 team-detail             run client-side
FanGraphs (lineup) ── Edge Function ──►          league-roster-map
                                                 lineup (NEW)
```

## Locked decisions
1. **No local database.** All data lives in Supabase Postgres. The local Python backend
   writes directly to Supabase (db.py uses psycopg, not sqlite3). When the operator
   scrapes/imports locally, the data is "just there" for the frontend.
2. **Lineup optimizer = Edge Function.** VERIFIED (2026-07-04): FanGraphs is fetchable from
   the Supabase Edge datacenter IP — probables grid (200, `__NEXT_DATA__`, no Cloudflare
   challenge) and player stats API (200, JSON, real xFIP-). So the optimizer's live FanGraphs
   fetch works from the cloud; no local-only fallback needed.

## Reuse (big head start — most of this already exists)
- Supabase project **fgvgrjeeenetksxvepxh** is live; Edge Functions **aggregate-board /
  team-detail / league-roster-map** are still deployed and responding.
- Schema migration, those Edge Functions (+ `_shared/aggregate.ts`, `value-curve.ts`), the
  SQLite→Postgres migration script, and the frontend supabase-js wiring all exist in git
  history through commit `4a5419a` (pre-revert on main).
- Repo is already PUBLIC; the Pages deploy workflow exists in history.
- Caveat: `main` has since diverged (source pruning, IL/MiLB tags, Update Continuous, startup
  work), so the Supabase layer must be **re-integrated onto current code**, not blind-restored.

## Feature mapping
| Feature | Path on Pages |
|---|---|
| Ranking table | `aggregate-board` Edge Function (or precomputed) over data pushed by local ingest |
| Trade evaluation | client-side math over roster + board + value curve read from Supabase |
| Lineup optimizer | NEW `lineup` Edge Function (FanGraphs fetch verified) + roster from Supabase |
| Teams / Leagues / roster map | PostgREST views + `league-roster-map` Edge Function |

## Build sequence
1. **db.py → Supabase Postgres** (merge the psycopg port from history with current db.py:
   normalization gating + app_metadata). Local backend now writes to Supabase. `.env` holds
   `DATABASE_URL` (session pooler).
2. **Schema + sources sync**: apply schema to Supabase; local `init_db`/`upsert_sources`
   reconciles the current 14-source registry (removes the stale ESPN/BP/DD/RW/SE rows).
3. **Frontend reads from Supabase** (re-integrate fetchFunction/fetchRest into current App.tsx;
   redeploy aggregate-board/team-detail/league-roster-map as needed for the current data model).
4. **lineup Edge Function**: port the FanGraphs probables + xFIP fetch and lineup recommendation.
5. **Deploy frontend to Pages** (restore the deploy workflow; set VITE_SUPABASE_* repo vars).

## Status
- Branch created; supabase/config.toml restored; FanGraphs-from-Edge verified.
- Next: step 1 (db.py → Supabase Postgres).
