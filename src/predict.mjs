#!/usr/bin/env node
// Match predictor: Elo baseline from engine/ + bounded tactical adjustments.
//
//   node src/predict.mjs spain germany
//   node src/predict.mjs usa mexico --home usa
//   node src/predict.mjs spain germany --adjust adjustments/spain-germany.json --save
//
// Adjustment file: { "lambdaA": 1.08, "lambdaB": 0.95, "reasoning": "..." }
// Multipliers are clamped to [0.85, 1.15] — the tactical layer nudges the
// statistical model, it never overrides it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { expectedGoals, poissonPmf, DC_RHO } from "../engine/elo.mjs";

const ADJUST_MIN = 0.85;
const ADJUST_MAX = 1.15;
const HOME_BONUS = 75;
const MAX_GOALS = 8;

function dcTau(a, b, lambda, mu, rho) {
  if (a === 0 && b === 0) return 1 - lambda * mu * rho;
  if (a === 0 && b === 1) return 1 + lambda * rho;
  if (a === 1 && b === 0) return 1 + mu * rho;
  if (a === 1 && b === 1) return 1 - rho;
  return 1;
}

// Full Dixon-Coles grid for given expected goals → 1X2, scorelines, totals.
function predictFromLambdas(lambda, mu) {
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
    topScorelines: scorelines.slice(0, 5).map(s => ({ score: s.score, p: s.p / total })),
  };
}

function clampAdjust(x, label) {
  if (x == null) return 1;
  const clamped = Math.max(ADJUST_MIN, Math.min(ADJUST_MAX, x));
  if (clamped !== x) console.warn(`  ! ${label} multiplier ${x} clamped to ${clamped}`);
  return clamped;
}

// ---- CLI ----
const args = process.argv.slice(2);
const positional = [];
let home = null, adjustPath = null, save = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--home") home = args[++i];
  else if (args[i] === "--adjust") adjustPath = args[++i];
  else if (args[i] === "--save") save = true;
  else positional.push(args[i]);
}
const [teamA, teamB] = positional;

const { ratings } = JSON.parse(readFileSync(new URL("../engine/data/elo-calibrated.json", import.meta.url), "utf8"));
if (!teamA || !teamB) {
  console.log("Usage: node src/predict.mjs <teamA> <teamB> [--home team] [--adjust file.json] [--save]\n");
  console.log("Teams:\n  " + Object.keys(ratings).sort().join(", "));
  process.exit(0);
}
const ra = ratings[teamA], rb = ratings[teamB];
if (ra == null || rb == null) {
  console.error(`Unknown team: ${ra == null ? teamA : teamB}`);
  process.exit(1);
}

const hb = home === teamA ? HOME_BONUS : home === teamB ? -HOME_BONUS : 0;
const baseLambda = expectedGoals(ra, rb, hb);
const baseMu = expectedGoals(rb, ra, -hb / 2);
const baseline = predictFromLambdas(baseLambda, baseMu);

let adjusted = null, adjustment = null;
if (adjustPath) {
  adjustment = JSON.parse(readFileSync(adjustPath, "utf8"));
  const mA = clampAdjust(adjustment.lambdaA, "lambdaA");
  const mB = clampAdjust(adjustment.lambdaB, "lambdaB");
  adjusted = predictFromLambdas(baseLambda * mA, baseMu * mB);
}

const final = adjusted ?? baseline;
const pct = (x) => (x * 100).toFixed(1).padStart(5) + "%";
const bar = (x) => "█".repeat(Math.round(x * 30));

console.log(`\n  ${teamA} (Elo ${ra})  vs  ${teamB} (Elo ${rb})${hb ? `   [${home} at home]` : "   [neutral]"}`);
if (adjusted) console.log(`  tactical adjustment: λA ×${clampAdjust(adjustment.lambdaA, "")} λB ×${clampAdjust(adjustment.lambdaB, "")}`);
console.log();
console.log(`  ${teamA.padEnd(16)} win  ${pct(final.winA)}  ${bar(final.winA)}`);
console.log(`  ${"draw".padEnd(16)}      ${pct(final.draw)}  ${bar(final.draw)}`);
console.log(`  ${teamB.padEnd(16)} win  ${pct(final.winB)}  ${bar(final.winB)}`);
if (adjusted) {
  console.log(`\n  baseline (no adjustment):  ${pct(baseline.winA)} / ${pct(baseline.draw)} / ${pct(baseline.winB)}`);
}
console.log(`\n  expected goals:  ${final.lambda.toFixed(2)} – ${final.mu.toFixed(2)}`);
console.log(`  over 2.5: ${pct(final.over25)}   both score: ${pct(final.btts)}`);
console.log(`\n  most likely scorelines:`);
for (const s of final.topScorelines) console.log(`    ${s.score.padEnd(5)} ${pct(s.p)}`);
if (adjustment?.reasoning) console.log(`\n  analyst reasoning: ${adjustment.reasoning}`);
console.log();

if (save) {
  mkdirSync(new URL("../predictions/", import.meta.url), { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = new URL(`../predictions/${stamp}_${teamA}-vs-${teamB}.json`, import.meta.url);
  writeFileSync(file, JSON.stringify({
    date: new Date().toISOString(), teamA, teamB, home: home ?? null,
    eloA: ra, eloB: rb, baseline, adjusted, adjustment,
    actual: null, // fill in after the match: { goalsA, goalsB }
  }, null, 2));
  console.log(`  saved → predictions/${stamp}_${teamA}-vs-${teamB}.json\n`);
}
