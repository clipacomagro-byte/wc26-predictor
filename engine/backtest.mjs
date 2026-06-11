#!/usr/bin/env node
// Walk-forward, OUT-OF-SAMPLE backtest of the model on real internationals (data/results.json).
// Each match is predicted from ratings built ONLY on prior matches, then scored — no look-ahead.
//   node backtest.mjs
import { readFileSync } from "node:fs";
import { matchProb, expectedScore } from "./elo.mjs";

const D = (f) => new URL(`./data/${f}`, import.meta.url);
const SEED = {
  argentina:2085,france:2065,spain:2055,brazil:2045,england:2000,portugal:1980,netherlands:1965,germany:1945,belgium:1925,italy:1915,colombia:1890,uruguay:1875,croatia:1870,morocco:1840,switzerland:1825,usa:1830,mexico:1825,japan:1810,senegal:1795,denmark:1790,ecuador:1760,australia:1735,"south-korea":1730,iran:1720,poland:1715,canada:1700,serbia:1695,wales:1665,ghana:1665,tunisia:1655,"ivory-coast":1655,nigeria:1645,"saudi-arabia":1640,qatar:1630,egypt:1620,algeria:1615,scotland:1610,cameroon:1600,paraguay:1595,venezuela:1590,chile:1580,peru:1575,"czech-republic":1570,"bosnia-and-herzegovina":1545,"south-africa":1520,"new-zealand":1495,panama:1480,jamaica:1460,honduras:1440,jordan:1420,haiti:1380,"el-salvador":1370,"trinidad-and-tobago":1360,guatemala:1345
};
const HOME_ADV = 75, BURN_IN = 150;
const baseK = (n = "") => { n = n.toLowerCase();
  if (/world cup(?!.*qual)/.test(n)) return 55;
  if (/world cup.*qual|qualification/.test(n)) return 40;
  if (/copa america|euro championship\b|asian cup|africa cup|gold cup/.test(n)) return 50;
  if (/nations league|nations cup/.test(n)) return 32;
  if (/friendl/.test(n)) return 18;
  return 28; };
const gMult = (gd) => { const d = Math.abs(gd); return d <= 1 ? 1 : d === 2 ? 1.5 : (11 + d) / 8; };

const { matches } = JSON.parse(readFileSync(D("results.json"), "utf8"));
const R = {};
const getR = (s, nm) => { const k = s ?? `ghost:${nm}`; if (R[k] == null) R[k] = s && SEED[s] != null ? SEED[s] : 1500; return R[k]; };
const setR = (s, nm, v) => { R[s ?? `ghost:${nm}`] = v; };

let n = 0, hit = 0, brier = 0, logloss = 0, favN = 0, favHit = 0, baseHome = 0, baseElo = 0, i = 0;
let eH = 0, eD = 0, eA = 0;
for (const m of matches) {
  if (m.hg == null || m.ag == null) continue;
  const ra = getR(m.homeSlug, m.homeName), rb = getR(m.awaySlug, m.awayName);
  if (i >= BURN_IN) {
    const p = matchProb(ra, rb, HOME_ADV);
    const probs = [p.winA, p.draw, p.winB];
    const actual = m.hg > m.ag ? 0 : m.hg < m.ag ? 2 : 1;
    const y = [actual === 0 ? 1 : 0, actual === 1 ? 1 : 0, actual === 2 ? 1 : 0];
    const pred = probs.indexOf(Math.max(...probs));
    if (pred === actual) hit++;
    brier += (probs[0]-y[0])**2 + (probs[1]-y[1])**2 + (probs[2]-y[2])**2;
    logloss += -Math.log(Math.max(1e-12, probs[actual]));
    if (Math.max(...probs) >= 0.5) { favN++; if (pred === actual) favHit++; }
    if (actual === 0) baseHome++;
    if ((expectedScore(ra, rb, HOME_ADV) >= 0.5 ? 0 : 2) === actual) baseElo++;
    if (actual === 0) eH++; else if (actual === 1) eD++; else eA++;
    n++;
  }
  const exp = expectedScore(ra, rb, HOME_ADV);
  const score = m.hg > m.ag ? 1 : m.hg < m.ag ? 0 : 0.5;
  const delta = baseK(m.leagueName) * gMult(m.hg - m.ag) * (score - exp);
  setR(m.homeSlug, m.homeName, ra + delta);
  setR(m.awaySlug, m.awayName, rb - delta);
  i++;
}

const pct = (x) => (x * 100).toFixed(1) + "%";
console.log(`\n=== Walk-forward backtest — ${n} of ${matches.length} matches (burn-in ${BURN_IN}) ===`);
console.log(`Eval outcome split: home ${pct(eH/n)}  draw ${pct(eD/n)}  away ${pct(eA/n)}\n`);
console.log(`MODEL`);
console.log(`  Accuracy (top pick):   ${pct(hit/n)}`);
console.log(`  Favourite acc (p≥50%): ${pct(favHit/favN)}  (${favN} matches)`);
console.log(`  Brier (3-way, ↓):      ${(brier/n).toFixed(3)}`);
console.log(`  Log-loss (↓):          ${(logloss/n).toFixed(3)}\n`);
console.log(`BASELINES (same matches)`);
console.log(`  Always pick home:      ${pct(baseHome/n)}`);
console.log(`  Pick higher-Elo team:  ${pct(baseElo/n)}`);
console.log(`  Coin-flip (uniform):   Brier ${(2*(1/3)**2+(1-1/3)**2).toFixed(3)} · log-loss ${(-Math.log(1/3)).toFixed(3)}\n`);
console.log(`Live title odds (full 10k-sim tournament model): https://cup26matches.com`);
