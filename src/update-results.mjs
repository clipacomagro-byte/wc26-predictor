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
  if (process.env.SPORTRADAR_KEY) return process.env.SPORTRADAR_KEY;
  try {
    const m = readFileSync(new URL("../.env", import.meta.url), "utf8").match(/^SPORTRADAR_KEY=(.+)$/m);
    if (m) return m[1].trim();
  } catch {}
  console.error("No SPORTRADAR_KEY in env or .env");
  process.exit(1);
}

const base = JSON.parse(readFileSync(new URL("../engine/data/results.json", import.meta.url), "utf8"));
const cutoff = Math.max(...base.matches.map(m => m.ts)) - 86400; // overlap a day; dedupe handles it
const key = loadKey();

const out = [];
let calls = 0;
async function fetchPage(url) {
  // trial is strictly ~1 req/s — back off and retry on 429
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    calls++;
    if (res.status === 429) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
    return res;
  }
  return null;
}
for (const season of SEASONS) {
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://api.sportradar.com/soccer/trial/v4/en/seasons/${season}/summaries.json?api_key=${key}&offset=${page * PAGE}&limit=${PAGE}`;
    const res = await fetchPage(url);
    if (!res || !res.ok) { console.error(`${season} page ${page}: HTTP ${res?.status ?? "429 after retries"}`); break; }
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

// merge with whatever we already had — a failed/partial fetch must never wipe
// previously ingested results
const EXTRA = new URL("../data/results-extra.json", import.meta.url);
let existing = [];
try { existing = JSON.parse(readFileSync(EXTRA, "utf8")).matches; } catch {}
const seen = new Set();
const merged = [];
for (const m of [...existing, ...out]) {
  const k = `${m.date}|${m.homeName}|${m.awayName}`;
  if (seen.has(k)) continue;
  seen.add(k);
  merged.push(m);
}
merged.sort((a, b) => a.ts - b.ts);
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(EXTRA, JSON.stringify({ fetchedAt: new Date().toISOString(), matches: merged }, null, 1));
console.log(`${out.length} fetched, ${merged.length} total extra results (${calls} API calls)`);
for (const m of merged.slice(-8)) console.log(`  ${m.date}  ${m.homeName} ${m.hg}-${m.ag} ${m.awayName}  [${m.leagueName}]`);
