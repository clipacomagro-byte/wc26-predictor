// Team DNA: auto-detected playing style from real results.
//
// For every past match we know what the Elo model EXPECTED each team to score.
// A team that systematically scores above expectation and concedes above
// expectation plays open, front-foot football; one that under-scores and
// under-concedes sits in a block. The ratios are exactly lambda multipliers,
// so they plug straight into the Dixon-Coles model.
//
// Approximation: current calibrated Elo stands in for historical Elo (drifts
// are small over the 2-year window). Unrated opponents get a 1500 default.
// Low samples shrink toward 1.0 via a pseudo-match prior.
import { ratings } from "./model.mjs";
import { expectedGoals } from "../engine/elo.mjs";
import { sideSlug } from "./slugs.mjs";
import { matches } from "./results.mjs";

const HOME_BONUS = 75;
const DEFAULT_ELO = 1500;
const HALF_LIFE_DAYS = 365;     // recent matches count more
const PRIOR_WEIGHT = 6;         // pseudo-matches at ratio 1.0
const CLAMP = [0.85, 1.18];

const NOW = Math.max(...matches.map(m => m.ts));

const cache = new Map();

export function teamDna(team) {
  if (cache.has(team)) return cache.get(team);
  const elo = ratings[team];
  let wSum = 0, gFor = 0, expFor = 0, gAg = 0, expAg = 0, n = 0;
  for (const m of matches) {
    const hs = sideSlug(m, "home"), as = sideSlug(m, "away");
    const isHome = hs === team, isAway = as === team;
    if (!isHome && !isAway) continue;
    const oppElo = ratings[isHome ? as : hs] ?? DEFAULT_ELO;
    // friendlies are usually neutral-venue despite a nominal home side
    const neutral = m.leagueName === "Friendlies";
    // engine convention (matchProb): home side gets +HOME_BONUS, away side -HOME_BONUS/2
    const hbTeam = neutral ? 0 : isHome ? HOME_BONUS : -HOME_BONUS / 2;
    const hbOpp = neutral ? 0 : isHome ? -HOME_BONUS / 2 : HOME_BONUS;
    const lambda = expectedGoals(elo, oppElo, hbTeam);
    const mu = expectedGoals(oppElo, elo, hbOpp);
    // skip mismatches where the goal model sits on its floor/cap — it can't
    // distinguish style from strength there (e.g. elite vs minnow)
    if (lambda <= 0.3 || lambda >= 3.5 || mu <= 0.3 || mu >= 3.5) continue;
    const w = Math.pow(0.5, (NOW - m.ts) / 86400 / HALF_LIFE_DAYS);
    wSum += w; n++;
    gFor += w * (isHome ? m.hg : m.ag);
    expFor += w * lambda;
    gAg += w * (isHome ? m.ag : m.hg);
    expAg += w * mu;
  }
  // shrink toward 1.0: add PRIOR_WEIGHT pseudo-matches scoring exactly as expected
  const priorFor = wSum > 0 ? (expFor / wSum) * PRIOR_WEIGHT : 1;
  const priorAg = wSum > 0 ? (expAg / wSum) * PRIOR_WEIGHT : 1;
  const clamp = (x) => Math.max(CLAMP[0], Math.min(CLAMP[1], x));
  const attack = clamp((gFor + priorFor) / (expFor + priorFor));    // >1 over-scores vs Elo
  const leak = clamp((gAg + priorAg) / (expAg + priorAg));          // >1 over-concedes vs Elo
  const dna = { attack, leak, n, label: label(attack, leak) };
  cache.set(team, dna);
  return dna;
}

function label(attack, leak) {
  const a = attack >= 1.05 ? 2 : attack >= 1.02 ? 1 : attack <= 0.95 ? -2 : attack <= 0.98 ? -1 : 0;
  const d = leak >= 1.05 ? 2 : leak >= 1.02 ? 1 : leak <= 0.95 ? -2 : leak <= 0.98 ? -1 : 0;
  if (a >= 1 && d >= 1) return "open, all-out";
  if (a >= 1 && d <= -1) return "dominant front-foot";
  if (a >= 1) return "front-foot";
  if (a <= -1 && d <= -1) return "low block, tight";
  if (a <= -1 && d >= 1) return "struggling both ways";
  if (a <= -1) return "conservative";
  if (d <= -1) return "solid, hard to break";
  if (d >= 1) return "leaky";
  return "balanced";
}
