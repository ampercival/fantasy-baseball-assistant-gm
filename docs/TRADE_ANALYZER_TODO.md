# Trade Analyzer GM Workflow TODO

Status: In progress - Phase 6 complete

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
- [ ] No Impact Analysis button ships during this scope.

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

- [ ] Draw a horizontal source range in the Dynasty Spread cell.
- [ ] Plot one dot per allowed source ranking the player.
- [ ] Plot the aggregate dynasty value as a larger consensus diamond.
- [ ] Plot known salary as a reference tick.
- [ ] Show numeric minimum and maximum.
- [ ] Show source coverage count.
- [ ] Tooltip/accessible label includes source, rank, value, tag, and date.
- [ ] Do not rely on color alone to identify marker meaning.

### 7.2 Package source verdict

- [ ] Replace the existing balance visualization with a centered net-to-you source chart.
- [ ] For each source, calculate incoming source value plus cash received minus outgoing source value minus cash sent.
- [ ] Exclude drops.
- [ ] Plot negative net left of center and positive net right of center.
- [ ] Plot full-coverage sources as filled dots.
- [ ] Plot partial estimates as hollow/dim dots.
- [ ] Plot aggregate consensus net as a larger diamond.

### 7.3 Coverage rules

- [ ] Require every exchanged player to have that source rank for full coverage.
- [ ] Use aggregate consensus substitution only to display optional partial estimates.
- [ ] Include the number of missing players in partial-source tooltips.
- [ ] Exclude partial estimates from favor/even/oppose counts.
- [ ] Exclude partial estimates from the official source range.
- [ ] Report favor/even/oppose counts.
- [ ] Report full-coverage and partial-estimate counts.
- [ ] If no source covers the full package, state that no package source verdict is available.
- [ ] Remove the old summed per-player minimum/maximum package bands.

Phase 7 evidence:

- Per-player plot check:
- Package plot arithmetic check:
- Coverage check:

---

## Phase 8 - Responsive design and accessibility

### 8.1 Desktop and tablet

- [ ] Verify side-by-side panels only at a genuinely usable width.
- [ ] Verify stacked full-width panels at typical laptop/tablet widths.
- [ ] Verify package comparison and ledger layout.

### 8.2 Mobile at 390px

- [ ] Default to Core view.
- [ ] Stack all major sections.
- [ ] Keep table-local horizontal scrolling.
- [ ] Prevent body-level horizontal overflow.
- [ ] Keep Give/Get, Drop, and Player sticky.
- [ ] Preserve Dynasty Spread in Core view.
- [ ] Convert the ledger to readable stacked rows/cards if necessary.

### 8.3 Accessibility

- [ ] Contextual checkbox labels (`Give`, `Get`, `Drop` plus player name).
- [ ] Keyboard-accessible Core/Full controls.
- [ ] Keyboard-accessible source controls.
- [ ] Visible focus styles on sticky controls.
- [ ] Source charts have textual counts/ranges and accessible labels.
- [ ] Signed numbers include visible plus/minus characters.
- [ ] Result language does not rely on red/green color.
- [ ] Respect reduced-motion preferences.

Phase 8 evidence:

- 390px overflow measurement:
- Accessibility notes:

---

## Phase 9 - Final verification, delivery, and live validation

### 9.1 Automated checks

- [ ] Run frontend trade-analysis unit tests.
- [ ] Run `npm --prefix frontend run build`.
- [ ] Run `git diff --check`.
- [ ] Run any additional focused checks required by shared Pitchers changes.

### 9.2 Browser checks

- [ ] Core shows 9 columns with correct grouped headers.
- [ ] Full Stats shows 13 columns with correct grouped headers.
- [ ] Age, position, salary, values, and tags populate.
- [ ] Available players show `Bid TBD`.
- [ ] Sticky columns do not overlap.
- [ ] Virtual scrolling has no gaps or overlap.
- [ ] Source-tag changes recompute player and package plots.
- [ ] Every ledger net equals You Get minus You Give.
- [ ] Selecting a drop does not move either fairness verdict or the source chart.
- [ ] Drops do update cap and roster consequences.
- [ ] Missing values produce incomplete conclusions.
- [ ] MiLB players receive scoring-exclusion wording.
- [ ] Partial source dots are visually distinct and excluded from headline counts.
- [ ] Trade Block rows preserve source team UID.
- [ ] Pitchers screen still renders and sorts.
- [ ] Clear Trade resets players, drops, and cash.
- [ ] Browser console is clean.
- [ ] No body overflow at desktop, laptop, tablet, or 390px.

### 9.3 Delivery

- [ ] Review the scoped diff and preserve unrelated work.
- [ ] Commit the completed Trade Analyzer changes.
- [ ] Push `github-pages-supabase`.
- [ ] Wait for the GitHub Pages deployment workflow.
- [ ] Record the workflow run and result.
- [ ] Verify the live Trade screen.
- [ ] Recheck drop isolation, missing values, source dots, Pitchers, and mobile behavior live.
- [ ] Record final commit and deployment evidence below.

Phase 9 evidence:

- Unit tests:
- Frontend build:
- Commit:
- Push:
- Pages run:
- Live URL/result:

---

## Queued Phase 10 - Impact Analysis (do not build yet)

Status: Queued until Phases 0-9 are complete.

### 10.1 Initial scope

- [ ] Add a real `Impact Analysis` action only when the feature is implemented.
- [ ] Label the initial feature as hitter-lineup impact.
- [ ] Compare the current optimal hitter lineup with a hypothetical post-trade lineup.
- [ ] Hypothetical roster = current roster minus players given minus selected drops plus players received.
- [ ] Cash has no lineup impact.
- [ ] Require all necessary cuts to be resolved before running.

### 10.2 Data strategy

- [ ] Reuse/cache my current Optimal Lineup response.
- [ ] For normal team-to-team trades, load/cache the opponent response.
- [ ] Merge selected incoming hitters client-side for the first team-to-team version.
- [ ] Use preserved `ownerTeamUid` values for Trade Block selections from multiple teams.
- [ ] Treat incoming MiLB players as having no current MLB lineup impact.
- [ ] Decide Available-player behavior before implementation:
  - [ ] Clearly labeled P/G-only estimate, or
  - [ ] Backend preview endpoint for complete metrics such as wRC+.
- [ ] Consider a backend preview endpoint later for shared caching and complete Available-player support.

### 10.3 Impact output

- [ ] Filled lineup slots before/after.
- [ ] Optimal lineup P/G before/after.
- [ ] Lineup season points before/after.
- [ ] Average wRC+ before/after.
- [ ] Average starter age before/after.
- [ ] Bench size and average bench P/G before/after.
- [ ] Strongest and weakest positions before/after.
- [ ] Deepest and thinnest positions before/after.
- [ ] New starters.
- [ ] Displaced starters.
- [ ] Players moving to the bench.
- [ ] Players leaving the roster.
- [ ] Changed position assignments.
- [ ] Position upgrades/downgrades.
- [ ] Depth gained/lost.

### 10.4 Explicit limitations

- [ ] Initial analysis is hitters only.
- [ ] Pitcher consequences remain in the Pitchers workflow until a separate pitcher-impact model exists.
- [ ] Clearly identify any P/G-only Available-player comparison as lower confidence.

---

## Acceptance criteria

The immediate Trade Analyzer work is complete only when all of these are true:

- [ ] A GM can see player name, position, age, salary, status, dynasty value/surplus/spread, and scoring value/surplus without opening another screen.
- [ ] Core view remains usable at normal laptop widths and 390px mobile.
- [ ] Source dots show how individual evaluators value each player.
- [ ] Package source dots use coherent source-level package totals.
- [ ] Drops cannot alter the trade fairness verdict.
- [ ] Missing values cannot silently alter a package total.
- [ ] MiLB scoring exclusions are explicit.
- [ ] Available players do not appear to have a known $0 salary.
- [ ] There is one authoritative Net-to-You ledger.
- [ ] Dynasty and scoring conclusions remain separate.
- [ ] Roster and cap consequences remain distinct from fairness.
- [ ] Pitchers screen remains healthy.
- [ ] Frontend tests/build pass.
- [ ] Live Pages deployment is verified.
- [ ] Impact Analysis remains queued and absent from the shipped UI.

## Decision log

| Date | Decision | Reason | Approved by |
|---|---|---|---|
| 2026-08-05 | Adopt the locked decisions in this TODO. | Consolidated GM-focused Trade Analyzer plan. | User |

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
