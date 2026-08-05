# Trade Analyzer GM Workflow TODO

Status: Planned - implementation not started

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

- [ ] Use `You Give`, `You Get`, and `Net to You`; remove user-facing Side A/Side B result language.
- [ ] Separate deal fairness from roster consequences.
- [ ] Drops never affect dynasty fairness, scoring fairness, the source verdict, or the winner language.
- [ ] Drops do affect roster count, cap usage, cap space, position mix, age, and later lineup impact.
- [ ] Missing dynasty or scoring values never become silent zeroes.
- [ ] A missing value invalidates only the affected metric's conclusion.
- [ ] MiLB scoring is identified as intentionally excluded/not applicable, not as a data-fetch failure.
- [ ] Full-coverage dynasty sources determine the authoritative source verdict and range.
- [ ] Partial source estimates may be displayed, but never counted in favor/even/oppose totals or the official range.
- [ ] Available-player salary is unknown (`Bid TBD`), not `$0`.
- [ ] The default table is a compact Core GM view; Full Stats is optional.
- [ ] Dynasty source spread remains visible in Core view.
- [ ] Trade calculations move to a small testable module; the main React markup may remain in `App.tsx`.
- [ ] Immediate implementation is frontend-only unless an unexpected blocker proves otherwise.
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

- [ ] Create `frontend/src/tradeAnalysis.ts`.
- [ ] Define `TradeSourceValue` with:
  - [ ] `sourceId`
  - [ ] `sourceName`
  - [ ] `shortName`
  - [ ] `sourceTag`
  - [ ] `sourceDate`
  - [ ] `rank`
  - [ ] `value`
- [ ] Define `TradeAvailabilityCode` as `il | minors | susp`.
- [ ] Move or define the pure trade total/result types in this module.

### 1.2 Extend `TradePlayerRow`

- [ ] Add `age: number | null` from the matched `AggregatePlayer`.
- [ ] Add `ownerTeamUid: string | null` for later Trade Block Impact Analysis.
- [ ] Change salary handling so Available players can have unknown salary.
- [ ] Add `availabilityCodes` derived from the existing roster availability helper.
- [ ] Preserve IL, MiLB, and suspended statuses.
- [ ] Add `seasonPoints: number | null` and keep it separate from P/G and P/IP.
- [ ] Add `sourceValues: TradeSourceValue[]`.
- [ ] Derive source count from `sourceValues.length` rather than storing duplicate state.
- [ ] Derive player source minimum, maximum, and spread from `sourceValues`.
- [ ] Preserve aggregate dynasty value as the consensus value even when individual source coverage is incomplete.

### 1.3 Correct Available-player semantics

- [ ] Stop placing `points_per_game` in the season-points field.
- [ ] Display Available salary as `Bid TBD`/unknown rather than `$0`.
- [ ] Suppress Available salary-surplus and cap conclusions until an acquisition salary is known.
- [ ] Keep dynasty/scoring values available where their underlying ranks exist.

### 1.4 Consolidate row builders

- [ ] Extract a shared `toTradeRow()` helper.
- [ ] Keep thin wrappers for normal roster, Available, and Trade Block rows.
- [ ] Pass allowed `BoardSource` metadata instead of only source IDs.
- [ ] Preserve normal roster owner team UID/name.
- [ ] Preserve Trade Block owner team UID/name.
- [ ] Preserve Available ownership as unrostered.
- [ ] Update the shared Pitchers call site.
- [ ] Confirm the added fields remain inert and harmless for `PitcherDisplayRow`.

Phase 1 evidence:

- Files changed:
- Type/build result:
- Pitchers regression result:

---

## Phase 2 - Separate deal fairness from roster consequences

### 2.1 Define explicit inputs

- [ ] Treat these collections independently:
  - [ ] Players you give.
  - [ ] Players you get.
  - [ ] Players you drop.
  - [ ] Players the opponent drops.
  - [ ] Cash you send.
  - [ ] Cash you receive.

### 2.2 Deal totals

- [ ] Calculate dynasty value given from outgoing players plus cash sent.
- [ ] Calculate dynasty value received from incoming players plus cash received.
- [ ] Calculate dynasty net to you as received minus given.
- [ ] Apply the same structure to scoring value.
- [ ] Calculate player dynasty surplus as dynasty value minus known salary.
- [ ] Calculate player scoring surplus as scoring value minus known salary.
- [ ] Show cash as its own line instead of hiding it inside player totals.
- [ ] Keep current one-dollar cash-to-value treatment unless the user changes it.
- [ ] Exclude both teams' drops from all deal totals.

### 2.3 Roster and cap totals

- [ ] Calculate salary change as incoming salary minus outgoing salary minus my drop salary.
- [ ] Calculate cap-limit change as cash received minus cash sent.
- [ ] Calculate roster-count change as incoming count minus outgoing count minus my drops.
- [ ] Continue calculating the opponent's feasibility only for real team-to-team trades.
- [ ] Keep opponent drops outside my net-to-me fairness result.
- [ ] Preserve over-cap detection.

### 2.4 Missing and not-applicable values

- [ ] Track known subtotal, missing count, and not-applicable count for each metric.
- [ ] Do not coerce a missing dynasty value to zero.
- [ ] Do not coerce a missing scoring value to zero.
- [ ] Invalidate the dynasty verdict if any exchanged player's dynasty value is missing.
- [ ] Invalidate the scoring verdict if a required scoring value is missing.
- [ ] Distinguish MiLB scoring exclusion from an unexpected missing scoring value.
- [ ] Display a known subtotal plus missing-player count when incomplete.
- [ ] Do not show a winner/edge for an incomplete metric.

### 2.5 Even/close threshold

- [ ] Use a consistent materiality threshold, initially `max($1, 5% of average package value)`.
- [ ] Treat metric differences inside the threshold as effectively even.
- [ ] Allow the dynasty source distribution to override confidence when its full-coverage range crosses zero.

Phase 2 evidence:

- Calculation examples:
- Drop-isolation result:
- Missing-value result:

---

## Phase 3 - Automated calculation tests

- [ ] Add/configure a frontend unit-test runner if one is not already available.
- [ ] Add a one-for-one trade-total test.
- [ ] Add a multi-player package test.
- [ ] Add cash-sent-by-me test.
- [ ] Add cash-received test.
- [ ] Verify selecting my drop does not change dynasty fairness.
- [ ] Verify selecting my drop does not change scoring fairness.
- [ ] Verify selecting my drop does not change the source verdict.
- [ ] Verify drops do change roster count, salary, and cap results.
- [ ] Verify opponent drops do not change my fairness result.
- [ ] Verify missing dynasty value invalidates only dynasty.
- [ ] Verify missing scoring value invalidates only scoring.
- [ ] Verify MiLB scoring is excluded/not applicable rather than zero.
- [ ] Verify Available salary is unknown.
- [ ] Verify season points and rate remain separate.
- [ ] Verify full source coverage totals.
- [ ] Verify partial-source consensus substitution.
- [ ] Verify partial sources are excluded from headline counts and official ranges.
- [ ] Verify the even threshold.
- [ ] Verify source-tag filters recompute source totals.

Phase 3 evidence:

- Test command:
- Test result:

---

## Phase 4 - Rebuild the player-selection tables

### 4.1 Responsive panel layout

- [ ] Label my roster panel `You Give`.
- [ ] Label a normal opponent panel `You Get from [Team]`.
- [ ] Label the Trade Block panel `Trade Block Targets`.
- [ ] Label the Available panel `Available Pickups`.
- [ ] Keep panels side by side only when both Core tables have usable width.
- [ ] Stack panels into full-width sections around 1280-1400px, based on browser verification.
- [ ] Do not wait until 980px to stack the wide tables.

### 4.2 Core table - 9 columns

- [ ] Give/Get action.
- [ ] Drop action.
- [ ] Player.
- [ ] Salary.
- [ ] Dynasty Value.
- [ ] Dynasty Surplus.
- [ ] Dynasty Spread.
- [ ] Scoring Value.
- [ ] Scoring Surplus.

The Player cell must include:

- [ ] Player name.
- [ ] Position.
- [ ] Age.
- [ ] MLB team.
- [ ] IL/MiLB/suspended tags.
- [ ] Owner only when it adds information.

### 4.3 Full Stats - 13 columns

- [ ] Add Dynasty Rank.
- [ ] Add Scoring Rank.
- [ ] Add season Points.
- [ ] Add P/G or P/IP.
- [ ] Keep source count inside the Dynasty Spread cell.
- [ ] Confirm grouped-header `colSpan` values for both modes.

### 4.4 Table controls

- [ ] Retain player search.
- [ ] Retain position filter.
- [ ] Retain source-group controls.
- [ ] Retain sorting for meaningful columns.
- [ ] Add Core / Full Stats toggle.
- [ ] Add Clear Trade action.
- [ ] Show selected-player counts.

### 4.5 Sticky columns and headers

- [ ] Give/Get column width 44px and `left: 0`.
- [ ] Drop column width 44px and `left: 44px`.
- [ ] Player column uses `left: 88px`.
- [ ] Use distinct action-column classes rather than one ambiguous `.check-col` offset.
- [ ] Apply offsets to both header rows and body cells.
- [ ] Give sticky cells explicit backgrounds and z-indexes.
- [ ] Preserve selected/drop-selected row colors on sticky cells.
- [ ] Use a sticky `<thead>` for the grouped header.

### 4.6 Virtualization

- [ ] Finalize the rendered row height after the row design is complete.
- [ ] If using 52px, make every non-spacer row exactly 52px.
- [ ] Prevent player metadata and source plots from wrapping.
- [ ] Exclude virtual spacer rows from fixed-height rules.
- [ ] Update spacer and empty-state `colSpan` dynamically for Core/Full modes.
- [ ] Verify no gaps, overlap, or jumps at virtual window boundaries.

### 4.7 Keep totals out of the browser table

- [ ] Do not add a duplicate totals `<tfoot>` to the roster browser.
- [ ] Keep totals in selected packages and the shared ledger only.

Phase 4 evidence:

- Desktop result:
- Laptop/tablet result:
- Virtualization result:

---

## Phase 5 - Rebuild selected packages and roster moves

### 5.1 You Give and You Get package tables

- [ ] Replace loose selected-player cards with compact tables.
- [ ] Show player/status.
- [ ] Show position/age.
- [ ] Show salary or `Bid TBD`.
- [ ] Show dynasty value.
- [ ] Show dynasty surplus when salary is known.
- [ ] Show dynasty source range.
- [ ] Show scoring value.
- [ ] Show scoring surplus when salary is known.
- [ ] Add a direct Remove action.

### 5.2 Package totals

- [ ] Player count.
- [ ] Known salary and unknown-salary count.
- [ ] Dynasty value.
- [ ] Dynasty surplus.
- [ ] Scoring value.
- [ ] Scoring surplus.
- [ ] Season points.
- [ ] Average age.
- [ ] Hitter/pitcher count.
- [ ] IL count.
- [ ] MiLB count.
- [ ] Suspended count.
- [ ] Do not total rank.
- [ ] Do not total rate.
- [ ] Do not total position labels.
- [ ] Do not sum individual player spread widths.

### 5.3 Roster Moves Required

- [ ] Create a separate block for my required drops.
- [ ] Create opponent feasibility/drop information only when relevant.
- [ ] Show each drop's salary and values surrendered.
- [ ] Show position and status.
- [ ] Label drops as outside the fairness calculation.
- [ ] Show cuts required, cuts selected, and cuts remaining.

Phase 5 evidence:

- Package table result:
- Drop separation result:

---

## Phase 6 - Build one GM-focused Trade Ledger

### 6.1 Remove duplicated comparison tiles

- [ ] Remove `.trade-side-diffs` from both side panels.
- [ ] Remove mirrored `comparisonTotal` difference calculations.
- [ ] Keep side-specific cap/feasibility information where useful.

### 6.2 Shared ledger

- [ ] Add columns: Metric / You Give / You Get / Net to You.
- [ ] Add Players row.
- [ ] Add Player Salary row.
- [ ] Add Cash row.
- [ ] Add Dynasty Value row.
- [ ] Add Dynasty Surplus row.
- [ ] Add Scoring Value row.
- [ ] Add Scoring Surplus row.
- [ ] Add Season Points row.
- [ ] Add Average Age row.
- [ ] Add IL row.
- [ ] Add MiLB row.
- [ ] Add roster-count/cap-space summary below the ledger.
- [ ] Reuse signed-value styling, but do not communicate meaning by color alone.

### 6.3 GM result language

- [ ] Remove user-facing `Side A Wins` and `Side B Wins` copy.
- [ ] Produce a dynasty-specific conclusion.
- [ ] Produce a scoring-specific conclusion.
- [ ] Preserve split results.
- [ ] Produce explicit incomplete-data language.
- [ ] Produce explicit MiLB scoring-exclusion language.
- [ ] Keep the no-selection prompt neutral and instructional.

Phase 6 evidence:

- Ledger arithmetic check:
- Result copy examples:

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
