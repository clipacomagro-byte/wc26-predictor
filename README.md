# wc26-predictor

World Cup 2026 score predictor. Statistical core: Elo + Dixon-Coles bivariate Poisson
(from [Hicruben/world-cup-2026-prediction-model](https://github.com/Hicruben/world-cup-2026-prediction-model), MIT).
On top: live lineups/injuries from API-Football and a **bounded tactical-adjustment layer**
where Claude acts as analyst — reading team style dossiers and confirmed XIs, then nudging
expected goals by at most ±15%, with written reasoning, logged against the baseline.

## Setup

```bash
git clone https://github.com/Hicruben/world-cup-2026-prediction-model engine
cp .env.example .env   # add your api-football.com key
```

Node 18+, no npm dependencies.

## Use

```bash
npm run serve                                      # dashboard → http://localhost:3026
node src/predict.mjs spain germany                 # baseline prediction
node src/api-football.mjs fixtures 2026-06-14      # find fixture IDs
node src/api-football.mjs lineups <fixtureId>      # confirmed XI
node src/predict.mjs spain germany --adjust adjustments/spain-vs-germany.json --save
```

Or just tell Claude Code: *"analyze spain vs germany, fixture 12345"* — it follows
`prompts/tactical-analyst.md`.

## Honesty loop

Every `--save` logs baseline AND adjusted probabilities to `predictions/`. After each match,
fill in `actual`. If the tactical layer isn't beating the baseline on Brier score by the
knockouts, tighten the bounds. The math is the floor; the analyst has to earn its keep.
