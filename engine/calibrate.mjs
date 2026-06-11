#!/usr/bin/env node
// Calibrate Elo ratings on real recent internationals (data/results.json) → data/elo-calibrated.json.
// Seeds from long-run strength priors, then nudges with actual form (importance- & recency-weighted).
//   node calibrate.mjs
import { readFileSync, writeFileSync } from "node:fs";

const D = (f) => new URL(`./data/${f}`, import.meta.url);

// Long-run strength priors (Elo anchors) for the 48 finalists.
const SEED = {
  argentina:2085,france:2065,spain:2055,brazil:2045,england:2000,portugal:1980,netherlands:1965,germany:1945,belgium:1925,italy:1915,colombia:1890,uruguay:1875,croatia:1870,morocco:1840,switzerland:1825,usa:1830,mexico:1825,japan:1810,senegal:1795,denmark:1790,ecuador:1760,australia:1735,"south-korea":1730,iran:1720,poland:1715,canada:1700,serbia:1695,wales:1665,ghana:1665,tunisia:1655,"ivory-coast":1655,nigeria:1645,"saudi-arabia":1640,qatar:1630,egypt:1620,algeria:1615,scotland:1610,cameroon:1600,paraguay:1595,venezuela:1590,chile:1580,peru:1575,"czech-republic":1570,"bosnia-and-herzegovina":1545,"south-africa":1520,"new-zealand":1495,panama:1480,jamaica:1460,honduras:1440,jordan:1420,haiti:1380,"el-salvador":1370,"trinidad-and-tobago":1360,guatemala:1345
};
const HOST = new Set(["mexico", "usa", "canada"]);
const HOME_ADV = 75;

// Match-importance K-factor by competition.
function baseK(leagueName = "") {
  const n = leagueName.toLowerCase();
  if (/world cup(?!.*qual)/.test(n)) return 55;
  if (/world cup.*qual|qualification/.test(n)) return 40;
  if (/copa america|euro championship\b|asian cup|africa cup|gold cup/.test(n)) return 50;
  if (/nations league|nations cup/.test(n)) return 32;
  if (/friendl/.test(n)) return 18;
  return 28;
}
const recency = (tsSec, nowSec) => Math.pow(0.5, ((nowSec - tsSec) / (30.44 * 86400)) / 18); // 18-mo half-life
const expectedScore = (a, b, hb) => 1 / (1 + Math.pow(10, (b - (a + hb)) / 400));
const gMult = (gd) => { const d = Math.abs(gd); return d <= 1 ? 1 : d === 2 ? 1.5 : (11 + d) / 8; };

const { matches } = JSON.parse(readFileSync(D("results.json"), "utf8"));
const nowSec = matches.length ? matches[matches.length - 1].ts : Math.floor(Date.now() / 1000);

const R = {};
const getR = (slug, name) => { const k = slug ?? `ghost:${name}`; if (R[k] == null) R[k] = slug && SEED[slug] != null ? SEED[slug] : 1500; return R[k]; };
const setR = (slug, name, v) => { R[slug ?? `ghost:${name}`] = v; };

let applied = 0;
for (const m of matches) {
  if (m.hg == null || m.ag == null) continue;
  const ra = getR(m.homeSlug, m.homeName), rb = getR(m.awaySlug, m.awayName);
  const homeBonus = HOST.has(m.homeSlug) ? HOME_ADV / 2 : 0;
  const exp = expectedScore(ra, rb, homeBonus);
  const score = m.hg > m.ag ? 1 : m.hg < m.ag ? 0 : 0.5;
  const k = baseK(m.leagueName) * recency(m.ts, nowSec) * gMult(m.hg - m.ag);
  const delta = k * (score - exp);
  setR(m.homeSlug, m.homeName, ra + delta);
  setR(m.awaySlug, m.awayName, rb - delta);
  applied++;
}

// 70% calibrated + 30% prior (damps friendly noise).
const ratings = {};
for (const slug of Object.keys(SEED)) ratings[slug] = Math.round(0.7 * (R[slug] ?? SEED[slug]) + 0.3 * SEED[slug]);

writeFileSync(D("elo-calibrated.json"), JSON.stringify({ matchesApplied: applied, ratings }, null, 2) + "\n");
console.log(`Calibrated ${Object.keys(ratings).length} teams from ${applied} weighted matches → data/elo-calibrated.json`);
