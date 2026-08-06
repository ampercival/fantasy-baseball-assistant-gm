# Trade Analyzer GM Workflow TODO

Status: Phases 0-9 complete - Impact Analysis remains queued

Created: 2026-08-05

Primary branch: `github-pages-supabase`

Source of truth for follow-on sessions: this file

## How to use this checklist

- Check off individual items only after the implementation and relevant validation are complete.
- Do not mark a phase complete while any required child item remains open.
- Add dated notes, validation output, commit IDs, deployment run IDs, and material design changes to the Progress Log.
- Preserve the locked decisions below unless the user explicitly changes them. Record any approved change in the Decision Log.
- Keep Impact Analysis queued until Phases 0-9 are complete. Do not ship a placeholder or disabled Impact Analysis button.
- At the start of a follow-on session, read this file, inspect the current diff, and resume from the first unchecked item.

## Outcome

Turn the Trade screen into a GM decision tool that answers:

1. What am I giving and getting?
2. How does each player compare by salary, dynasty value, scoring value, and surplus?
3. Is the exchange fair?
4. Do the enabled dynasty sources agree?
5. What does the trade do to my roster, salary, cap, age, positional mix, and injury/minors exposure?

Impact Analysis is a later hitter-lineup feature. Its design prerequisites are recorded at the end of this document.

## Locked decisions

- [x] Use `You Give`, `You Get`, and `Net to You`; remove user-facing Side A/Side B result language.
- [x] Separate deal fairness from roster consequences.
- [x] Drops never affect dynasty fairness, scoring fairness, the source verdict, or the winner language.
- [x] Drops do affect roster count, cap usage, cap space, position mix, age, and later lineup impact.
- [x] Missing dynasty or scoring values never become silent zeroes.
- [x] A missing value invalidates only the affected metric's conclusion.
- [x] MiLB scoring is identified as intentionally excluded/not applicable, not as a data-fetch failure.
- [x] Full-coverage dynasty sources determine the authoritative source verdict and range.
- [x] Partial source estimates may be displayed, but never counted in favor/even/oppose totals or the official range.
- [x] Available-player salary is unknown (`Bid TBD`), not `$0`.
- [x] The default table is a compact Core GM view; Full Stats is optional.
- [x] Dynasty source spread remains visible in Core view.
- [x] Trade calculations move to a small testable module; the main React markup may remain in `App.tsx`.
- [x] Immediate implementation is frontend-only unless an unexpected blocker proves otherwise.
- [x] No Impact Analysis button ships during this scope.

## Current implementation landmarks

- `frontend/src/App.tsx`
  - `TradePlayerRow`
  - `TradeAnalyzerWorkspace`
  - `TradeSidePanel`
  - `TradeSelectedList`
  - `buildTradeRows`
  - `buildAvailableTradeRows`
  - `buildTradeBlockRows`
  - `tradeTotal`
  - `tradeResult`
  - `scoringTradeResult`
  - `fetchOptimalLineup`
  - `optimizeBestCaseLineup`
  - `buildPositionStrengthRows`
  - `RosterStatusBadge` / `rosterAvailabilities`
- `frontend/src/App.css`
  - `.trade-side-grid`
  - `.trade-table-wrap`
  - `.trade-player-table`
  - `.check-col`
  - `.player-col`
  - `.trade-side-diffs`
  - `.trade-balance-*`
- `frontend/src/types.ts`
  - `AggregatePlayer.age`
  - `LeagueRosterPlayer`
  - `LeagueTradeBlockPlayer`
  - `LeagueAvailablePlayerStats`
  - `BoardSource`
- `backend/app/main.py` and `supabase/functions/optimal-lineup/index.ts`
  - Existing team-based Optimal Lineup endpoints; relevant only to the queued Impact Analysis phase.

---

## Phase 0 - Baseline and implementation safety

- [x] Confirm the working tree and preserve unrelated user changes.
- [x] Capture the current Trade screen at desktop, typical laptop, tablet, and 390px phone widths.
- [x] Record the currently selected league/team used for manual verification.
- [x] Record one normal team-to-team test package.
- [x] Record one Trade Block test package.
- [x] Record one Available-player test package.
- [x] Identify current examples of:
  - [x] A player with IL status.
  - [x] A MiLB player.
  - [x] A player missing a scoring value.
  - [x] A player missing one or more individual dynasty-source ranks.
- [x] Confirm the Pitchers screen renders before shared row-model changes.
- [x] Confirm whether a frontend unit-test runner already exists; add Vitest only if needed.

Phase 0 evidence:

- Baseline date: 2026-08-05
- Test league/team: Aspromonte / Uncle Charlie's Angels
- Screenshots or notes: `docs/trade-analyzer-baseline/README.md`
- Existing issues observed: Wide tables require heavy internal horizontal scrolling even at 1600px; Owner repeats the panel team; Available salary displays as `$0`; Edward Cabrera combines IL, MiLB, missing scoring value, and partial dynasty-source coverage.

---

## Phase 1 - Trade row and source data model

### 1.1 Add pure trade-analysis types

- [x] Create `frontend/src/tradeAnalysis.ts`.
- [x] Define `TradeSourceValue` with:
  - [x] `sourceId`
  - [x] `sourceName`
  - [x] `shortName`
  - [x] `sourceTag`
  - [x] `sourceDate`
  - [x] `rank`
  - [x] `value`
- [x] Define `TradeAvailabilityCode` as `il | minors | susp`.
- [x] Move or define the pure trade total/result types in this module.

### 1.2 Extend `TradePlayerRow`

- [x] Add `age: number | null` from the matched `AggregatePlayer`.
- [x] Add `ownerTeamUid: string | null` for later Trade Block Impact Analysis.
- [x] Change salary handling so Available players can have unknown salary.
- [x] Add `availabilityCodes` derived from the existing roster availability helper.
- [x] Preserve IL, MiLB, and suspended statuses.
- [x] Add `seasonPoints: number | null` and keep it separate from P/G and P/IP.
- [x] Add `sourceValues: TradeSourceValue[]`.
- [x] Derive source count from `sourceValues.length` rather than storing duplicate state.
- [x] Derive player source minimum, maximum, and spread from `sourceValues`.
- [x] Preserve aggregate dynasty value as the consensus value even when individual source coverage is incomplete.

### 1.3 Correct Available-player semantics

- [x] Stop placing `points_per_game` in the season-points field.
- [x] Display Available salary as `Bid TBD`/unknown rather than `$0`.
- [x] Suppress Available salary-surplus and cap conclusions until an acquisition salary is known.
- [x] Keep dynasty/scoring values available where their underlying ranks exist.

### 1.4 Consolidate row builders

- [x] Extract a shared `toTradeRow()` helper.
- [x] Keep thin wrappers for normal roster, Available, and Trade Block rows.
- [x] Pass allowed `BoardSource` metadata instead of only source IDs.
- [x] Preserve normal roster owner team UID/name.
- [x] Preserve Trade Block owner team UID/name.
- [x] Preserve Available ownership as unrostered.
- [x] Update the shared Pitchers call site.
- [x] Confirm the added fields remain inert and harmless for `PitcherDisplayRow`.

Phase 1 evidence:

- Files changed: `frontend/src/App.tsx`, `frontend/src/tradeAnalysis.ts`, `docs/TRADE_ANALYZER_TODO.md`.
- Type/build result: `npm --prefix frontend run build` passed on 2026-08-05 (`tsc` plus Vite production bundle).
- Trade regression result: Aspromonte / Uncle Charlie's Angels rendered Available players with `Bid TBD`, separate season points and rate, no salary surplus, and a pending cap conclusion after selecting Cole Ragans. Trade Block rows retained visible owner names.
- Pitchers regression result: Aspromonte / Uncle Charlie's Angels rendered 20 pitchers, all three plan groups, and populated value/range columns after the shared builder change.
- Commit/deployment result: feature commit `2b0b43e9638cceec0f19203afa5c0c347fead9f4` pushed to `github-pages-supabase`; GitHub Pages run `31042942534` succeeded; the live Trade screen displayed the Phase 1 Available-player semantics.

---

## Phase 2 - Separate deal fairness from roster consequences

### 2.1 Define explicit inputs

- [x] Treat these collections independently:
  - [x] Players you give.
  - [x] Players you get.
  - [x] Players you drop.
  - [x] Players the opponent drops.
  - [x] Cash you send.
  - [x] Cash you receive.

### 2.2 Deal totals

- [x] Calculate dynasty value given from outgoing players plus cash sent.
- [x] Calculate dynasty value received from incoming players plus cash received.
- [x] Calculate dynasty net to you as received minus given.
- [x] Apply the same structure to scoring value.
- [x] Calculate player dynasty surplus as dynasty value minus known salary.
- [x] Calculate player scoring surplus as scoring value minus known salary.
- [x] Show cash as its own line instead of hiding it inside player totals.
- [x] Keep current one-dollar cash-to-value treatment unless the user changes it.
- [x] Exclude both teams' drops from all deal totals.

### 2.3 Roster and cap totals

- [x] Calculate salary change as incoming salary minus outgoing salary minus my drop salary.
- [x] Calculate cap-limit change as cash received minus cash sent.
- [x] Calculate roster-count change as incoming count minus outgoing count minus my drops.
- [x] Continue calculating the opponent's feasibility only for real team-to-team trades.
- [x] Keep opponent drops outside my net-to-me fairness result.
- [x] Preserve over-cap detection.

### 2.4 Missing and not-applicable values

- [x] Track known subtotal, missing count, and not-applicable count for each metric.
- [x] Do not coerce a missing dynasty value to zero.
- [x] Do not coerce a missing scoring value to zero.
- [x] Invalidate the dynasty verdict if any exchanged player's dynasty value is missing.
- [x] Invalidate the scoring verdict if a required scoring value is missing.
- [x] Distinguish MiLB scoring exclusion from an unexpected missing scoring value.
- [x] Display a known subtotal plus missing-player count when incomplete.
- [x] Do not show a winner/edge for an incomplete metric.

### 2.5 Even/close threshold

- [x] Use a consistent materiality threshold, initially `max($1, 5% of average package value)`.
- [x] Treat metric differences inside the threshold as effectively even.
- [x] Allow the dynasty source distribution to override confidence when its full-coverage range crosses zero.

Phase 2 evidence:

- Calculation examples: Joe Ryan given ($26.2 dynasty / $23.1 scoring) for Chase Burns received ($35.7 / $28.1) produced a full-source dynasty range crossing even and a $5.0 scoring net to me. With $2 sent and $3 received, player values stayed separate while package totals became $28.2 vs. $38.7 dynasty and $25.1 vs. $31.1 scoring; my cap limit moved from $387 to $388.
- Drop-isolation result: adding Peter Lambert as my drop left the complete result snapshot unchanged while salary change became +$2 and roster change became -1. Adding Juan Soto as the opponent drop also left fairness unchanged while the opponent's projected cap and roster consequences updated.
- Missing-value result: Luis Hernandez displayed `$0 known + 1 missing` and disabled only the scoring conclusion. Edward Cabrera displayed `$0 known + 1 MiLB N/A`; dynasty still concluded and scoring explicitly excluded the MiLB player.
- Regression result: Available-player unknown salary still produced a pending cap conclusion with +1 roster spot; Pitchers still rendered 20 players and populated valuation columns.
- Commit/deployment result: feature commit `f144ff6776a2e3b2bac3a3f08c8ffb650bb6fd1c` pushed to `github-pages-supabase`; GitHub Pages run `31044253020` succeeded; live Joe Ryan/Chase Burns drop isolation, full-source confidence, and roster-change output passed.

---

## Phase 3 - Automated calculation tests

- [x] Add/configure a frontend unit-test runner if one is not already available.
- [x] Add a one-for-one trade-total test.
- [x] Add a multi-player package test.
- [x] Add cash-sent-by-me test.
- [x] Add cash-received test.
- [x] Verify selecting my drop does not change dynasty fairness.
- [x] Verify selecting my drop does not change scoring fairness.
- [x] Verify selecting my drop does not change the source verdict.
- [x] Verify drops do change roster count, salary, and cap results.
- [x] Verify opponent drops do not change my fairness result.
- [x] Verify missing dynasty value invalidates only dynasty.
- [x] Verify missing scoring value invalidates only scoring.
- [x] Verify MiLB scoring is excluded/not applicable rather than zero.
- [x] Verify Available salary is unknown.
- [x] Verify season points and rate remain separate.
- [x] Verify full source coverage totals.
- [x] Verify partial-source consensus substitution.
- [x] Verify partial sources are excluded from headline counts and official ranges.
- [x] Verify the even threshold.
- [x] Verify source-tag filters recompute source totals.

Phase 3 evidence:

- Test command: `npm --prefix frontend test` (`vitest run`).
- Test result: 2 test files and 15 tests passed on 2026-08-05, including 14 focused trade-analysis scenarios and the existing CSV export regression.
- CI result: `.github/workflows/deploy-pages.yml` now runs `npm test` after `npm ci` and before the production build.
- Build result: `npm --prefix frontend run build` passed after the test/source-coverage changes.
- Commit/deployment result: feature commit `3c44bcc9034304a0b01d23ebb554a6457808cb04` pushed to `github-pages-supabase`; GitHub Pages run `31045284083` passed `npm ci`, all tests, build, and deployment; live Trade and Pitchers smoke checks passed.

---

## Phase 4 - Rebuild the player-selection tables

### 4.1 Responsive panel layout

- [x] Label my roster panel `You Give`.
- [x] Label a normal opponent panel `You Get from [Team]`.
- [x] Label the Trade Block panel `Trade Block Targets`.
- [x] Label the Available panel `Available Pickups`.
- [x] Keep panels side by side only when both Core tables have usable width.
- [x] Stack panels into full-width sections around 1280-1400px, based on browser verification.
- [x] Do not wait until 980px to stack the wide tables.

### 4.2 Core table - 9 columns

- [x] Give/Get action.
- [x] Drop action.
- [x] Player.
- [x] Salary.
- [x] Dynasty Value.
- [x] Dynasty Surplus.
- [x] Dynasty Spread.
- [x] Scoring Value.
- [x] Scoring Surplus.

The Player cell must include:

- [x] Player name.
- [x] Position.
- [x] Age.
- [x] MLB team.
- [x] IL/MiLB/suspended tags.
- [x] Owner only when it adds information.

### 4.3 Full Stats - 13 columns

- [x] Add Dynasty Rank.
- [x] Add Scoring Rank.
- [x] Add season Points.
- [x] Add P/G or P/IP.
- [x] Keep source count inside the Dynasty Spread cell.
- [x] Confirm grouped-header `colSpan` values for both modes.

### 4.4 Table controls

- [x] Retain player search.
- [x] Retain position filter.
- [x] Retain source-group controls.
- [x] Retain sorting for meaningful columns.
- [x] Add Core / Full Stats toggle.
- [x] Add Clear Trade action.
- [x] Show selected-player counts.

### 4.5 Sticky columns and headers

- [x] Give/Get column width 44px and `left: 0`.
- [x] Drop column width 44px and `left: 44px`.
- [x] Player column uses `left: 88px`.
- [x] Use distinct action-column classes rather than one ambiguous `.check-col` offset.
- [x] Apply offsets to both header rows and body cells.
- [x] Give sticky cells explicit backgrounds and z-indexes.
- [x] Preserve selected/drop-selected row colors on sticky cells.
- [x] Use a sticky `<thead>` for the grouped header.

### 4.6 Virtualization

- [x] Finalize the rendered row height after the row design is complete.
- [x] Use the finalized 56px height for every non-spacer row.
- [x] Prevent player metadata and source plots from wrapping.
- [x] Exclude virtual spacer rows from fixed-height rules.
- [x] Update spacer and empty-state `colSpan` dynamically for Core/Full modes.
- [x] Verify no gaps, overlap, or jumps at virtual window boundaries.

### 4.7 Keep totals out of the browser table

- [x] Do not add a duplicate totals `<tfoot>` to the roster browser.
- [x] Keep totals in selected packages and the shared ledger only.

Phase 4 evidence:

- Desktop result: Core renders 9 columns and Full Stats renders 13 columns under correctly spanned Contract, Dynasty, and Scoring groups. Player rows show position, age, MLB team, status tags, and contextual Trade Block ownership; team-to-team Give/Get selection and Clear Trade passed locally and on Pages.
- Laptop/tablet result: at the verified 1280x720 viewport, the 1380px breakpoint stacks both panels at 1209px, Core fits without an inner horizontal scrollbar, Full Stats scrolls within its table, and document-level horizontal overflow is zero.
- Virtualization result: all non-spacer rows measured exactly 56px after scrolling 420px; rendered-window boundaries had no gaps or overlap; grouped headers stayed at the scrollport top; Give, Drop, and Player stayed frozen at 0px, 44px, and 88px after horizontal scrolling.
- Build/deployment result: `npm --prefix frontend test` passed 2 files / 15 tests; `npm --prefix frontend run build` passed; feature commit `8a0989bf5f46345e72d2e89a49ba6b18830d183a` deployed successfully in Pages run `31046193743`; the live Trade table, Full Stats mode, sticky offsets, selection counts, Clear Trade, and Pitchers smoke check passed.

---

## Phase 5 - Rebuild selected packages and roster moves

### 5.1 You Give and You Get package tables

- [x] Replace loose selected-player cards with compact tables.
- [x] Show player/status.
- [x] Show position/age.
- [x] Show salary or `Bid TBD`.
- [x] Show dynasty value.
- [x] Show dynasty surplus when salary is known.
- [x] Show dynasty source range.
- [x] Show scoring value.
- [x] Show scoring surplus when salary is known.
- [x] Add a direct Remove action.

### 5.2 Package totals

- [x] Player count.
- [x] Known salary and unknown-salary count.
- [x] Dynasty value.
- [x] Dynasty surplus.
- [x] Scoring value.
- [x] Scoring surplus.
- [x] Season points.
- [x] Average age.
- [x] Hitter/pitcher count.
- [x] IL count.
- [x] MiLB count.
- [x] Suspended count.
- [x] Do not total rank.
- [x] Do not total rate.
- [x] Do not total position labels.
- [x] Do not sum individual player spread widths.

### 5.3 Roster Moves Required

- [x] Create a separate block for my required drops.
- [x] Create opponent feasibility/drop information only when relevant.
- [x] Show each drop's salary and values surrendered.
- [x] Show position and status.
- [x] Label drops as outside the fairness calculation.
- [x] Show cuts required, cuts selected, and cuts remaining.

Phase 5 evidence:

- Package table result: a two-player Joe Ryan/George Kirby package showed 2 players, $41 salary, $48.7 dynasty value, +$7.7 dynasty surplus, $36.3 scoring value, -$4.7 scoring surplus, 1,133.93 season points, average age 29, 0 hitters / 2 pitchers, and zero IL/MiLB/suspended players. A Cole Ragans Available pickup showed `Bid TBD`, unavailable surpluses, the $3.3-$33.1 dynasty range, pitcher/IL composition, and `Not additive` instead of an invalid package spread total. Direct package removal cleared the source checkbox locally and live.
- Drop separation result: the Cole Ragans pickup produced a separate Your Required Cuts card with Required 1 / Selected 0 / Remaining 1; selecting Elly De La Cruz changed it to 1 / 1 / 0 and showed $49 salary, $51.3 dynasty value, and $26.6 scoring value surrendered without moving the fairness verdict. A two-for-one team trade showed Last Christmas feasibility only when that opponent needed a cut; selecting/removing Juan Soto likewise left the verdict unchanged.
- Test/build/deployment result: `npm --prefix frontend test` passed 2 files / 16 tests, including the new package composition totals; `npm --prefix frontend run build` passed; feature commit `4bf32863c9e5ac7e69eb98321ac2eecd1ef2ccf1` deployed in Pages run `31047325692`; live unknown-salary package totals, cut separation, direct removals, zero document overflow, and Pitchers smoke checks passed.

---

## Phase 6 - Build one GM-focused Trade Ledger

### 6.1 Remove duplicated comparison tiles

- [x] Remove `.trade-side-diffs` from both side panels.
- [x] Remove mirrored `comparisonTotal` difference calculations.
- [x] Keep side-specific cap/feasibility information where useful.

### 6.2 Shared ledger

- [x] Add columns: Metric / You Give / You Get / Net to You.
- [x] Add Players row.
- [x] Add Player Salary row.
- [x] Add Cash row.
- [x] Add Dynasty Value row.
- [x] Add Dynasty Surplus row.
- [x] Add Scoring Value row.
- [x] Add Scoring Surplus row.
- [x] Add Season Points row.
- [x] Add Average Age row.
- [x] Add IL row.
- [x] Add MiLB row.
- [x] Add roster-count/cap-space summary below the ledger.
- [x] Reuse signed-value styling, but do not communicate meaning by color alone.

### 6.3 GM result language

- [x] Remove user-facing `Side A Wins` and `Side B Wins` copy.
- [x] Produce a dynasty-specific conclusion.
- [x] Produce a scoring-specific conclusion.
- [x] Preserve split results.
- [x] Produce explicit incomplete-data language.
- [x] Produce explicit MiLB scoring-exclusion language.
- [x] Keep the no-selection prompt neutral and instructional.

Phase 6 evidence:

- Ledger arithmetic check: Joe Ryan for Chase Burns rendered You Give / You Get / Net to You as $15 / $18 / +$3 salary, $26.2 / $35.7 / +$9.5 dynasty value, $11.2 / $17.7 / +$6.5 dynasty surplus, $23.1 / $28.1 / +$5 scoring value, $8.1 / $10.1 / +$2 scoring surplus, 599.23 / 634.03 / +34.8 season points, and 30 / 23.1 / -6.9 years. Adding $3 cash given and $1 cash received changed the dynasty/scoring nets by -$2. Selecting Elly De La Cruz as an optional drop left the +$9.5 dynasty and +$5 scoring deal results unchanged while roster change, projected cap, cap space, and salary change updated.
- Result copy examples: no selections show `Build a Trade` with neutral instructions; Joe Ryan for Chase Burns shows `Split Result`, a dynasty full-source range crossing even, and `Favors You` for scoring; Edward Cabrera for Chase Burns shows `Both Views Favor You` while explicitly identifying the MiLB scoring exclusion; Tylor Megill for Chase Burns shows `Incomplete Data`, `Scoring Incomplete`, the known subtotal on each side, and one missing required value.
- Test/build/deployment result: `npm --prefix frontend test` passed 2 files / 17 tests; `npm --prefix frontend run build` passed; feature commit `bcad6b4631d7239cb0e1ae9096bdf5d8ac13934f` deployed successfully in Pages run `31048403197`. Live checks confirmed 11 ledger rows, no `.trade-side-diffs`, no user-facing Side A/Side B text, zero document overflow, drop isolation, incomplete-data handling, and a healthy 20-player Pitchers screen.

---

## Phase 7 - Dynasty source distributions

### 7.1 Per-player spread visualization

- [x] Draw a horizontal source range in the Dynasty Spread cell.
- [x] Plot one dot per allowed source ranking the player.
- [x] Plot the aggregate dynasty value as a larger consensus diamond.
- [x] Plot known salary as a reference tick.
- [x] Show numeric minimum and maximum.
- [x] Show source coverage count.
- [x] Tooltip/accessible label includes source, rank, value, tag, and date.
- [x] Do not rely on color alone to identify marker meaning.

### 7.2 Package source verdict

- [x] Replace the existing balance visualization with a centered net-to-you source chart.
- [x] For each source, calculate incoming source value plus cash received minus outgoing source value minus cash sent.
- [x] Exclude drops.
- [x] Plot negative net left of center and positive net right of center.
- [x] Plot full-coverage sources as filled dots.
- [x] Plot partial estimates as hollow/dim dots.
- [x] Plot aggregate consensus net as a larger diamond.

### 7.3 Coverage rules

- [x] Require every exchanged player to have that source rank for full coverage.
- [x] Use aggregate consensus substitution only to display optional partial estimates.
- [x] Include the number of missing players in partial-source tooltips.
- [x] Exclude partial estimates from favor/even/oppose counts.
- [x] Exclude partial estimates from the official source range.
- [x] Report favor/even/oppose counts.
- [x] Report full-coverage and partial-estimate counts.
- [x] If no source covers the full package, state that no package source verdict is available.
- [x] Remove the old summed per-player minimum/maximum package bands.

Phase 7 evidence:

- Per-player plot check: Elly De La Cruz rendered an eight-source horizontal range from $29.8 to $58.2, an aggregate-consensus diamond at $51.3, and a salary tick at $49. The Baseball America marker exposed `rank 5, $58.2, Continuous, Jun 26, 2026`; source dots, the consensus diamond, and salary tick have distinct shapes plus keyboard-focusable accessible labels. Tylor Megill's two-source plot likewise exposed each source's full metadata, and enabled-source filters recomputed the player dots.
- Package plot arithmetic check: Joe Ryan given for Chase Burns received produced eight full-coverage markers, a 7 favor you / 0 even / 1 favor partner headline, an official -$17.1 to +$19.1 full-source range, and +$9.5 aggregate consensus. Sending $3 while receiving $1 moved Baseball America's net from +$6.1 to +$4.1, consensus from +$9.5 to +$7.5, and the official range to -$19.1 to +$17.1. Selecting Elly De La Cruz as a drop left every source verdict value unchanged.
- Coverage check: Edward Cabrera for Chase Burns displayed six filled full-coverage markers and two hollow partial estimates, while the headline counted only the six full sources. Dynatyze's +$25.3 partial tooltip reported coverage of 1 of 2 exchanged players and one aggregate-consensus substitution. Automated and browser checks covered the no-full-source state, which reports `No package source verdict is available` and no official range.
- Test/build/deployment result: `npm --prefix frontend test` passed 2 files / 19 tests; `npm --prefix frontend run build` passed; feature commit `0277bfc0a43cf6a8d8f0a2c211744482419c2450` deployed successfully in Pages run `31049665976`. Live checks confirmed the per-player plots, package chart, drop isolation, partial estimates, zero document overflow, no console errors, and a healthy 20-player Pitchers screen.

---

## Phase 8 - Responsive design and accessibility

### 8.1 Desktop and tablet

- [x] Verify side-by-side panels only at a genuinely usable width.
- [x] Verify stacked full-width panels at typical laptop/tablet widths.
- [x] Verify package comparison and ledger layout.

### 8.2 Mobile at 390px

- [x] Default to Core view.
- [x] Stack all major sections.
- [x] Keep table-local horizontal scrolling.
- [x] Prevent body-level horizontal overflow.
- [x] Keep Give/Get, Drop, and Player sticky.
- [x] Preserve Dynasty Spread in Core view.
- [x] Convert the ledger to readable stacked rows/cards if necessary.

### 8.3 Accessibility

- [x] Contextual checkbox labels (`Give`, `Get`, `Drop` plus player name).
- [x] Keyboard-accessible Core/Full controls.
- [x] Keyboard-accessible source controls.
- [x] Visible focus styles on sticky controls.
- [x] Source charts have textual counts/ranges and accessible labels.
- [x] Signed numbers include visible plus/minus characters.
- [x] Result language does not rely on red/green color.
- [x] Respect reduced-motion preferences.

Phase 8 evidence:

- 390px overflow measurement: the pre-fix exact-width harness measured a 375px document client width and 780px document scroll width, with the 720px ledger forcing a 405px page overflow. After the responsive changes, both the empty and populated trade states measured 375px client/scroll width with zero body overflow. The player table remained a local 326px/1030px scroller, the selected-package table a local 315px/950px scroller, and Full Stats a local 1310px scroller. At `scrollLeft=400`, the 36px Give/Get column, 36px Drop column, and 205px Player column remained sticky while Dynasty Spread stayed present in Core.
- Breakpoint/layout measurement: 768px, 1366px, and 1699px all rendered one full-width trade-side column with zero document overflow; 1700px was the first side-by-side width and produced two 806.5px panels. At 1920px, the 1800px shell produced two 864px panels. At 1366px the 1255px package comparison and ledger fit without local scrolling, and the two perspective cards were 623.5px each.
- Accessibility notes: Give/Get/Drop controls retain player-specific labels; Core/Full and source segments are native buttons with `aria-pressed`; player, package, roster-move, and ledger scrollers are keyboard focusable and named; sticky table controls and scrollers have visible focus outlines. Player and package source charts retain textual counts/ranges plus keyboard-focusable source labels, signed results expose literal plus/minus characters, and the verdict copy states gain/loss/even independently of color. The reduced-motion media query now suppresses animation and transition duration globally.
- Validation/deployment: `npm --prefix frontend test` passed 2 files / 19 tests, `npm --prefix frontend run build` passed, and `git diff --check` passed. Feature commit `ef26306bde5446d5fddff9beea2f28d4c1b9125b` deployed successfully in Pages run `31051454799`. The live Trade screen confirmed the 1800px shell, stacked 1265px layout, Core default, accessible ledger, working package/ledger update, zero document overflow, and a clean browser console.

---

## Phase 9 - Final verification, delivery, and live validation

### 9.1 Automated checks

- [x] Run frontend trade-analysis unit tests.
- [x] Run `npm --prefix frontend run build`.
- [x] Run `git diff --check`.
- [x] Run any additional focused checks required by shared Pitchers changes.

### 9.2 Browser checks

- [x] Core shows 9 columns with correct grouped headers.
- [x] Full Stats shows 13 columns with correct grouped headers.
- [x] Age, position, salary, values, and tags populate.
- [x] Available players show `Bid TBD`.
- [x] Sticky columns do not overlap.
- [x] Virtual scrolling has no gaps or overlap.
- [x] Source-tag changes recompute player and package plots.
- [x] Every ledger net equals You Get minus You Give.
- [x] Selecting a drop does not move either fairness verdict or the source chart.
- [x] Drops do update cap and roster consequences.
- [x] Missing values produce incomplete conclusions.
- [x] MiLB players receive scoring-exclusion wording.
- [x] Partial source dots are visually distinct and excluded from headline counts.
- [x] Trade Block rows preserve source team UID.
- [x] Pitchers screen still renders and sorts.
- [x] Clear Trade resets players, drops, and cash.
- [x] Browser console is clean.
- [x] No body overflow at desktop, laptop, tablet, or 390px.

### 9.3 Delivery

- [x] Review the scoped diff and preserve unrelated work.
- [x] Commit the completed Trade Analyzer changes.
- [x] Push `github-pages-supabase`.
- [x] Wait for the GitHub Pages deployment workflow.
- [x] Record the workflow run and result.
- [x] Verify the live Trade screen.
- [x] Recheck drop isolation, missing values, source dots, Pitchers, and mobile behavior live.
- [x] Record final commit and deployment evidence below.

Phase 9 evidence:

- Unit tests: `npm --prefix frontend test` passed 2 files / 19 tests. The focused trade suite covers package arithmetic, cash, drops, missing and not-applicable metrics, Available salary semantics, source coverage, partial estimates, source filtering, and materiality thresholds.
- Frontend build: `npm --prefix frontend run build` passed TypeScript and the Vite production bundle; `git diff --check` passed. The final worktree was clean after removing the temporary exact-width harness.
- Rendered regression: Core rendered 9 cells with Contract / Dynasty / Scoring groups and Full Stats rendered 13. Elly De La Cruz showed SS, age 24.1, $49 salary, $51.3 dynasty value, +$2.3 surplus, an eight-source $29.8-$58.2 spread, $26.6 scoring value, and -$22.4 scoring surplus. Available Cole Ragans showed `Bid TBD` and an IL tag. At a virtual scroll position of 4100px, 30 rendered rows stayed 56px tall with zero inter-row gaps and correctly sized before/after spacers.
- Deal/edge-case regression: Joe Ryan for Chase Burns reconciled every ledger row, including +$9.5 dynasty, +$5 scoring, +$3 salary, and +34.8 points. Removing Updated sources changed Elly and the package from eight to seven covered sources and restored correctly. Dropping Elly left the result and every source marker byte-for-byte unchanged while projected cap moved from $379 to $330 and the roster-move table showed $49 salary, $51.3 dynasty, and $26.6 scoring surrendered. Joe Ryan for A.J. Puk produced `Scoring Incomplete` with one missing value; Edward Cabrera for Chase Burns produced explicit MiLB N/A wording plus six authoritative dots and two hollow partial estimates.
- Workflow regression: Clear Trade reset all three selected checkboxes and both cash fields; Trade Block exposed 38 players with originating team names from distinct preserved owner team UIDs; Pitchers rendered all 20 pitchers across 13 SP/SP-leaning and 7 RP/RP-leaning rows, and Player sorting changed the first SP row from Joe Ryan to Connelly Early.
- Responsive regression: the 390px local and deployed frames both measured a 375px document client/scroll width with zero body overflow, stacked 343px panels, Core by default, and 326px/1030px local player-table scrolling. With a populated trade, both 315px package scrollers contained their 950px tables, the ledger rendered as a 317px block, perspective cards stacked at 305px, and the 341px source verdict stayed inside the page. Sticky Give/Get, Drop, and Player columns remained non-overlapping at x=17-53, 53-89, and 89-294 after `scrollLeft=420`; Dynasty Spread remained present in Core, and Full Stats expanded only the local scroller to 1310px.
- Commit: the final shipped code is feature commit `ef26306bde5446d5fddff9beea2f28d4c1b9125b`; Phases 1-8 were committed independently and the Phase 9 verification record is documentation-only.
- Push: `github-pages-supabase` and `origin/github-pages-supabase` were aligned before this final documentation commit; the Phase 9 record is pushed as its own `[skip ci]` commit.
- Pages run: `31051454799` completed successfully, including its required test, build, artifact, and deploy jobs.
- Live URL/result: `https://ampercival.github.io/fantasy-baseball-assistant-gm/#/trade` passed standard-trade arithmetic, drop isolation, missing-value, MiLB, partial-source, clean-console, Pitchers, and exact 390px populated-layout checks.

---

## Active Phase 10 - Trade Impact Analysis

Status: Active as of 2026-08-06. The user authorized the queued feature and expanded it to cover pitcher-plan impact across starting pitchers, the SP bubble, and relief pitchers. Implement one subphase at a time, with a scoped commit, push, deployment when code changes ship, and recorded evidence after each success.

### 10.0 Locked product decisions

- [x] Analyze the trade from the selected `My Team` GM perspective; do not build a mirrored opponent-impact report in the first version.
- [x] Add a real `Impact Analysis` action in the Trade result area, then show the analysis inline below the current fairness/roster results.
- [x] Hypothetical roster = current roster minus players given minus selected My Team drops plus players received.
- [x] Cash has no hitter-lineup or pitcher-role impact.
- [x] Disable analysis while the trade requires unresolved My Team cuts; explain how many cuts remain.
- [x] Recompute hitters through the existing optimal-lineup algorithm rather than estimating impact from trade values.
- [x] Compare pitchers in three plan buckets: confirmed SP, SP Bubble, and RP.
- [x] Use My Team's saved pitcher targets and manual usage overrides, while keeping observed FanGraphs usage visible in the result.
- [x] Rank/project pitcher buckets by current scoring value, then P/IP, then dynasty value as fallbacks; report when a fallback lowers confidence.
- [x] Use a clearly labeled P/G-only estimate for Available hitters when P/G exists; otherwise identify that both team wRC+ and P/G are unavailable.
- [x] Use position eligibility as a lower-confidence usage fallback for Available pitchers.
- [x] Exclude MiLB players from current MLB lineup/bucket gains and say so explicitly.
- [x] No new backend preview endpoint is required for the initial version; assemble the hypothetical roster client-side from existing cached endpoints and trade rows.

### 10.1 Pure impact model and tests

- [x] Add a focused `frontend/src/tradeImpact.ts` domain module rather than expanding calculation logic inline in `App.tsx`.
- [x] Reuse/export the existing optimal-lineup algorithm and metric helpers without maintaining a second optimizer.
- [x] Assemble hypothetical rosters by stable `player_key`, deduplicating incoming rows and deterministically removing outgoing players and selected drops.
- [x] Preserve full Optimal Lineup rows for rostered hitters; synthesize only the missing Available-player fields required for the P/G-only path.
- [x] Compute hitter before/after summaries: filled slots, 12-position P/G, season points, average wRC+, average starter age, bench count, and average bench P/G.
- [x] Compute hitter movement sets: new starters, displaced starters, starter-to-bench, bench-to-starter, roster exits, roster arrivals, and changed position assignments.
- [x] Compute position deltas: starter tier/score, depth tier/score, strongest, weakest, deepest, and thinnest before/after.
- [x] Project pitcher buckets from My Team's configured targets: top `spTarget - bubbleTarget` SP/SP-leaning arms, next `bubbleTarget` SP candidates, and top `rpTarget` RP/RP-leaning arms.
- [x] Preserve My Team manual usage overrides; incoming rostered pitchers use observed usage, and Available pitchers use explicit eligibility fallback.
- [x] Compute pitcher bucket summaries: filled slots, average P/IP, season points, scoring value, dynasty value, and unavailable-metric counts.
- [x] Compute pitcher movement sets: enters bucket, leaves bucket, moves between confirmed SP/Bubble/RP, roster exit, and roster arrival.
- [x] Add focused Vitest coverage for hitter eligibility/position reassignment, MiLB exclusion, drops, Available P/G-only rows, pitcher displacement, bubble movement, RP movement, usage overrides, missing metrics, and deterministic tie-breaking.

Phase 10.1 evidence:

- Shared optimizer: moved the existing pure optimal-lineup algorithm and display/position metric helpers into `frontend/src/optimalLineup.ts`; `App.tsx` now imports that module, so Trade Impact and Optimal Lineup use one implementation.
- Hitter model: `frontend/src/tradeImpact.ts` assembles the hypothetical MLB roster by `player_key`, preserves full rostered rows, supplies a labeled P/G-only Available path, recomputes before/after snapshots, and reports lineup, bench, player-movement, and position-strength deltas.
- Pitcher model: the same module applies saved targets and manual/observed/eligibility role precedence, projects Confirmed SP / Bubble / RP buckets, uses scoring value then P/IP then dynasty value ordering, and reports aggregate, confidence, roster, and bucket movements.
- Automated validation: `npm --prefix frontend test` passed 3 files / 33 tests, including 14 focused Trade Impact scenarios; `tsc -p frontend/tsconfig.json --noEmit`, `npm --prefix frontend run build`, and `git diff --check` passed.
- Regression validation: local and deployed Optimal Lineup remained at 22 MLB hitters, 13/13 filled slots, 63.7 12-position P/G, 5,920.97 lineup points, and 118.2 average wRC+. Deployed Pitchers remained at 20 pitchers, 13 SP/SP-leaning, 7 RP/RP-leaning, 5 selected starters, 5 bubble arms, and 5 relievers. Both live pages had zero body overflow and no console warnings/errors.
- Delivery: feature commit `d7e3f42f71f3acf85e6b19f5fce4e4a50d631949` is pushed to `github-pages-supabase`; Pages run `31111790433` passed test, build, artifact, and deploy jobs.

### 10.2 Cached data loading and action state

- [x] Reuse `OPTIMAL_LINEUP_CACHE` for My Team and each unique incoming owner team.
- [x] Reuse `PITCHER_USAGE_CACHE` for My Team and each unique incoming owner team.
- [x] Load My Team's persisted pitcher plan for targets and usage overrides without mutating it.
- [x] Normal team trade: fetch/cache the selected partner once and map only received players into the hypothetical roster.
- [x] Trade Block: group received players by preserved `ownerTeamUid` and fetch each unique source team once.
- [x] Available hitters: synthesize a P/G-only optimizer row from `available_player_stats` when P/G exists, and display player-specific limited-data wording when it does not.
- [x] Available pitchers: derive an eligibility bucket, display usage confidence as unavailable, and never imply observed FanGraphs usage exists.
- [x] Handle a selected player missing from owner Optimal Lineup or Pitcher Usage data with a player-specific incomplete-data warning rather than silently dropping the player.
- [x] Add `idle`, `loading`, `ready`, and `error` action states.
- [x] Fingerprint league, team, players given/received, and My Team drops; mark an existing result stale or clear it when the proposal changes.
- [x] Keep analysis user-triggered so changing checkboxes does not issue background owner-team requests.

Phase 10.2 evidence:

- Cached loading: `frontend/src/tradeImpactData.ts` reuses the existing Optimal Lineup and Pitcher Usage cache keys for My Team plus each unique incoming owner team; normal and multi-owner Trade Block packages fetch each team once and map only selected incoming players.
- Edge cases: Available hitters use explicit P/G-only rows, Available pitchers use eligibility without claiming observed usage, and missing owner-team player rows produce named warnings plus lower-confidence fallbacks instead of silent omission.
- Pitcher plan: each user-triggered run loads and normalizes a fresh immutable copy of My Team's persisted targets and usage overrides; selected-player lists are not mutated.
- Action state: `frontend/src/useTradeImpactAnalysis.ts` provides idle/loading/ready/error states, request cancellation, deterministic league/team/player/drop fingerprints, stale-result marking, and a user-triggered `run()` boundary. Proposal checkbox changes perform no owner-team loading.
- Automated validation: `npm --prefix frontend test` passed 4 files / 42 tests, including nine focused cache, normal-trade, Trade Block, Available, missing-data, fingerprint, stale, reset, and error scenarios. TypeScript, the production build, and `git diff --check` passed.
- Local browser regression: selecting `Drop Elly De La Cruz` and `Get Caden Scarborough` produced zero Optimal Lineup, Pitcher Usage, or Pitcher Plan resource requests; no placeholder Impact Analysis button appeared; Trade, Optimal Lineup, and Pitchers had zero body overflow and no console warnings/errors.
- Delivery: feature commit `f74e7fb3951ca0d894cd367e78552fc32f6f488e` is pushed to `github-pages-supabase`. Run `31117252776` rebuilt, tested, and uploaded the artifact successfully, but its deploy-only retry remained queued while GitHub officially reported major Actions and Pages outages. Per user direction, live verification is deferred without blocking Phase 10.3.

### 10.3 Hitter impact UI

- [x] Place the `Impact Analysis` button with the result actions and include a concise disabled-state explanation when cuts or selections are unresolved.
- [x] Lead with a GM headline such as lineup P/G gained/lost and the number of starter changes.
- [x] Render a compact Before / After / Delta metric ledger with signed deltas.
- [x] Render starter movement cards with player, old/new slot, P/G, wRC+, age, and status tags.
- [x] Distinguish a true displaced starter from an outgoing player who simply leaves the roster.
- [x] Render position upgrades/downgrades and depth gains/losses without requiring the full Optimal Lineup table.
- [x] Explain catcher tandem behavior and any unfilled slots consistently with the existing Optimal Lineup screen.
- [x] Link or route to Optimal Lineup for the full underlying roster view.

Phase 10.3 evidence:

- Action and state: the result heading now owns the real `Impact Analysis` action. Empty proposals explain that a player must be selected; Available-player additions remain disabled until the exact required cut count is satisfied; loading, error, rerun, stale, and reset states are visible without relying on color.
- GM result: the inline hitter panel leads with optimal-lineup P/G and starter-change count, then reconciles Before / After / Delta rows for 12-position P/G, filled slots, season points, average wRC+, starter age, bench count, and bench P/G. It also names strongest/weakest/deepest/thinnest positions before and after.
- Player and position decisions: movement cards name promoted/displaced starters, incoming depth, outgoing players, and cuts separately with old/new role or slot, P/G, wRC+, age, and roster status. Position cards show starter and depth tier/score changes; the footer repeats the optimizer's shared 162-game catcher cap and explicit unfilled-slot behavior.
- Browser calculations: Elly De La Cruz for Jo Adell produced `You lose 2.13 optimal lineup P/G with 1 starter change`, promoted Chase Meidroth from bench to SS, labeled Elly `Given away`, kept Jo Adell as incoming depth, and moved SS starter strength from Strong to Solid (-28.36). Justin Crawford as the required cut for Available Yainer Diaz left 63.67 lineup P/G unchanged, improved bench P/G by +0.08, labeled the cut and incoming depth separately, and stated that neither wRC+ nor P/G was available for Yainer.
- Workflow regression: changing the proposal retained the old analysis with a `Proposal changed` warning and no silent reinterpretation; Clear Trade removed the analysis; `Open Optimal Lineup` routed to `#/optimal-lineup`. A clean rerun with Available Brent Rooker rendered without console warnings/errors.
- Responsive regression: at the 390px override, the document client and scroll widths both measured 375px; the action stack, 341px impact panel, full-width Optimal Lineup link, and single-column movement/position cards stayed inside the page.
- Automated validation: `npm --prefix frontend test` passed 4 files / 42 tests; focused TypeScript, `npm --prefix frontend run build`, and `git diff --check` passed.
- Delivery: feature commit `2cb8c1f7c8a387664a388d27ad6c382199b51bf8` is pushed to `github-pages-supabase`. Pages run `31121909223` was queued while GitHub officially reported major Actions and Pages outages; local success is authoritative for continuing to Phase 10.4, and live verification remains deferred.

### 10.4 Pitcher impact UI

- [ ] Give Confirmed SP, SP Bubble, and RP their own Before / After / Delta cards.
- [ ] Show slot counts plus average P/IP, season points, scoring value, and dynasty value for each bucket.
- [ ] List incoming pitchers who enter the plan and incumbents they displace.
- [ ] Show movements between confirmed SP and Bubble separately from roster exits.
- [ ] Display effective role, observed role, and a manual-override marker where relevant.
- [ ] Flag missing usage/scoring information and eligibility fallbacks at player and section level.
- [ ] Link or route to Pitchers so the GM can revise targets or manual usage overrides, then rerun the analysis.

### 10.5 Responsive design and accessibility

- [ ] Keep the impact result inline and readable at desktop, typical laptop/tablet, and 390px mobile.
- [ ] Stack Before / After / Delta cards on mobile without body-level overflow.
- [ ] Make loading, error, stale, disabled, and ready states understandable without color alone.
- [ ] Provide accessible button names, section headings, signed delta text, table/card labels, and visible keyboard focus.
- [ ] Respect reduced motion and avoid chart animation as the only indication of change.

### 10.6 Validation, delivery, and acceptance

- [ ] Run focused impact tests plus the complete frontend test suite.
- [ ] Run `npm --prefix frontend run build` and `git diff --check`.
- [ ] Browser-check a hitter-only trade, pitcher-only trade, mixed trade, selected drop, unresolved cut, Trade Block, Available target, MiLB target, missing-data target, and Clear Trade.
- [ ] Verify hitter metrics and movement sets by hand against the existing Optimal Lineup screen.
- [ ] Verify pitcher buckets by hand against the saved Pitchers targets, usage roles, and overrides.
- [ ] Verify no body overflow and usable impact cards at 390px.
- [ ] Verify the browser console is clean.
- [ ] Commit and push each successful subphase to `github-pages-supabase`.
- [ ] Wait for each code deployment and verify the live Trade, Optimal Lineup, and Pitchers screens.
- [ ] Record commits, workflow runs, calculations, limitations, and live evidence in this TODO.

Phase 10 acceptance criteria:

- [ ] A GM can run one analysis and understand how the proposed trade changes both the optimal hitter lineup and the planned pitching staff.
- [ ] Hitter results are produced by the same optimizer used on the Optimal Lineup screen.
- [ ] Pitcher results separately explain confirmed SP, Bubble, and RP changes.
- [ ] Incoming and displaced players are named, not hidden behind aggregate totals.
- [ ] Drops affect the hypothetical roster while cash does not.
- [ ] MiLB, Available, missing-data, and usage-fallback limitations are explicit.
- [ ] Changing the trade cannot leave a silently stale result on screen.
- [ ] The feature remains usable and accessible at 390px.

---

## Acceptance criteria

The immediate Trade Analyzer work is complete only when all of these are true:

- [x] A GM can see player name, position, age, salary, status, dynasty value/surplus/spread, and scoring value/surplus without opening another screen.
- [x] Core view remains usable at normal laptop widths and 390px mobile.
- [x] Source dots show how individual evaluators value each player.
- [x] Package source dots use coherent source-level package totals.
- [x] Drops cannot alter the trade fairness verdict.
- [x] Missing values cannot silently alter a package total.
- [x] MiLB scoring exclusions are explicit.
- [x] Available players do not appear to have a known $0 salary.
- [x] There is one authoritative Net-to-You ledger.
- [x] Dynasty and scoring conclusions remain separate.
- [x] Roster and cap consequences remain distinct from fairness.
- [x] Pitchers screen remains healthy.
- [x] Frontend tests/build pass.
- [x] Live Pages deployment is verified.
- [x] Impact Analysis remains queued and absent from the shipped UI.

## Decision log

| Date | Decision | Reason | Approved by |
|---|---|---|---|
| 2026-08-05 | Adopt the locked decisions in this TODO. | Consolidated GM-focused Trade Analyzer plan. | User |
| 2026-08-06 | Activate Phase 10 with hitter and pitcher impact. | The user authorized the queued item and specified pitcher impact across starters, the bubble, and RP. | User |

## Progress log

| Date | Session/commit | Work completed | Validation/evidence | Next unchecked item |
|---|---|---|---|---|
| 2026-08-05 | Planning | Detailed TODO created; implementation not started. | `docs/TRADE_ANALYZER_TODO.md` | Phase 0 baseline |
| 2026-08-05 | Phase 0 | Baseline captured; fixtures, responsive measurements, edge-case players, Pitchers health, and test-runner status recorded. | `docs/trade-analyzer-baseline/README.md`; four viewport PNGs; browser console clean | Phase 1.1 trade-analysis types |
| 2026-08-05 | Phase 1 / `2b0b43e` | Added the shared trade row/source model, corrected Available salary and points semantics, consolidated row builders, and updated Pitchers. | Production build passed; Trade, Available, Trade Block, and Pitchers browser regressions passed; Pages run `31042942534` succeeded and live Trade verification passed. | Phase 2.1 explicit deal inputs |
| 2026-08-05 | Phase 2 / `f144ff6` | Separated deal fairness from drops/cap consequences, added explicit known/missing/N/A metric totals, coherent full-source confidence, and materiality thresholds. | Manual Joe Ryan/Chase Burns arithmetic, both-side drop isolation, cash, missing scoring, MiLB exclusion, Available salary, and Pitchers regressions passed; Pages run `31044253020` and live drop isolation passed. | Phase 3 automated calculation tests |
| 2026-08-05 | Phase 3 / `3c44bcc` | Added Vitest, 14 trade-analysis scenarios, partial-source consensus estimates, and a required test step in the Pages workflow. | `npm test`: 2 files / 15 tests passed; Pages run `31045284083` passed tests/build/deploy; live Trade and Pitchers smoke checks passed. | Phase 4 player-selection tables |
| 2026-08-05 | Phase 4 / `8a0989b` | Rebuilt the player browser into Core and Full Stats GM views with grouped headers, contextual metadata, source spread, early panel stacking, frozen action/player columns, selected counts, and Clear Trade. | Tests/build passed; 1280px responsive and virtual-window geometry verified; Pages run `31046193743` and live interaction smoke checks passed. | Phase 5 selected packages and roster moves |
| 2026-08-05 | Phase 5 / `4bf3286` | Replaced loose selected cards with GM package tables and reusable package composition totals; separated my cuts and opponent feasibility into an explicitly non-fairness roster-moves section with direct removal. | 2 files / 16 tests and build passed; known/unknown salary packages, totals, cut isolation, live removal, Pages run `31047325692`, and Pitchers passed. | Phase 6 shared Trade Ledger |
| 2026-08-05 | Phase 6 / `bcad6b4` | Replaced mirrored comparison tiles with one GM-focused Trade Ledger, corrected all results to the selected-team perspective, and added dynasty/scoring-specific, split, incomplete, MiLB, and neutral result language. | 2 files / 17 tests and build passed; ledger arithmetic, cash, drop isolation, missing-value copy, zero overflow, live Pages run `31048403197`, and Pitchers passed. | Phase 7 dynasty source distributions |
| 2026-08-05 | Phase 7 / `0277bfc` | Added per-player source-range plots and replaced the summed package bands with a centered net-to-you source verdict chart, authoritative coverage counts, partial estimates, consensus, salary references, and accessible source metadata. | 2 files / 19 tests and build passed; player/package arithmetic, cash, drops, coverage, live Pages run `31049665976`, console, overflow, and Pitchers passed. | Phase 8 responsive design and accessibility |
| 2026-08-05 | Phase 8 / `ef26306` | Made trade panels responsive from 390px through wide desktop, constrained wide package tables to local scrollers, converted the mobile ledger to readable cards, and added pressed-state, focus, scroller, and reduced-motion accessibility support. | Exact-width 390/768/1366/1699/1700/1920 checks passed; 2 files / 19 tests and build passed; live Pages run `31051454799`, selection/ledger update, zero overflow, and console passed. | Phase 9 final verification and delivery |
| 2026-08-05 | Phase 9 / final verification | Completed the full automated, rendered, edge-case, responsive, shared-Pitchers, deployment, and acceptance regression matrix; no product-code changes were required. | 19 tests/build/diff passed; exact-width and live checks passed; final shipped code `ef26306`; Pages run `31051454799`; clean worktree and live console. | Phase 10.1 pure impact model and tests |
| 2026-08-06 | Phase 10.0 planning | Activated Impact Analysis and locked the client-side optimal-hitter plus confirmed-SP/Bubble/RP architecture, edge-case behavior, incremental implementation phases, and acceptance criteria. | Reviewed current Optimal Lineup optimizer/cache, Trade owner-team data, Pitcher Usage cache, persisted Pitcher Plan targets/overrides, and Available-player limitations. | Phase 10.1 pure impact model and tests |
| 2026-08-06 | Phase 10.1 / `d7e3f42` | Extracted the shared optimal-lineup engine and added pure hitter and Confirmed SP/Bubble/RP trade-impact projections with movements, confidence, and edge-case handling. | 3 files / 33 tests, TypeScript, build, diff check, local regressions, Pages run `31111790433`, and live Optimal Lineup/Pitchers checks passed. | Phase 10.2 cached data loading and action state |
| 2026-08-06 | Phase 10.2 / `f74e7fb` | Added cached multi-owner impact loading, immutable persisted-plan reads, named data fallbacks, proposal fingerprints, stale/error states, and a network-free proposal controller. | 4 files / 42 tests, TypeScript, build, local request audit, overflow, and console passed; Pages run `31117252776` artifact passed while deployment remained queued during the official GitHub outage. | Phase 10.3 hitter impact UI |
| 2026-08-06 | Phase 10.3 / `2cb8c1f` | Added the real hitter Impact Analysis action, GM headline, Before/After/Delta ledger, named lineup movements, position/depth changes, limited-data messaging, and Optimal Lineup handoff. | 4 files / 42 tests, TypeScript, build, desktop and 390px browser scenarios, stale/reset states, exact movement labels, overflow, and clean console passed; Pages run `31121909223` queued during the official GitHub outage. | Phase 10.4 pitcher impact UI |
