#!/usr/bin/env node
// Match predictor CLI: Elo baseline from engine/ + bounded tactical adjustments.
//
//   node src/predict.mjs spain germany
//   node src/predict.mjs usa mexico --home usa
//   node src/predict.mjs spain germany --adjust adjustments/spain-germany.json --save
//
// Adjustment file: { "lambdaA": 1.08, "lambdaB": 0.95, "reasoning": "..." }
// Multipliers are clamped to [0.85, 1.15] — the tactical layer nudges the
// statistical model, it never overrides it.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ratings, predictFromLambdas, clampAdjust, baseLambdas } from "./model.mjs";

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

if (!teamA || !teamB) {
  console.log("Usage: node src/predict.mjs <teamA> <teamB> [--home team] [--adjust file.json] [--save]\n");
  console.log("Teams:\n  " + Object.keys(ratings).sort().join(", "));
  process.exit(0);
}

let base;
try {
  base = baseLambdas(teamA, teamB, home);
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
const baseline = predictFromLambdas(base.lambda, base.mu);

let adjusted = null, adjustment = null, mA = 1, mB = 1;
if (adjustPath) {
  adjustment = JSON.parse(readFileSync(adjustPath, "utf8"));
  mA = clampAdjust(adjustment.lambdaA);
  mB = clampAdjust(adjustment.lambdaB);
  if (mA !== adjustment.lambdaA) console.warn(`  ! lambdaA ${adjustment.lambdaA} clamped to ${mA}`);
  if (mB !== adjustment.lambdaB) console.warn(`  ! lambdaB ${adjustment.lambdaB} clamped to ${mB}`);
  adjusted = predictFromLambdas(base.lambda * mA, base.mu * mB);
}

const final = adjusted ?? baseline;
const pct = (x) => (x * 100).toFixed(1).padStart(5) + "%";
const bar = (x) => "█".repeat(Math.round(x * 30));

console.log(`\n  ${teamA} (Elo ${base.ra})  vs  ${teamB} (Elo ${base.rb})${base.hb ? `   [${home} at home]` : "   [neutral]"}`);
if (adjusted) console.log(`  tactical adjustment: λA ×${mA} λB ×${mB}`);
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
    eloA: base.ra, eloB: base.rb, baseline, adjusted, adjustment,
    actual: null, // fill in after the match: { goalsA, goalsB }
  }, null, 2));
  console.log(`  saved → predictions/${stamp}_${teamA}-vs-${teamB}.json\n`);
}
