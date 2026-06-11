// Unified match results: the engine's static dataset (ends 2026-05-29) merged
// with data/results-extra.json maintained by src/update-results.mjs (Sportradar).
import { readFileSync, existsSync } from "node:fs";

const base = JSON.parse(readFileSync(new URL("../engine/data/results.json", import.meta.url), "utf8"));
const EXTRA = new URL("../data/results-extra.json", import.meta.url);
const extra = existsSync(EXTRA) ? JSON.parse(readFileSync(EXTRA, "utf8")) : { matches: [] };

const seen = new Set();
const key = (m) => `${m.date}|${m.homeName}|${m.awayName}`;
export const matches = [];
for (const m of [...base.matches, ...extra.matches]) {
  if (seen.has(key(m))) continue;
  seen.add(key(m));
  matches.push(m);
}
matches.sort((a, b) => a.ts - b.ts);
export const lastUpdated = extra.fetchedAt ?? base.generatedAt;
