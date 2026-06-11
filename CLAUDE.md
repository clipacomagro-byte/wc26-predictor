# wc26-predictor

World Cup 2026 match predictor: Elo + Dixon-Coles statistical core (in `engine/`, cloned from
[Hicruben/world-cup-2026-prediction-model](https://github.com/Hicruben/world-cup-2026-prediction-model),
MIT) plus a bounded tactical-adjustment layer driven by Claude as analyst.

## Layout

- `engine/` — upstream statistical model (separate git clone; don't edit, `git pull` for updates)
- `src/model.mjs` — shared math: Dixon-Coles grid, style multipliers (-2..+2 per team, attacking/defensive), corners heuristic, clamping
- `src/form.mjs` — last-5 form (overall/home/away) + head-to-head from engine's 920-match results.json
- `src/build-players.mjs` → `data/players.json` — EA FC 26 player DB (2040 players, 54 nations, ratings/positions/clubs/faces) from EAFC26-DataHub CSV in `data-cache/`; rebuild with `node src/build-players.mjs` (restart server after — it caches the JSON)
- `src/predict.mjs` — CLI predictor: baseline + manual lambda multipliers (the analyst-agent path)
- `src/server.mjs` + `public/index.html` — match-center UI (`npm run serve` → http://localhost:3026): formation pitches with editable XIs (persisted in localStorage per team), tactical approach segments, form/H2H intel, corners, save/log/hit-miss. Lineup import per fixture id needs the API key.
- `src/sportradar.mjs` — Sportradar Soccer v4 client (SPORTRADAR_KEY in .env, trial tier ~1 req/s
  so cache hard). WC2026 season = sr:season:101177. Powers /api/matches (all 104 fixtures,
  6h-cached) and /api/lineups?event= (confirmed XI ~1h before KO). UI fixture picker auto-selects
  the next unplayed match and sets host-nation home advantage (usa/mexico/canada).
- `src/apifb.mjs` — API-Football client (backup feed); `src/api-football.mjs` — its CLI (key optional)
- `dossiers/` — one style dossier per team (see TEMPLATE.md)
- `prompts/tactical-analyst.md` — THE WORKFLOW. Read this when asked to analyze/predict a match.
- `adjustments/` — analyst output JSONs, one per match
- `predictions/` — logged predictions (baseline vs adjusted vs actual) for calibration
- `data-cache/` — raw API responses (gitignored)

## Commands

```
node src/predict.mjs spain germany                      # baseline
node src/predict.mjs spain germany --adjust adjustments/spain-vs-germany.json --save
node src/api-football.mjs fixtures 2026-06-14           # fixture IDs for a date
node src/api-football.mjs lineups 12345                 # confirmed XI
```

## When asked to "predict <match>" or "analyze <match>"

Follow `prompts/tactical-analyst.md` exactly. Key rules: multipliers in [0.85, 1.15],
default 1.0, only adjust for what Elo can't see (absences, style matchups, rest, venue),
always `--save` the final prediction.

## After each match

Fill the `actual` field in the prediction JSON. Periodically compare baseline vs adjusted
Brier scores to check the tactical layer adds signal — if it doesn't by the round of 16,
shrink the bounds.

## Conventions

- Team names: kebab-case, must match keys in `data/teams.json` (the REAL 48 qualifiers,
  built by `src/build-teams.mjs` — do NOT use engine/data/elo-calibrated.json directly:
  it predates the March 2026 playoffs, still lists Italy/Denmark/Poland and lacks
  Norway/Turkey/Austria/Sweden/Uzbekistan/Iraq/Cape Verde/DR Congo/Curaçao)
- API-Football: World Cup = league 1, season 2026. Free tier ≈100 req/day — cache hits in
  `data-cache/` are reused, don't refetch needlessly.
