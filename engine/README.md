# 🏆 World Cup 2026 Prediction Model

An open-source statistical model that forecasts **2026 FIFA World Cup** matches and title odds —
**Elo ratings → Dixon-Coles bivariate Poisson → Monte Carlo simulation**. No machine-learning
black box, no scraped bookmaker odds: just transparent, reproducible football maths.

**▶ Live predictions (full 48-team, 10,000-simulation model):** **https://cup26matches.com**
· [How it works / methodology](https://cup26matches.com/en/methodology/)
· [Interactive bracket simulator](https://cup26matches.com/en/simulator/)

> This repo open-sources the **core match model + our honest backtest** so you can run, inspect
> and reproduce the numbers. The live site runs the full tournament simulation (groups → the new
> Round of 32 → final) and updates daily as real results come in.

---

## Why it's worth a look

It's tested the honest way — **walk-forward, out-of-sample** on **920 real internationals**
(Oct 2023 – May 2026). Every match is predicted using only data available *before* kickoff, then
scored against the actual result. Reproduce it yourself in one command:

```bash
node backtest.mjs
```

| Metric (770 evaluated, 150 burn-in) | Model | Baseline |
|---|---|---|
| Correct result (win/draw/loss) | **~61%** | always-home 49% · coin-flip 33% |
| When a clear favourite (p ≥ 50%) | **~67%** | — |
| Brier score (lower = better) | **~0.54** | coin-flip 0.67 |

> _Updated June 2026: widened the goal-model variance parameter (the Elo→expected-goals denominator, 350→400) for slightly better calibration. Walk-forward accuracy is unchanged at **61%**; the Brier score improves marginally. The live 48-team title odds at [cup26matches.com](https://cup26matches.com) apply additional per-team strength priors on top of this core model._


No model is a crystal ball — football is high-variance and draws are genuinely hard. These are
well-calibrated estimates, and we make **no claim to beat the betting market**.

## Quick start

No dependencies. Node 18+.

```bash
git clone https://github.com/Hicruben/world-cup-2026-prediction-model.git
cd world-cup-2026-prediction-model

node predict.mjs brazil argentina      # head-to-head probabilities
node predict.mjs usa mexico usa        # 3rd arg = home team (host bonus)
node backtest.mjs                      # reproduce the accuracy numbers
node calibrate.mjs                     # rebuild ratings from data/results.json
```

Example:

```
$ node predict.mjs spain germany

  spain (Elo 2074)  vs  germany (Elo 1927)   [neutral]

  spain            win   53.2%  ████████████████
  draw                   26.8%  ████████
  germany          win   20.0%  ██████
```

## How it works

1. **Team strength (Elo).** Each nation starts from a long-run prior, then is calibrated on
   recent real internationals — wins over strong sides in important games move a rating more than
   friendlies, and recent form outweighs old form. See [`calibrate.mjs`](./calibrate.mjs).
2. **Each match (Dixon-Coles Poisson).** Ratings → expected goals → a Dixon-Coles bivariate
   Poisson gives win/draw/loss probabilities. The Dixon-Coles correction fixes plain Poisson's
   well-known under-count of low-scoring draws (0-0, 1-1). See [`elo.mjs`](./elo.mjs).
3. **The tournament (Monte Carlo).** The live site plays all 104 matches 10,000 times through the
   real bracket to get championship & advancement odds. Full write-up:
   [cup26matches.com/methodology](https://cup26matches.com/en/methodology/).

## Files

| File | What |
|---|---|
| `elo.mjs` | The match model — Elo, Dixon-Coles τ, Poisson, `matchProb`, `sampleMatch` |
| `calibrate.mjs` | Build calibrated ratings from `data/results.json` |
| `backtest.mjs` | Walk-forward out-of-sample evaluation (accuracy, Brier, log-loss) |
| `predict.mjs` | CLI head-to-head predictor |
| `data/results.json` | 920 real international results (2023–2026) |
| `data/elo-calibrated.json` | Calibrated Elo for the 48 finalists |
| `data/model-backtest.json` | Saved backtest metrics |

## License

MIT — see [LICENSE](./LICENSE). Built by [Cup26 AI](https://cup26matches.com). If you use it,
a link back is appreciated. ⭐ the repo if you find it useful!
