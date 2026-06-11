# wc26-predictor

World Cup 2026 match predictor: Elo + Dixon-Coles statistical core (in `engine/`, cloned from
[Hicruben/world-cup-2026-prediction-model](https://github.com/Hicruben/world-cup-2026-prediction-model),
MIT) plus a bounded tactical-adjustment layer driven by Claude as analyst.

## Layout

- `engine/` — upstream statistical model (separate git clone; don't edit, `git pull` for updates)
- `src/model.mjs` — shared prediction math (Dixon-Coles grid, adjustment clamping)
- `src/predict.mjs` — CLI predictor: baseline + tactical adjustments + scorelines, `--save` logs to `predictions/`
- `src/server.mjs` + `public/index.html` — personal web dashboard (`npm run serve` → http://localhost:3026): team picker, tactical sliders, save predictions, enter actual results, hit/miss tracking
- `src/api-football.mjs` — fixtures / lineups / injuries from API-Football (key in `.env`)
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

- Team names: kebab-case, must match keys in `engine/data/elo-calibrated.json`
- API-Football: World Cup = league 1, season 2026. Free tier ≈100 req/day — cache hits in
  `data-cache/` are reused, don't refetch needlessly.
