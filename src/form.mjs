// Form & head-to-head intel from engine/data/results.json (920 internationals 2023-2026).
import { readFileSync } from "node:fs";
import { sideSlug } from "./slugs.mjs";

const { matches } = JSON.parse(
  readFileSync(new URL("../engine/data/results.json", import.meta.url), "utf8")
);
// newest first, with reliable slugs resolved once
const sorted = [...matches]
  .map(m => ({ ...m, homeSlug: sideSlug(m, "home"), awaySlug: sideSlug(m, "away") }))
  .sort((a, b) => b.ts - a.ts);

function rowFor(m, team) {
  const isHome = m.homeSlug === team;
  const gf = isHome ? m.hg : m.ag, ga = isHome ? m.ag : m.hg;
  return {
    date: m.date,
    opponent: isHome ? m.awaySlug : m.homeSlug,
    opponentName: isHome ? m.awayName : m.homeName,
    venue: isHome ? "H" : "A",
    gf, ga,
    result: gf > ga ? "W" : gf < ga ? "L" : "D",
    league: m.leagueName,
  };
}

// Last n matches for a team. venue: "H" | "A" | null (all).
export function teamForm(team, { venue = null, n = 5 } = {}) {
  const rows = [];
  for (const m of sorted) {
    if (m.homeSlug !== team && m.awaySlug !== team) continue;
    const r = rowFor(m, team);
    if (venue && r.venue !== venue) continue;
    rows.push(r);
    if (rows.length >= n) break;
  }
  return rows;
}

export function formSummary(rows) {
  const s = { W: 0, D: 0, L: 0, gf: 0, ga: 0 };
  for (const r of rows) { s[r.result]++; s.gf += r.gf; s.ga += r.ga; }
  return s;
}

// All meetings between the two teams in the dataset, newest first.
export function headToHead(a, b) {
  return sorted
    .filter(m => (m.homeSlug === a && m.awaySlug === b) || (m.homeSlug === b && m.awaySlug === a))
    .map(m => ({ ...rowFor(m, a), perspective: a }));
}

export function intel(a, b) {
  return {
    formA: { overall: teamForm(a), home: teamForm(a, { venue: "H" }), away: teamForm(a, { venue: "A" }) },
    formB: { overall: teamForm(b), home: teamForm(b, { venue: "H" }), away: teamForm(b, { venue: "A" }) },
    h2h: headToHead(a, b),
  };
}
