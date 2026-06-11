// Unified match results: the engine's static dataset (ends 2026-05-29) merged
// with data/results-extra.json maintained by src/update-results.mjs (Sportradar).
// Hot-reloadable: the server calls reloadResults() after its daily data refresh;
// importers must consult dataVersion instead of caching derived data forever.
import { readFileSync, existsSync } from "node:fs";

export let matches = [];
export let lastUpdated = null;
export let dataVersion = 0;

export function reloadResults() {
  const base = JSON.parse(readFileSync(new URL("../engine/data/results.json", import.meta.url), "utf8"));
  const EXTRA = new URL("../data/results-extra.json", import.meta.url);
  const extra = existsSync(EXTRA) ? JSON.parse(readFileSync(EXTRA, "utf8")) : { matches: [] };
  const seen = new Set();
  const key = (m) => `${m.date}|${m.homeName}|${m.awayName}`;
  const merged = [];
  for (const m of [...base.matches, ...extra.matches]) {
    if (seen.has(key(m))) continue;
    seen.add(key(m));
    merged.push(m);
  }
  merged.sort((a, b) => a.ts - b.ts);
  matches = merged;
  lastUpdated = extra.fetchedAt ?? base.generatedAt;
  dataVersion++;
}

reloadResults();
