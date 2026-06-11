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

export function baseLambdas(teamA, teamB, home = null) {
  const ra = ratings[teamA], rb = ratings[teamB];
  if (ra == null || rb == null) throw new Error(`Unknown team: ${ra == null ? teamA : teamB}`);
  const hb = home === teamA ? HOME_BONUS : home === teamB ? -HOME_BONUS : 0;
  return { ra, rb, hb, lambda: expectedGoals(ra, rb, hb), mu: expectedGoals(rb, ra, -hb / 2) };
}
