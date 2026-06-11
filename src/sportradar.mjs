// Sportradar Soccer v4 client (trial tier: ~1 req/s, modest quota — cache hard).
// Key: SPORTRADAR_KEY in .env. WC2026 season: sr:season:101177.
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { slugForName } from "./slugs.mjs";

const HOST = "https://api.sportradar.com/soccer/trial/v4/en";
export const WC_SEASON = "sr:season:101177";
const CACHE_DIR = new URL("../data-cache/", import.meta.url);
const SCHEDULE_CACHE = new URL("sr_schedule.json", CACHE_DIR);
const SCHEDULE_MAX_AGE_MIN = 360; // refetch schedule every 6h (scores/status update)

function loadKey() {
  if (process.env.SPORTRADAR_KEY) return process.env.SPORTRADAR_KEY;
  const envFile = new URL("../.env", import.meta.url);
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(/^SPORTRADAR_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

async function sr(path) {
  const key = loadKey();
  if (!key) throw new Error("No SPORTRADAR_KEY in .env");
  const res = await fetch(`${HOST}${path}?api_key=${key}`);
  if (res.status === 429) throw new Error("Sportradar rate/quota limit hit — try again in a minute");
  if (!res.ok) throw new Error(`Sportradar ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Full WC2026 schedule, cached. Returns matches mapped to our team slugs.
export async function schedule({ force = false } = {}) {
  let raw;
  if (!force && existsSync(SCHEDULE_CACHE) &&
      (Date.now() - statSync(SCHEDULE_CACHE).mtimeMs) / 60000 < SCHEDULE_MAX_AGE_MIN) {
    raw = JSON.parse(readFileSync(SCHEDULE_CACHE, "utf8"));
  } else {
    raw = await sr(`/seasons/${WC_SEASON}/schedules.json`);
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(SCHEDULE_CACHE, JSON.stringify(raw));
  }
  return raw.schedules.map(s => {
    const [h, a] = s.sport_event.competitors;
    return {
      event: s.sport_event.id,
      start: s.sport_event.start_time,
      homeName: h.name, awayName: a.name,
      homeSlug: slugForName(h.name), awaySlug: slugForName(a.name),
      status: s.sport_event_status?.status ?? "not_started",
      homeScore: s.sport_event_status?.home_score ?? null,
      awayScore: s.sport_event_status?.away_score ?? null,
    };
  });
}

// Confirmed lineups for a sport_event (published ~1h before kickoff).
export async function lineups(eventId) {
  if (!/^sr:sport_event:\d+$/.test(eventId)) throw new Error("bad event id");
  const raw = await sr(`/sport_events/${eventId}/lineups.json`);
  const flip = (n) => n.includes(", ") ? n.split(", ").reverse().join(" ") : n;
  return (raw.lineups?.competitors ?? []).map(c => ({
    team: c.name,
    slug: slugForName(c.name),
    formation: c.formation || null,
    starters: (c.players ?? []).filter(p => p.starter).map(p => ({
      name: flip(p.name), number: p.jersey_number ?? null, position: p.position ?? null,
    })),
    bench: (c.players ?? []).filter(p => !p.starter).map(p => flip(p.name)),
  }));
}
