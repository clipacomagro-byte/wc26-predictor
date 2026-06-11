#!/usr/bin/env node
// Pull international results newer than the engine's static dataset from
// Sportradar and write data/results-extra.json. Sources:
//   - Int. Friendly Games 2026 (sr:season:137504) — pre-tournament friendlies
//   - World Cup 2026 (sr:season:101177) — tournament results as they happen
// Run: node src/update-results.mjs   (a few API calls; rerun daily during the WC)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const SEASONS = ["sr:season:137504", "sr:season:101177"];
const PAGE = 100;     // the API caps pages at 100 regardless of limit param
const MAX_PAGES = 12; // quota guard

function loadKey() {
  const m = readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^SPORTRADAR_KEY=(.+)$/m);
  if (!m) { console.error("No SPORTRADAR_KEY in .env"); process.exit(1); }
  return m[1].trim();
}

const base = JSON.parse(readFileSync(new URL("../engine/data/results.json", import.meta.url), "utf8"));
const cutoff = Math.max(...base.matches.map(m => m.ts)) - 86400; // overlap a day; dedupe handles it
const key = loadKey();

const out = [];
let calls = 0;
for (const season of SEASONS) {
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.sportradar.com/soccer/trial/v4/en/seasons/${season}/summaries.json?api_key=${key}&offset=${page * PAGE}&limit=${PAGE}`;
    const res = await fetch(url);
    calls++;
    if (!res.ok) { console.error(`${season} page ${page}: HTTP ${res.status}`); break; }
    const { summaries } = await res.json();
    if (!summaries?.length) break;
    for (const s of summaries) {
      const ev = s.sport_event, st = s.sport_event_status;
      if (st.status !== "closed" || st.home_score == null) continue;
      const ts = Math.floor(new Date(ev.start_time).getTime() / 1000);
      if (ts < cutoff) continue;
      const isWC = ev.sport_event_context?.competition?.id === "sr:competition:16";
      out.push({
        id: ev.id,
        ts,
        date: ev.start_time.slice(0, 10),
        homeSlug: null, awaySlug: null, // resolved by slugs.mjs from names
        homeName: ev.competitors[0].name,
        awayName: ev.competitors[1].name,
        hg: st.home_score, ag: st.away_score,
        leagueId: null,
        leagueName: isWC ? "World Cup" : "Friendlies",
      });
    }
    if (summaries.length < PAGE) break;
    await new Promise(r => setTimeout(r, 1100)); // trial ~1 req/s
  }
}

out.sort((a, b) => a.ts - b.ts);
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/results-extra.json", import.meta.url),
  JSON.stringify({ fetchedAt: new Date().toISOString(), matches: out }, null, 1));
console.log(`${out.length} results newer than ${new Date(cutoff * 1000).toISOString().slice(0, 10)} (${calls} API calls)`);
for (const m of out.slice(-12)) console.log(`  ${m.date}  ${m.homeName} ${m.hg}-${m.ag} ${m.awayName}  [${m.leagueName}]`);
