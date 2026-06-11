// Shared prediction math — used by the CLI (predict.mjs) and the dashboard (server.mjs).
import { readFileSync } from "node:fs";
import { expectedGoals, poissonPmf, DC_RHO } from "../engine/elo.mjs";

export const ADJUST_MIN = 0.85;
export const ADJUST_MAX = 1.15;
export const HOME_BONUS = 75;
const MAX_GOALS = 8;

export const { ratings } = JSON.parse(
  readFileSync(new URL("../engine/data/elo-calibrated.json", import.meta.url), "utf8")
);

function dcTau(a, b, lambda, mu, rho) {
  if (a === 0 && b === 0) return 1 - lambda * mu * rho;
  if (a === 0 && b === 1) return 1 + lambda * rho;
  if (a === 1 && b === 0) return 1 + mu * rho;
  if (a === 1 && b === 1) return 1 - rho;
  return 1;
}

// Full Dixon-Coles grid for given expected goals → 1X2, scorelines, totals.
export function predictFromLambdas(lambda, mu) {
  let winA = 0, draw = 0, winB = 0, over25 = 0, btts = 0, total = 0;
  const scorelines = [];
  for (let a = 0; a <= MAX_GOALS; a++) {
    for (let b = 0; b <= MAX_GOALS; b++) {
      const p = poissonPmf(a, lambda) * poissonPmf(b, mu) * dcTau(a, b, lambda, mu, DC_RHO);
      total += p;
      scorelines.push({ score: `${a}-${b}`, p });
      if (a > b) winA += p; else if (a < b) winB += p; else draw += p;
      if (a + b > 2.5) over25 += p;
      if (a > 0 && b > 0) btts += p;
    }
  }
  scorelines.sort((x, y) => y.p - x.p);
  return {
    winA: winA / total, draw: draw / total, winB: winB / total,
    over25: over25 / total, btts: btts / total,
    lambda, mu,
    topScorelines: scorelines.slice(0, 6).map(s => ({ score: s.score, p: s.p / total })),
  };
}

export function clampAdjust(x) {
  if (x == null || Number.isNaN(x)) return 1;
  return Math.max(ADJUST_MIN, Math.min(ADJUST_MAX, x));
}

// Tactical approach: -2 (very defensive) … 0 (balanced) … +2 (very attacking).
// An attacking setup raises your own expected goals but also opens space for the
// opponent; a defensive one suppresses both. Asymmetric on purpose — parking the
// bus cuts what you concede more than what you score is NOT true at this level,
// so suppression is weaker than creation.
export function styleMultipliers(styleA, styleB) {
  const sA = Math.max(-2, Math.min(2, styleA | 0));
  const sB = Math.max(-2, Math.min(2, styleB | 0));
  const own = (s) => 1 + 0.05 * s;       // your approach on your own goals
  const given = (s) => 1 + 0.035 * s;    // your approach on goals you concede
  const clampTotal = (x) => Math.max(0.8, Math.min(1.2, x));
  return {
    mA: clampTotal(own(sA) * given(sB)),  // multiplier on team A's lambda
    mB: clampTotal(own(sB) * given(sA)),  // multiplier on team B's lambda
  };
}

// Corners estimate. No public corner data for internationals in our dataset, so this
// is a calibrated heuristic, not a fitted model: international average ~9.5 total
// corners; more expected goals and more attacking setups → more corners. Split
// follows attacking share. Treat the output as an estimate band, not gospel.
export function cornersEstimate(lambda, mu, styleA = 0, styleB = 0) {
  const BASE = 9.5, AVG_XG = 2.7;
  const total = BASE * Math.sqrt((lambda + mu) / AVG_XG) * (1 + 0.03 * (styleA + styleB));
  const wA = Math.pow(lambda, 0.8), wB = Math.pow(mu, 0.8);
  const teamA = total * wA / (wA + wB), teamB = total - total * wA / (wA + wB);
  const over = (line) => {
    // P(total corners > line), Poisson
    let cdf = 0;
    for (let k = 0; k <= Math.floor(line); k++) cdf += poissonPmf(k, total);
    return 1 - cdf;
  };
  return {
    total, teamA, teamB,
    over: { "8.5": over(8.5), "9.5": over(9.5), "10.5": over(10.5), "11.5": over(11.5) },
  };
}

export function baseLambdas(teamA, teamB, home = null) {
  const ra = ratings[teamA], rb = ratings[teamB];
  if (ra == null || rb == null) throw new Error(`Unknown team: ${ra == null ? teamA : teamB}`);
  const hb = home === teamA ? HOME_BONUS : home === teamB ? -HOME_BONUS : 0;
  return { ra, rb, hb, lambda: expectedGoals(ra, rb, hb), mu: expectedGoals(rb, ra, -hb / 2) };
}
