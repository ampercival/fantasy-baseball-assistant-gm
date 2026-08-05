# Trade Analyzer Phase 0 baseline

Captured: 2026-08-05

URL: `http://localhost:5173/fantasy-baseball-assistant-gm/#/trade`

This is a pre-implementation baseline for `docs/TRADE_ANALYZER_TODO.md`. Player values and roster state are a dated fixture, not permanent expected values.

## Selected context

- League: Aspromonte
- My team: Uncle Charlie's Angels
- Default target pool: Available
- Enabled trade source groups: Continuous and Updated
- Current cap: $376 of $387
- Current cap space: $11
- My loaded roster: 42 players

## Responsive measurements

| Viewport | Panel layout | Panel/table viewport | Table content width | Page-level horizontal overflow |
|---|---|---:|---:|---|
| 1600 x 1000 | Two columns, 684px each | 667px | 1510px / 1460px | No |
| 1366 x 768 | Two columns, about 640px each | 623px | 1510px / 1460px | No |
| 900 x 1000 | One column, 829px | 812px | 1510px / 1460px | No |
| 390 x 844 | One column, 343px | 326px | 1510px / 1460px | No |

Findings:

- The page itself does not overflow horizontally at the measured widths.
- Both player tables require extensive internal horizontal scrolling at every measured width.
- At 1600px, the first table is about 2.26 times wider than its visible table viewport.
- At 390px, the first table is about 4.63 times wider than its visible table viewport.
- Owner repeats the team name on every normal team row.
- Give/Drop controls and the player column need coordinated sticky offsets in the redesign.
- The current mobile header is usable, but the trade table remains a desktop-width surface inside a narrow scroller.

## Screenshots

- [Desktop 1600 x 1000](desktop-1600x1000.jpg)
- [Laptop 1366 x 768](laptop-1366x768.jpg)
- [Tablet 900 x 1000](tablet-900x1000.jpg)
- [Mobile 390 x 844](mobile-390x844.jpg)

## Stable manual test fixtures

These fixtures are for interaction and arithmetic testing. Re-read their live values before using them because roster and valuation data can refresh.

### Normal team-to-team

- Opponent: Last Christmas
- You give: Joe Ryan
  - Salary $15
  - Dynasty value $26.2
  - Scoring value $23.1
- You get: Chase Burns
  - Salary $18
  - Dynasty value $35.7
  - Scoring value $28.1
- Cash: none
- Drops: none initially
- Later regression: add a drop and verify neither fairness verdict nor the source verdict moves.

### Trade Block

- You give: Ronald Acuna Jr.
- You target: Bobby Witt Jr. of The Hopsmackers
- Purpose: verify Trade Block owner name/UID preservation and source-package calculations.

### Available

- Target: Cole Ragans
- Current UI state: IL, salary shown as $0, dynasty value $14.1, scoring value $1.6
- Expected redesign: salary becomes unknown/`Bid TBD`; surplus and cap conclusions remain unavailable until acquisition salary is known.

## Edge-case players

### IL

- Will Smith: 60IL on Uncle Charlie's Angels.
- Cole Ragans: IL in the Available pool.

### MiLB, missing scoring, and partial dynasty-source coverage

- Edward Cabrera: IL and AAA/MiLB on Uncle Charlie's Angels.
- Dynasty aggregate rank: 230.
- Scoring rank/value: missing.
- Rankings source count: 6.
- Missing enabled-source ranks in the captured Rankings row: Dynatyze and the Updated RotoBaller source.
- Purpose: verify MiLB scoring exclusion, no silent `$0`, incomplete-result language, and partial-source markers.

## Pitchers regression baseline

URL: `http://localhost:5173/fantasy-baseball-assistant-gm/#/pitchers`

- League/team: Aspromonte / Uncle Charlie's Angels
- Pitchers: 20
- SP or SP-leaning: 13
- RP or RP-leaning: 7
- Mixed use: 2
- Manual usage overrides: 1
- Out of sync: 1
- Rotation, bubble, bullpen, and valuation tables rendered.
- No warning or error console messages were recorded during the Trade/Rankings/Pitchers baseline pass.

## Frontend test tooling baseline

`frontend/package.json` currently defines only:

- `dev`
- `build`
- `preview`

No frontend unit-test runner or `test` script is configured. Phase 3 should add Vitest unless the implementation adopts another focused TypeScript test runner first.
