// The Odds API client (free tier: 500 credits/mo; one h2h+totals EU call = 2 credits).
// Cached hard — default refresh every 6h ≈ 8 credits/day ≈ 250/month for the tournament.
// Uses MEDIAN price across bookmakers: robust to single-book data errors (seen live:
// one book had Mexico/Draw swapped on day one).
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { slugForName } from "./slugs.mjs";

const SPORT = "soccer_fifa_world_cup";
const CACHE = new URL("../data-cache/odds_cache.json", import.meta.url);
const MAX_AGE_MIN = 360;

function loadKey() {
  if (process.env.ODDS_API_KEY) return process.env.ODDS_API_KEY;
  const envFile = new URL("../.env", import.meta.url);
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(/^ODDS_API_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

export async function marketOdds({ force = false } = {}) {
  const key = loadKey();
  if (!key) return { available: false, reason: "no ODDS_API_KEY in .env", events: [] };
  let raw, fetchedAt, remaining = null;
  if (!force && existsSync(CACHE) && (Date.now() - statSync(CACHE).mtimeMs) / 60000 < MAX_AGE_MIN) {
    ({ raw, fetchedAt, remaining } = JSON.parse(readFileSync(CACHE, "utf8")));
  } else {
    const res = await fetch(`https://api.the-odds-api.com/v4/sports/${SPORT}/odds/?apiKey=${key}&regions=eu&markets=h2h,totals&oddsFormat=decimal`);
    if (!res.ok) throw new Error(`Odds API ${res.status}: ${(await res.text()).slice(0, 200)}`);
    raw = await res.json();
    remaining = res.headers.get("x-requests-remaining");
    fetchedAt = new Date().toISOString();
    mkdirSync(new URL("../data-cache/", import.meta.url), { recursive: true });
    writeFileSync(CACHE, JSON.stringify({ raw, fetchedAt, remaining }));
  }
  const events = raw.map(e => {
    const h2h = { home: [], draw: [], away: [] };
    const totals = { over: [], under: [] };
    for (const b of e.bookmakers) {
      const m = b.markets.find(x => x.key === "h2h");
      for (const o of m?.outcomes ?? []) {
        if (o.name === e.home_team) h2h.home.push(o.price);
        else if (o.name === e.away_team) h2h.away.push(o.price);
        else if (o.name === "Draw") h2h.draw.push(o.price);
      }
      const t = b.markets.find(x => x.key === "totals");
      for (const o of t?.outcomes ?? []) {
        if (o.point !== 2.5) continue;
        (o.name === "Over" ? totals.over : totals.under).push(o.price);
      }
    }
    const mh = median(h2h.home), md = median(h2h.draw), ma = median(h2h.away);
    // implied probabilities with the overround stripped
    let implied = null;
    if (mh && md && ma) {
      const s = 1 / mh + 1 / md + 1 / ma;
      implied = { home: 1 / mh / s, draw: 1 / md / s, away: 1 / ma / s, overround: s };
    }
    return {
      homeSlug: slugForName(e.home_team), awaySlug: slugForName(e.away_team),
      commence: e.commence_time, books: e.bookmakers.length,
      odds: { home: mh, draw: md, away: ma, over25: median(totals.over), under25: median(totals.under) },
      implied,
    };
  });
  return { available: true, fetchedAt, remaining, events };
}
