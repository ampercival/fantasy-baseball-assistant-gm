# Fantasy Baseball Assistant GM

A local-first fantasy baseball assistant for dynasty league management.

The first tool aggregates dynasty player rankings from multiple sources into one board. It stores each source update in SQLite, computes aggregate rank metrics, and shows the source-by-source ranking columns in a modern local web UI.

The second tool imports fantasy teams and leagues from public Ottoneu URLs. It stores roster snapshots, salary/cap context, penalties, loans, trade-block data, and league team memberships, then matches roster players back to the aggregate dynasty board where possible.

## What Works Now

- Automatic updates for public structured ranking pages:
  - Pitcher List 2026 Top 400 Dynasty Rankings
  - The Dynasty Guru 2026 Top 500 OBP
  - The Dynasty Guru 2026 Top 500 Points
  - Baseball America 2026 Top 500 Fantasy Baseball Dynasty Rankings
  - FantasyPros 2026 Keeper/Dynasty ECR
  - RotoBaller Eric Cross May 2026 Top 200
  - Rotoworld / NBC Sports 2026 Top 500
  - ESPN 2026 Top 300
  - FantraxHQ 2026 Top 500 Roto or Points
- Manual CSV paste/import for subscription, JavaScript-gated, or export-only sources.
- Aggregate player table with average rank, median rank, spread, source count, and source rank columns.
- CSV export of the aggregate board.
- Ottoneu team import/update from a team URL such as `https://ottoneu.fangraphs.com/1900/team/12519`.
- Ottoneu league import/update from a league home URL such as `https://ottoneu.fangraphs.com/1900/home`.
- Team roster view with salary, position, status, points, cap penalties, loans, trade block, and aggregate ranking matches.
- Optional fantasy league overlay in the dynasty rankings table showing each player's fantasy team and salary, with filters for a specific fantasy team or available players.

The app does not bypass paywalls, logins, or subscriber-only exports. For paid sources, export the rankings you are entitled to access and paste them into the import flow.

## Quick Start

Requires Python 3.12+ and Node.js 24 LTS.

Fastest Windows startup:

```powershell
.\start-app.cmd
```

You can also double-click [start-app.cmd](./start-app.cmd). It creates the Python virtual environment if needed, installs missing dependencies, starts the backend and frontend in separate terminal windows, and opens the app.

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
cd frontend
npm install
cd ..
```

Run the backend:

```powershell
.\.venv\Scripts\python -m uvicorn app.main:app --app-dir backend --reload --port 8000
```

Run the frontend in a second terminal:

```powershell
cd frontend
npm run dev
```

Open http://localhost:5173.

## Import Format

Manual imports accept CSV text with these headers:

```csv
rank,player,team,position,age
1,Shohei Ohtani,LAD,UT/P,31.6
2,Juan Soto,NYM,OF,27.3
```

Only `rank` and `player` are required. Accepted aliases include `name` for `player`, `org` for `team`, and `pos` for `position`.

## Notes On Sources

Some reputable rankings are intentionally import-only in this first version:

- RotoWire: unauthenticated access exposes only a short preview from its table endpoint.
- Baseball Prospectus: the Top 500 article is premium.
- The Dynasty Dugout: full dynasty rankings can be subscription-gated.
- SportsEthos / AK: the public page currently exposes only a top-50 preview, so the app leaves the full AK Dynasty 300 as manual import.

Those sources are still present in the app so their exports can participate in the aggregate board.
