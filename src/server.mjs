#!/usr/bin/env node
// Personal match-center server. Zero dependencies.
//   node src/server.mjs            → http://localhost:3026
import { createServer } from "node:http";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { ratings, predictFromLambdas, clampAdjust, baseLambdas, manualStyle, combineStyles, cornersEstimate } from "./model.mjs";
import { intel } from "./form.mjs";
import { teamDna } from "./teamdna.mjs";
import { api, cache } from "./apifb.mjs";
import { schedule, lineups as srLineups, timeline, bracket } from "./sportradar.mjs";
import { marketOdds } from "./oddsapi.mjs";
import { expectedScore } from "../engine/elo.mjs";
import { poissonPmf } from "../engine/elo.mjs";

// Live in-play model: pre-match expected goals scaled to the time remaining,
// folded over the current score → live win/draw/loss, totals, next-goal odds.
function liveModel(preLambdaA, preLambdaB, homeScore, awayScore, minutesPlayed) {
  const EFFECTIVE = 95; // injury time included
  const left = Math.max(0, EFFECTIVE - minutesPlayed);
  const remA = preLambdaA * left / EFFECTIVE;
  const remB = preLambdaB * left / EFFECTIVE;
  let winA = 0, draw = 0, winB = 0, over25 = 0;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    const p = poissonPmf(i, remA) * poissonPmf(j, remB);
    const h = homeScore + i, a = awayScore + j;
    if (h > a) winA += p; else if (h < a) winB += p; else draw += p;
    if (h + a > 2.5) over25 += p;
  }
  const nextGoal10 = left > 0 ? 1 - Math.exp(-(remA + remB) * Math.min(10, left) / left) : 0;
  return { winA, draw, winB, over25, remA, remB, minutesLeft: left, nextGoal10 };
}

// Signal card: divergence between live pressure and the scoreboard.
function buildSignal(live, lm, pre, teamA, teamB) {
  const sh = live.statsHome, sa = live.statsAway;
  const sotDiff = (sh.shotsOnTarget ?? 0) - (sa.shotsOnTarget ?? 0);
  const scoreDiff = live.homeScore - live.awayScore;
  const notes = [];
  let strength = 1;
  // pressure not yet on the scoreboard
  if (Math.abs(sotDiff) >= 3 && Math.sign(sotDiff) !== Math.sign(scoreDiff)) {
    const presser = sotDiff > 0 ? teamA : teamB;
    notes.push(`${presser} leading shots on target ${sh.shotsOnTarget ?? 0}-${sa.shotsOnTarget ?? 0} without scoreboard reward`);
    strength += 2;
  }
  if (sh.possession != null && Math.abs(sh.possession - 50) >= 15) {
    notes.push(`${sh.possession > 50 ? teamA : teamB} controlling possession ${Math.max(sh.possession, 100 - sh.possession)}%`);
    strength += 1;
  }
  // model swing vs pre-match
  const preWinA = pre.adjusted?.winA ?? pre.baseline.winA;
  const swing = lm.winA - preWinA;
  if (Math.abs(swing) >= 0.12) {
    notes.push(`${teamA} win probability ${swing > 0 ? "up" : "down"} ${(Math.abs(swing) * 100).toFixed(0)}pts vs pre-match`);
    strength += 1;
  }
  if (lm.nextGoal10 >= 0.45) { notes.push(`high goal pressure: ${(lm.nextGoal10 * 100).toFixed(0)}% chance of a goal in the next 10 min`); strength += 1; }
  return {
    strength: Math.min(5, strength),
    edge: notes.length ? notes.join(". ") + "." : "No significant edge — match tracking the pre-match model.",
    call: `Live model: ${teamA} ${(lm.winA * 100).toFixed(0)}% / draw ${(lm.draw * 100).toFixed(0)}% / ${teamB} ${(lm.winB * 100).toFixed(0)}% · next goal in 10' ${(lm.nextGoal10 * 100).toFixed(0)}%`,
  };
}

const PORT = process.env.PORT || 3026;
const PUBLIC = new URL("../public/", import.meta.url);
const PREDICTIONS = new URL("../predictions/", import.meta.url);
const PLAYERS_FILE = new URL("../data/players.json", import.meta.url);
let playersDb = null;
function players(team) {
  playersDb ??= JSON.parse(readFileSync(PLAYERS_FILE, "utf8"));
  return playersDb.nations[team] ?? [];
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function computePrediction(q) {
  const teamA = q.get("a"), teamB = q.get("b");
  const home = q.get("home") || null;
  // "auto" (default) = data-detected team DNA; -2..2 = manual what-if override
  const sa = q.get("sa") ?? "auto", sb = q.get("sb") ?? "auto";
  const fineA = clampAdjust(parseFloat(q.get("la") ?? "1"));
  const fineB = clampAdjust(parseFloat(q.get("lb") ?? "1"));
  const base = baseLambdas(teamA, teamB, home);
  const dnaA = teamDna(teamA), dnaB = teamDna(teamB);
  const styleObjA = sa === "auto" ? dnaA : manualStyle(parseInt(sa, 10) || 0);
  const styleObjB = sb === "auto" ? dnaB : manualStyle(parseInt(sb, 10) || 0);
  const combined = combineStyles(styleObjA, styleObjB);
  const mA = combined.mA * fineA, mB = combined.mB * fineB;
  const baseline = predictFromLambdas(base.lambda, base.mu);
  const adjusted = (mA !== 1 || mB !== 1) ? predictFromLambdas(base.lambda * mA, base.mu * mB) : null;
  const f = adjusted ?? baseline;
  // corners heuristic wants a -2..2 "approach" — derive it from the attack multiplier
  const pseudo = (st) => Math.max(-2, Math.min(2, Math.round((st.attack - 1) / 0.05)));
  const corners = cornersEstimate(f.lambda, f.mu, pseudo(styleObjA), pseudo(styleObjB));
  // knockout win prob: draws go to extra time/penalties — approximate the
  // shootout with Elo expectancy, like the engine's sampleMatch does
  const eloExp = expectedScore(base.ra, base.rb, base.hb);
  const koWinA = f.winA + f.draw * eloExp;
  return {
    teamA, teamB, home, eloA: base.ra, eloB: base.rb,
    styleA: sa, styleB: sb, dnaA, dnaB, mA, mB, baseline, adjusted, corners, koWinA,
  };
}

const HOST_NATIONS = new Set(["usa", "mexico", "canada"]);

// ---- daily data refresh: pull new results from Sportradar, recalibrate Elo,
// hot-reload everything. ~3 API calls per run. No scraping — API only.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reloadResults } from "./results.mjs";
import { reloadRatings } from "./model.mjs";

function runScript(file) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], { stdio: "inherit" });
    p.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`${file} exited ${code}`)));
  });
}

let lastRefresh = null, refreshing = false;
async function refreshData() {
  if (refreshing) return;
  refreshing = true;
  try {
    await runScript("./update-results.mjs");
    await runScript("./build-teams.mjs");
    reloadResults();
    reloadRatings();
    lastRefresh = new Date().toISOString();
    console.log(`[refresh] data refreshed at ${lastRefresh}`);
  } catch (e) {
    console.error("[refresh] failed:", e.message);
  } finally {
    refreshing = false;
  }
}
// on boot + every 24h (skipped quietly if no Sportradar key configured)
refreshData();
setInterval(refreshData, 24 * 3600 * 1000).unref();

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(readFileSync(new URL("index.html", PUBLIC)));
    } else if (url.pathname === "/api/teams") {
      json(res, 200, Object.entries(ratings).sort((a, b) => b[1] - a[1]).map(([name, elo]) => ({ name, elo })));
    } else if (url.pathname === "/api/predict") {
      json(res, 200, computePrediction(url.searchParams));
    } else if (url.pathname === "/api/players") {
      json(res, 200, players(url.searchParams.get("team")));
    } else if (url.pathname === "/api/intel") {
      json(res, 200, intel(url.searchParams.get("a"), url.searchParams.get("b")));
    } else if (url.pathname === "/api/fixtures") {
      const params = { league: 1, season: 2026 };
      if (url.searchParams.get("date")) params.date = url.searchParams.get("date");
      const fixtures = await api("/fixtures", params);
      cache("fixtures_api", fixtures);
      json(res, 200, fixtures.map(f => ({
        id: f.fixture.id, date: f.fixture.date,
        home: f.teams.home.name, away: f.teams.away.name, status: f.fixture.status.short,
      })));
    } else if (url.pathname === "/api/live") {
      // live state + in-play model + signal, one Sportradar call per poll
      const q = url.searchParams;
      const live = await timeline(q.get("event"));
      const pre = computePrediction(q);
      const f = pre.adjusted ?? pre.baseline;
      const clockMin = live.clock ? parseInt(live.clock.split(":")[0], 10) : 0;
      const mins = live.matchStatus === "2nd_half" ? Math.max(clockMin, 45) : clockMin;
      const lm = liveModel(f.lambda, f.mu, live.homeScore, live.awayScore, mins);
      const signal = buildSignal(live, lm, pre, q.get("a"), q.get("b"));
      json(res, 200, { live, model: lm, signal, pre: { winA: f.winA, draw: f.draw, winB: f.winB } });
    } else if (url.pathname === "/api/refresh" && req.method === "POST") {
      refreshData();
      json(res, 200, { started: true, lastRefresh });
    } else if (url.pathname === "/api/bracket") {
      json(res, 200, await bracket());
    } else if (url.pathname === "/api/oddsboard") {
      // model probabilities + fair odds + bookmaker consensus for every match
      const sched = await schedule();
      let market = { available: false, events: [] };
      try { market = await marketOdds({ force: url.searchParams.get("force") === "1" }); }
      catch (e) { market.reason = e.message; }
      const findMarket = (m) => market.events.find(o =>
        o.homeSlug === m.homeSlug && o.awaySlug === m.awaySlug &&
        Math.abs(new Date(o.commence) - new Date(m.start)) < 36e5 * 6);
      json(res, 200, {
        market: { available: market.available, fetchedAt: market.fetchedAt ?? null, remaining: market.remaining ?? null, reason: market.reason ?? null },
        rows: sched.map(m => {
          const mk = findMarket(m);
          if (ratings[m.homeSlug] == null || ratings[m.awaySlug] == null) {
            return { ...m, model: null, mk: mk ?? null };
          }
          const home = HOST_NATIONS.has(m.homeSlug) ? m.homeSlug : HOST_NATIONS.has(m.awaySlug) ? m.awaySlug : "";
          const p = computePrediction(new URLSearchParams({ a: m.homeSlug, b: m.awaySlug, home }));
          const f = p.adjusted ?? p.baseline;
          // divergence flag: model sees ≥8pts more probability than the de-margined
          // market. NOT betting advice — historically the closing market beats Elo
          // models; treat flags as "model disagrees here, find out why".
          let value = null;
          if (mk?.implied) {
            const edges = [
              { side: "1", team: m.homeName, edge: f.winA - mk.implied.home, odds: mk.odds.home },
              { side: "X", team: "draw", edge: f.draw - mk.implied.draw, odds: mk.odds.draw },
              { side: "2", team: m.awayName, edge: f.winB - mk.implied.away, odds: mk.odds.away },
            ].filter(x => x.edge >= 0.08).sort((a, b) => b.edge - a.edge);
            if (edges.length) value = edges[0];
          }
          return {
            ...m, mk: mk ?? null, value,
            model: {
              winA: f.winA, draw: f.draw, winB: f.winB, over25: f.over25,
              fairA: 1 / f.winA, fairD: 1 / f.draw, fairB: 1 / f.winB,
              topScore: f.topScorelines[0],
            },
          };
        }),
      });
    } else if (url.pathname === "/api/matches") {
      json(res, 200, await schedule({ force: url.searchParams.get("force") === "1" }));
    } else if (url.pathname === "/api/lineups") {
      const event = url.searchParams.get("event");
      if (event) {
        json(res, 200, await srLineups(event));
      } else {
        // legacy API-Football path (fixture id)
        const fixture = url.searchParams.get("fixture");
        const lu = await api("/fixtures/lineups", { fixture });
        cache(`lineups_${fixture}`, lu);
        json(res, 200, lu.map(t => ({
          team: t.team.name, formation: t.formation,
          starters: t.startXI.map(p => ({ name: p.player.name, number: p.player.number, position: p.player.pos })),
          bench: t.substitutes.map(p => p.player.name),
        })));
      }
    } else if (url.pathname === "/api/predictions") {
      if (!existsSync(PREDICTIONS)) return json(res, 200, []);
      const files = readdirSync(PREDICTIONS).filter(f => f.endsWith(".json")).sort().reverse();
      json(res, 200, files.map(f => ({ file: f, ...JSON.parse(readFileSync(new URL(f, PREDICTIONS), "utf8")) })));
    } else if (url.pathname === "/api/save" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const b = JSON.parse(body);
      const p = computePrediction(new URLSearchParams({
        a: b.teamA, b: b.teamB, home: b.home ?? "", sa: String(b.styleA ?? "auto"), sb: String(b.styleB ?? "auto"),
      }));
      mkdirSync(PREDICTIONS, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const file = `${stamp}_${b.teamA}-vs-${b.teamB}.json`;
      writeFileSync(new URL(file, PREDICTIONS), JSON.stringify({
        date: new Date().toISOString(),
        teamA: b.teamA, teamB: b.teamB, home: b.home ?? null,
        eloA: p.eloA, eloB: p.eloB,
        styleA: p.styleA, styleB: p.styleB, dnaA: p.dnaA, dnaB: p.dnaB, mA: p.mA, mB: p.mB,
        formationA: b.formationA ?? null, formationB: b.formationB ?? null,
        lineupA: b.lineupA ?? null, lineupB: b.lineupB ?? null,
        baseline: p.baseline, adjusted: p.adjusted, corners: p.corners,
        reasoning: b.reasoning || "",
        actual: null, // after the match: { goalsA, goalsB, corners }
      }, null, 2));
      json(res, 200, { saved: file });
    } else if (url.pathname === "/api/actual" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { file, goalsA, goalsB } = JSON.parse(body);
      if (!/^[\w\-.]+\.json$/.test(file)) return json(res, 400, { error: "bad filename" });
      const target = new URL(file, PREDICTIONS);
      const data = JSON.parse(readFileSync(target, "utf8"));
      data.actual = { goalsA: Number(goalsA), goalsB: Number(goalsB) };
      writeFileSync(target, JSON.stringify(data, null, 2));
      json(res, 200, { updated: file });
    } else {
      json(res, 404, { error: "not found" });
    }
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

server.listen(PORT, () => console.log(`wc26 match center → http://localhost:${PORT}`));
