# Lineup Analyser Correctness TODO

Status: Critical correctness complete; post-critical edge backlog remains
Created: 2026-08-22
Primary branch: `github-pages-supabase`
Source of truth: this file

## How to use this tracker

- Resume at the first unchecked item.
- Check an item only after its implementation and focused validation both pass.
- After each completed issue, add dated evidence to the progress log before moving on.
- Preserve the decision rules below unless a later entry explicitly changes them.
- Before delivery, run the complete regression suite, commit, push, verify the deployment, and record the evidence here.

## Outcome

The Lineup Analyser must optimize the actual slate: every scheduled game is counted, preferences cannot manufacture eligibility, refresh obtains new data, and the date shown is the user's current baseball day.

## Locked decisions

- Schedule availability is a hard constraint. `Always Start` can prioritize a player who has a game, but can never make an off-day or non-MLB player eligible.
- Matchups are modeled as a list per team so doubleheaders cannot overwrite one another.
- Hitter estimates sum all games on the selected date; probable starts retain their game identity.
- `Refresh Probables` must request the existing scoped lineup refresh and then reload the selected slate after completion.
- The client sends an explicit visitor-local start date to avoid UTC rollover dropping the current slate.
- Existing database caches remain the normal read path; refreshes update them rather than adding redundant direct calls.

## Phase 0 — Baseline and tracker

- [x] Confirm branch/worktree baseline and create this durable tracker.
- [x] Record reproducible evidence for every critical issue.

Baseline evidence (2026-08-22):

- Doubleheader: the cached 2026-08-29 slate contains two BOS-NYY games, but a team-keyed map retained only Game 2. Jake Bennett's Game 1 start disappeared and Willson Contreras received only one game's estimate.
- Availability: saved `Always Start` preferences can override `no-game`; current saved examples include Ronald Acuna Jr. on ATL's 2026-08-24 off-day and Elly De La Cruz on CIN's 2026-08-27 off-day.
- Refresh: the button only reloads date choices, while the refresh worker already exposes the intended `lineup` scope; selecting the same date does not refetch recommendations.
- Date boundary: after local 21:00 in Halifax, the UTC-default dates endpoint began at the next day and omitted the still-active local slate.
- Baseline suites passed but do not cover these failures: backend 55 tests, frontend 52 tests, and three standalone Edge assertions.

## Phase 1 — Preserve and score doubleheaders

- [x] Store all scheduled team matchups instead of overwriting by team.
- [x] Return per-game hitter matchup context while retaining compatible summary fields.
- [x] Sum hitter estimates across every game and retain every probable pitcher start.
- [x] Add doubleheader regression coverage in Python, Edge TypeScript, and frontend optimizer tests.

Acceptance: a synthetic two-game team produces two hitter game contributions and both probable starts; the live 2026-08-29 BOS-NYY slate no longer loses Game 1.

## Phase 2 — Make schedule availability authoritative

- [x] Evaluate `no-mlb-team` and `no-game` before saved Start/Sit preferences in both recommendation engines.
- [x] Carry factual `plays_today` eligibility into the client optimizer.
- [x] Prevent infeasible/off-day locks from occupying a lineup slot while surfacing the unassigned lock warning.
- [x] Preserve every compatible lock when one forced set is infeasible instead of silently discarding all locks.
- [x] Keep missing P/G as unknown and exclude it explicitly instead of silently optimizing it as zero.
- [x] Add regressions for off-day `Always Start` and unavailable pitchers.

Acceptance: an off-day player remains `no-game` and cannot displace a scheduled player; conflicting locks retain the largest compatible set; missing projections are visibly excluded.

## Phase 3 — Make Refresh Probables a real refresh

- [x] Invoke the existing cloud refresh with `scope=lineup`.
- [x] Wait for refresh completion, preserve the selected date, and reload both date and recommendation data.
- [x] Add component/integration coverage for the refresh path.

Acceptance: clicking Refresh Probables queues a lineup refresh and the displayed selected slate is fetched again after it finishes.

## Phase 4 — Keep the local current slate through UTC rollover

- [x] Send the visitor-local date as `start_date` when loading lineup dates.
- [x] Add a regression covering a local date behind the current UTC date.

Acceptance: the current Halifax date remains selectable after 21:00 ADT and late games do not disappear.

## Phase 5 — Delivery

- [x] Run focused and full backend, frontend, Edge, build, and diff validations.
- [x] Commit the completed critical-correctness set.
- [x] Push `github-pages-supabase`.
- [x] Deploy changed Supabase Edge Functions.
- [x] Wait for GitHub Pages and verify the live Lineup Analyser at desktop and phone widths.

## Phase 6 — Residual audit closure

- [x] Classify `MiLB` as minor-league status instead of accidentally matching the `IL` substring.
- [x] Exclude postponed, cancelled, and suspended games from the MLB schedule fallback.
- [x] Fill only missing probable-pitcher and offense references when a cache row is partial, and reject reference cache data older than 20 hours.
- [x] Warn when roster/position constraints leave daily lineup slots unfilled.
- [x] Run full validation for the integrated residual fixes.
- [x] Deliver the residual fixes and reverify production.

## Post-critical edge backlog

- [ ] Make pitcher Start/Decide/Sit recommendations matchup-aware instead of reflecting saved rotation-plan membership alone.
- [ ] Reconcile optimized slot assignments with the xFIP-only Lean label so the screen cannot present two unexplained directives.
- [ ] Add per-player data provenance/confidence and visibly flag stale schedule/reference cache ages.
- [ ] Persist successful request-time reference gap fills so repeated team views do not refetch the same missing rows before the worker refresh.
- [ ] Incorporate confirmed batting-order status, handedness/platoon context, park, and weather once reliable cached sources are selected.
- [ ] Shorten the phone path from controls to recommendations and continue reducing table scanning at 390px.

## Progress log

| Date | Issue | Result | Validation / delivery evidence |
| --- | --- | --- | --- |
| 2026-08-22 | Baseline and tracker | Complete | Branch `github-pages-supabase` at `fcf910e`; clean worktree; live and synthetic failure evidence recorded above. |
| 2026-08-22 | Doubleheaders | Complete | Per-team matchup arrays, per-game response rows, summed client estimates, and game-aware pitcher starts; focused Python and both Edge suites passed, including the live BOS-NYY-shaped fixture. |
| 2026-08-22 | Hard availability and optimizer safety | Complete | Off-day/no-team states precede prefs; unavailable pitchers are excluded; 9 daily optimizer tests cover off-day locks, compatible conflicts, missing P/G, and two-game scoring. |
| 2026-08-22 | Refresh Probables | Complete | Queues `scope=lineup`, waits for a completed request, preserves the date, and explicitly reloads an unchanged slate; 6 focused Vitest assertions passed. |
| 2026-08-22 | Local slate date | Complete | `lineup-dates` query now sends visitor-local `start_date`; local-date and fallback regressions passed in the refresh test suite. |
| 2026-08-22 | Full pre-delivery validation | Complete | Backend 62/62; frontend 67/67; lineup/date/pitcher-usage/optimal-lineup Edge assertions passed; TypeScript/Vite build, Python compile, and diff check passed. Rendered at 1440px and 390px with no document overflow; an Aug. 24 off-day lock stayed benched and produced the explicit warning. |
| 2026-08-22 | Production delivery | Complete | Implementation commit `de6c2c1` pushed; `lineup-recommendations` and `lineup-dates` deployed; Pages run `32609913406` passed. Live Aug. 29 showed Willson Contreras at 16.5 estimated points across G1/G2 and restored Jake Bennett's G1 start. Live Aug. 24 labeled Ronald Acuna Jr. `No game`, kept him on the bench, and warned about the unusable lock. Production at 390x844 had no document-level horizontal overflow and no console errors. |
| 2026-08-22 | MiLB/IL classification | Complete | IL detection now uses letter boundaries, so `MiLB` remains minor-league while `15IL`, `60-Day IL`, and `DL` remain IL; focused Python assertions passed. |
| 2026-08-22 | MLB fallback game status | Complete | Postponed, cancelled, and suspended games no longer contribute games, probables, or matchups in either backend mirror; focused Python and Edge fallback assertions passed. |
| 2026-08-22 | Incomplete daily lineup | Complete | Optimizer warnings now separate missing slots, incompatible locks, and missing projections. A catcher-short roster reports 12/13 with the unfilled `C` slot in a danger alert; 11 focused and 69 full frontend tests plus the production build passed. |
| 2026-08-22 | Reference cache coverage and freshness | Complete | Complete cache hits issue zero live calls; partial xFIP data fetches only missing probable pitchers; missing offense ranks trigger one complete league snapshot; live partial snapshots cannot erase valid cached ranks. Reference data older than 20 hours is ignored and refreshed. Dedicated Edge assertions cover complete, partial, stale, incomplete-live, and failed-fill paths. |
| 2026-08-22 | Residual integrated validation | Complete | Backend 64/64 and frontend 69/69 passed. Five relevant Edge assertion scripts passed, including the new reference-cache suite. Vite/TypeScript built 1,773 modules; Python compilation and diff checks passed. |
| 2026-08-22 | Residual production delivery | Complete | Commit `759bb20` pushed; `lineup-recommendations` and `lineup-dates` redeployed; Pages run `32610623839` passed. Live reference resolution used 29 cached xFIP rows, attempted only the one missing fetchable row, and explicitly reported that it remained unresolved. The live optimizer rendered an accessible 12/13 alert naming the unfilled `C` slot; at 390x844 the alert fit within a 375px document with no horizontal overflow or console errors. |
