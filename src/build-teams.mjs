#!/usr/bin/env node
// Build data/teams.json — Elo ratings for the ACTUAL 48 qualified WC2026 teams.
//
// The engine's elo-calibrated.json was seeded before the March 2026 playoffs:
// it includes non-qualifiers (Italy, Denmark, Poland, ...) and lacks nine real
// qualifiers (Norway, Turkey, Austria, Sweden, Uzbekistan, Iraq, Cape Verde,
// DR Congo, Curaçao). This replicates the engine's calibration (same K-factors,
// recency weighting, goal-margin multiplier, 70/30 prior blend) over the same
// 920 matches, but with the real finalist list and our slug resolver, which
// also fixes teams the engine tracked under ghost names.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { slugForName } from "./slugs.mjs";

// the 48 qualified teams (per FIFA, after March 2026 playoffs)
export const QUALIFIED = {
  // AFC
  australia: null, iran: null, iraq: 1540, japan: null, jordan: null,
  qatar: null, "saudi-arabia": null, "south-korea": null, uzbekistan: 1590,
  // CAF
  algeria: null, "cape-verde": 1540, "dr-congo": 1560, egypt: null, ghana: null,
  "ivory-coast": null, morocco: null, senegal: null, "south-africa": null, tunisia: null,
  // CONCACAF (hosts: usa, mexico, canada)
  canada: null, curacao: 1480, haiti: null, mexico: null, panama: null, usa: null,
  // CONMEBOL
  argentina: null, brazil: null, colombia: null, ecuador: null, paraguay: null, uruguay: null,
  // OFC
  "new-zealand": null,
  // UEFA
  austria: 1730, belgium: null, "bosnia-and-herzegovina": null, croatia: null,
  "czech-republic": null, england: null, france: null, germany: null, netherlands: null,
  norway: 1760, portugal: null, scotland: null, spain: null, sweden: 1640,
  switzerland: null, turkey: 1720,
};
// null = seed from the engine's prior; number = our prior for teams it never seeded

const ENGINE_SEED = JSON.parse(readFileSync(new URL("../engine/data/elo-calibrated.json", import.meta.url), "utf8")).ratings;
// engine seeds (its calibrate.mjs SEED) double as long-run priors; for teams the
// engine rated we reuse its calibrated value as the prior — same spirit, fresher.
const seedFor = (slug) => QUALIFIED[slug] ?? ENGINE_SEED[slug] ?? 1500;

const HOST = new Set(["mexico", "usa", "canada"]);
const HOME_ADV = 75;
function baseK(leagueName = "") {
  const n = leagueName.toLowerCase();
  if (/world cup(?!.*qual)/.test(n)) return 55;
  if (/world cup.*qual|qualification/.test(n)) return 40;
  if (/copa america|euro championship\b|asian cup|africa cup|gold cup/.test(n)) return 50;
  if (/nations league|nations cup/.test(n)) return 32;
  if (/friendl/.test(n)) return 18;
  return 28;
}
const recency = (tsSec, nowSec) => Math.pow(0.5, ((nowSec - tsSec) / (30.44 * 86400)) / 18);
const expectedScore = (a, b, hb) => 1 / (1 + Math.pow(10, (b - (a + hb)) / 400));
const gMult = (gd) => { const d = Math.abs(gd); return d <= 1 ? 1 : d === 2 ? 1.5 : (11 + d) / 8; };

const { matches } = await import("./results.mjs");
const nowSec = matches[matches.length - 1].ts;

const R = {};
const matchCounts = {};
const getR = (slug) => R[slug] ??= seedFor(slug);

for (const m of matches) {
  if (m.hg == null || m.ag == null) continue;
  const hs = slugForName(m.homeName), as = slugForName(m.awayName);
  const ra = getR(hs), rb = getR(as);
  const homeBonus = HOST.has(hs) ? HOME_ADV / 2 : 0;
  const exp = expectedScore(ra, rb, homeBonus);
  const score = m.hg > m.ag ? 1 : m.hg < m.ag ? 0 : 0.5;
  const k = baseK(m.leagueName) * recency(m.ts, nowSec) * gMult(m.hg - m.ag);
  R[hs] = ra + k * (score - exp);
  R[as] = rb - k * (score - exp);
  matchCounts[hs] = (matchCounts[hs] ?? 0) + 1;
  matchCounts[as] = (matchCounts[as] ?? 0) + 1;
}

const ratings = {};
for (const slug of Object.keys(QUALIFIED)) {
  ratings[slug] = Math.round(0.7 * (R[slug] ?? seedFor(slug)) + 0.3 * seedFor(slug));
}

mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/teams.json", import.meta.url),
  JSON.stringify({ built: new Date().toISOString(), note: "48 qualified WC2026 teams", ratings }, null, 2));

console.log("48 qualified teams calibrated:");
for (const [slug, elo] of Object.entries(ratings).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${slug.padEnd(24)} ${elo}  (${matchCounts[slug] ?? 0} matches)`);
}
