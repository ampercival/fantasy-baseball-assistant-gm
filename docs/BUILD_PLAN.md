# Build Plan — Static Frontend + Supabase (all-in-Supabase)

Goal: deliver every current feature as a **static website** (GitHub Pages) backed entirely by
**Supabase** (Postgres + Auth + RLS + PostgREST + Edge Functions). Scrapers are **rewritten in
TypeScript as Edge Functions** so on-demand runs are instant (no job spin-up). No always-on
server, no GitHub Actions at runtime, no Python in the final state.

This document is the roadmap. It is phased so each phase leaves the app in a working state.

## Locked decisions (2026-06-25)
1. **On-demand scraping = full TypeScript rewrite** as Edge Functions (instant, no spin-up).
   Python scrapers become a *reference spec*, not runtime code.
2. **Repo stays private; Supabase data may be public-read.** (See the Pages caveat in §6 —
   private repo + GitHub Pages needs a paid plan or a public "site" repo.)
3. **Host = GitHub Pages** for now.

---

## 1. North-star architecture

```
┌─ Static UI ───────────┐   ┌─ Supabase (the entire backend) ─────────────────────┐
│ React + Vite + TS     │   │ Postgres    (source of truth)                       │
│ supabase-js           │──►│ PostgREST   (auto REST API)                         │
│ GitHub Pages          │   │ Auth + RLS  (gate writes; reads may be public)      │
│ (interface only)      │   │ Views + RPC (aggregation logic, ex-Python)          │
│                       │   │ Edge Functions (TS)  ── scrapers + imports          │
│                       │   │ pg_cron + pg_net     ── scheduled refresh           │
└───────────────────────┘   └─────────────────────────────────────────────────────┘
```

Two planes only:
1. **Static UI** — dumb client. Reads views/RPC, writes simple CRUD, invokes scrape functions.
2. **Supabase** — database + API + auth + the scrapers themselves (as Edge Functions).

---

## 2. Tech stack decisions

| Concern | Choice | Notes |
|---|---|---|
| Frontend | React 19 + Vite + TS | UI largely carries over |
| Static host | GitHub Pages | (private-repo caveat — §6) |
| Backend | Supabase | Postgres + PostgREST + Auth + Edge Functions |
| DB access from UI | `@supabase/supabase-js` | reads via RPC/views, writes via table CRUD |
| Aggregation reads | Postgres **views + RPC** | replaces `build_aggregate_board`, `league_value` |
| Auth | Supabase Auth (magic link) | reads public; writes/scrapes require login |
| Scrapers / imports | **Rewritten in TS as Edge Functions** | instant on-demand; HTML parsing via `deno-dom` |
| Scheduled refresh | **pg_cron + pg_net** call the Edge Functions | no GitHub Actions runtime |
| Batch ops (update-all, import league) | **fan out** to per-item function calls | stays within Edge Function time limits |
| Schema/functions as code | Supabase CLI (`supabase/`) | version-controlled, reproducible |

**Edge Function limit note:** Edge Functions have per-invocation time/CPU limits. A *single*
source scrape or single team import fits easily. "Update all sources" / "import a whole league"
must **fan out** — enqueue one invocation per source/team (the UI or a coordinator function
triggers N calls) rather than scraping everything in one invocation.

---

## 3. Target repository structure

```
/frontend            # React app (existing UI, API layer swapped to supabase-js)
/supabase
  /migrations        # SQL: schema, views, RPC, RLS policies (CLI-managed)
  /functions
    scrape-source/   # TS: scrape one ranking source -> Supabase
    import-team/     # TS: scrape one Ottoneu team -> Supabase
    import-league/   # TS: enumerate league teams, fan out to import-team
    lineup-xfip/     # TS: fetch FanGraphs probables + xFIP
    _shared/         # TS: HTML parsing helpers, player-key normalization, sinks
  config.toml
/reference           # OLD Python kept as the parsing SPEC for the TS rewrite (not deployed)
  scrapers.py  ottoneu.py  sources.py  player_keys.py  aggregate.py
/.github/workflows
  deploy-pages.yml   # builds & deploys frontend only
/docs/BUILD_PLAN.md
```

The current `/backend` FastAPI app is **retired**. Its scraper modules move to `/reference`
as the spec the TypeScript functions are ported from. Its CRUD/HTTP layer is replaced by Supabase.

---

## 4. What carries over vs. gets rewritten

| Existing code | Fate |
|---|---|
| `frontend/src/App.tsx` (UI) | **Mostly reused** — swap `fetch('/api/...')` for supabase-js / RPC |
| `backend/app/scrapers.py`, `ottoneu.py`, `lineup_helper.py` | **Rewritten in TS** (parsing rules port over; kept as `/reference` spec) |
| `backend/app/sources.py`, `player_keys.py` | Reimplemented in TS `_shared/` (source list, key normalization) |
| `backend/app/aggregate.py`, `league_value.py` | **Re-expressed as SQL** views/RPC |
| `backend/app/db.py`, `main.py` | **Retired** — Supabase is the API |
| `backend/migrate_sqlite_to_postgres.py` | **Reused** for the one-time data load |

This is the largest work item in the project: porting ~9 ranking scrapers + Ottoneu roster
parsing + FanGraphs fetch from Python/BeautifulSoup to TypeScript/`deno-dom`. Expect iteration
per source.

---

## 5. Phased plan

### Phase 0 — Foundations  *(partly done)*
- [x] Git repo (private), Supabase project provisioned.
- [ ] Install **Supabase CLI**; `supabase init`; `supabase link` to the project.
- [ ] Commit `supabase/` scaffolding (`config.toml`).
- [ ] Move existing Python to `/reference`; delete `/backend` FastAPI HTTP+CRUD (keep local backup).

### Phase 1 — Database schema as a migration
- [ ] `supabase/migrations/0001_init.sql` from the existing 15-table schema (types resolved:
      `SERIAL`, `TEXT`, FK `ON DELETE CASCADE`, indexes).
- [ ] Add `user_id uuid` to user-owned tables (teams, leagues, memberships, prefs, corrections);
      rankings/sources/snapshots are **global read**. (Cheap insurance for multi-user later.)
- [ ] Enable RLS (policies finalized in Phase 5).
- [ ] `supabase db push`.

### Phase 2 — One-time data migration
- [ ] Adapt `migrate_sqlite_to_postgres.py` to set `user_id` on owned tables.
- [ ] Run; verify row counts vs. SQLite.

### Phase 3 — Read path: views + RPC  *(largest SQL effort)*
- [ ] View: latest successful snapshot per source.
- [ ] RPC `get_aggregate_board(tdg_format, fantrax_format, included_tags, included_only)`
      → avg/median/spread/source-count + per-source rank columns + filters.
- [ ] Views/RPC: team detail + ranking match, league roster map, value curve, available stats.
- [ ] Materialized view for the board if live aggregation is slow (refresh after scrape).

### Phase 4 — Frontend: swap the API layer
- [ ] Add `@supabase/supabase-js`; client from `VITE_SUPABASE_URL` + publishable key.
- [ ] Reads → `supabase.rpc(...)` / `.from(...).select(...)`.
- [ ] Simple writes (source included/tag, corrections, lineup prefs, deletes) → direct supabase.
- [ ] CSV export → generated client-side from board data.
- [ ] Scrape/import buttons → `supabase.functions.invoke(...)` (Phase 6).

### Phase 5 — Auth + RLS
- [ ] Supabase Auth (magic link) + minimal login screen.
- [ ] RLS: global read on rankings (public ok); writes/scrapes require `auth.uid()` ownership.

### Phase 6 — Scrapers as TypeScript Edge Functions  *(largest overall effort)*
- [ ] `_shared/`: HTML fetch + `deno-dom` parsing helpers, `player_key` normalization, table
      parser, source registry (ports `scrapers.py`/`sources.py`/`player_keys.py`).
- [ ] `scrape-source` (one source), `import-team` (one Ottoneu team), `import-league`
      (enumerate teams → fan out to `import-team`), `lineup-xfip` (FanGraphs).
- [ ] Each function writes snapshots/entries/rosters into Supabase and refreshes the board view.
- [ ] Manual CSV import: parse in browser, write rows via supabase-js (no function needed).
- [ ] **Scheduled refresh:** `pg_cron` + `pg_net` invoke `scrape-source` per source on a timer.
- [ ] Frontend buttons invoke functions and reflect results (or subscribe via Realtime).

### Phase 7 — Deploy & cutover
- [ ] Resolve the Pages/private-repo path (see §6). Set `VITE_SUPABASE_URL`, publishable key,
      base path as repo variables/secrets.
- [ ] Deploy frontend; verify from a phone on cellular.
- [ ] Confirm on-demand + scheduled scraping in production. Retire `/backend`.

### Phase 8 — Optional polish / scale
- [ ] Realtime board updates; multi-user invites; ingestion error monitoring.

---

## 6. Open items still needing your input

1. **Repo visibility — RESOLVED:** repo will be made **public** so GitHub Pages publishes on
   the Free plan. Safe because no secrets are committed (publishable key is RLS-protected;
   DB password / service-role key stay in `.env` / Supabase / GitHub secrets only).

2. **Auth strictness.** You said Supabase data may be public — so **reads can be anon/public**
   (anyone with the URL views the board) while **writes + scrape triggers require login**.
   Confirm that's the intended posture (vs. login required even to view).

---

## 7. Milestones
- **M1 (view from anywhere):** Phases 0–4 + public read + Pages deploy. View board/teams on phone.
- **M2 (secured + editable):** Phase 5. Login + edits persist.
- **M3 (full parity):** Phase 6. TS scrapers/imports work; retire FastAPI (Phase 7).
- **M4:** Phase 8 polish.

## 8. Status snapshot
- Done: repo, Supabase project, frontend API-base configurable, Pages workflow.
- **Phase 1 DONE & VERIFIED:** schema applied to Supabase via `supabase/migrations/20260625000001_init.sql`
  (15 tables, SERIAL ids, RLS on + public-read policy each).
- **Phase 2 DONE & VERIFIED (2026-06-25):** 143,739 rows copied SQLite→Supabase; row counts match
  exactly on all 15 tables; SERIAL sequences advanced past max ids. Connection uses the Supabase
  **Session pooler** (`aws-1-us-east-1.pooler.supabase.com:5432`) — the direct `db.*` host is
  IPv6-only and doesn't resolve here.
- Superseded: FastAPI psycopg port (`backend/app/db.py`) — not part of the static final state;
  Python scrapers retained as `/reference` spec for the TS rewrite.
- Next concrete step: **Phase 3** — port `build_aggregate_board` to a Postgres view/RPC, then
  Phase 4 (frontend → supabase-js) to reach milestone M1 (view from anywhere).
