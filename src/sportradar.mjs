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

// Tournament structure from the cached schedule: 12 real groups + the official
// knockout tree with FIFA placeholder slots ("1A", "2B", "3A/3B/3C/3D/3F", "W73", "RU101").
export async function bracket() {
  await schedule(); // ensure cache exists/fresh
  const raw = JSON.parse(readFileSync(SCHEDULE_CACHE, "utf8"));
  const groups = {};
  const knockout = [];
  for (const s of raw.schedules) {
    const ctx = s.sport_event.sport_event_context;
    if (ctx?.stage?.type === "league") {
      const gname = ctx.groups?.[0]?.name?.split("Group ")[1];
      if (!gname) continue;
      groups[gname] ??= new Set();
      for (const c of s.sport_event.competitors ?? []) groups[gname].add(slugForName(c.name));
    } else if (ctx?.stage?.type === "cup") {
      knockout.push({
        n: ctx.round.competition_sport_event_number,
        round: ctx.round.name,
        date: s.sport_event.start_time.slice(0, 10),
        event: s.sport_event.id,
        slots: (s.sport_event.competitors ?? []).map(c => c.name), // e.g. "1A", "W73", "3A/3B/3C/3D/3F"
      });
    }
  }
  knockout.sort((a, b) => a.n - b.n);
  return { groups: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, [...v]])), knockout };
}

// Live match state: score, clock, key stats, event timeline. One API call.
// Parsed defensively — exact stat keys vary by coverage level.
export async function timeline(eventId) {
  if (!/^sr:sport_event:\d+$/.test(eventId)) throw new Error("bad event id");
  const raw = await sr(`/sport_events/${eventId}/timeline.json`);
  const st = raw.sport_event_status ?? {};
  const comps = raw.statistics?.totals?.competitors ?? [];
  const statFor = (qualifier) => {
    const c = comps.find(x => x.qualifier === qualifier);
    const s = c?.statistics ?? {};
    return {
      possession: s.ball_possession ?? null,
      shotsTotal: s.shots_total ?? null,
      shotsOnTarget: s.shots_on_target ?? null,
      corners: s.corner_kicks ?? null,
      yellow: s.yellow_cards ?? null,
      red: s.red_cards ?? null,
    };
  };
  const ICONS = {
    score_change: "⚽", yellow_card: "🟨", red_card: "🟥", yellow_red_card: "🟥",
    substitution: "🔁", penalty_missed: "❌", penalty_awarded: "⚠️",
    match_started: "▶", period_start: "▶", break_start: "⏸", match_ended: "🏁",
    injury_time_shown: "⏱", video_assistant_referee: "📺", corner_kick: "🚩",
  };
  const events = (raw.timeline ?? [])
    .filter(e => ICONS[e.type])
    .map(e => ({
      minute: e.match_time ?? null,
      stoppage: e.stoppage_time ?? null,
      icon: ICONS[e.type],
      type: e.type,
      side: e.competitor ?? null, // "home" | "away"
      text: describeEvent(e),
      score: e.type === "score_change" ? `${e.home_score}-${e.away_score}` : null,
    }));
  return {
    status: st.status ?? "unknown",
    matchStatus: st.match_status ?? null,
    clock: st.clock?.played ?? null,
    homeScore: st.home_score ?? 0,
    awayScore: st.away_score ?? 0,
    statsHome: statFor("home"),
    statsAway: statFor("away"),
    events,
  };
}

function describeEvent(e) {
  const players = (e.players ?? []).map(p => p.name?.includes(", ") ? p.name.split(", ").reverse().join(" ") : p.name);
  switch (e.type) {
    case "score_change": return `GOAL — ${players[0] ?? ""}${players[1] ? ` (assist ${players[1]})` : ""}`;
    case "substitution": return `${players[1] ?? "?"} on, ${players[0] ?? "?"} off`;
    case "yellow_card": case "red_card": case "yellow_red_card": return players[0] ?? "";
    case "penalty_awarded": return "Penalty awarded";
    case "penalty_missed": return `Penalty missed${players[0] ? ` — ${players[0]}` : ""}`;
    case "match_started": return "Kick-off";
    case "period_start": return `Period ${e.period ?? ""} start`;
    case "break_start": return "Half-time";
    case "match_ended": return "Full-time";
    case "injury_time_shown": return `+${e.injury_time_announced ?? "?"} min added`;
    case "video_assistant_referee": return "VAR check";
    default: return e.type;
  }
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
