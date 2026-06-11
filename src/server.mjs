#!/usr/bin/env node
// Personal match-center server. Zero dependencies.
//   node src/server.mjs            → http://localhost:3026
import { createServer } from "node:http";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { ratings, predictFromLambdas, clampAdjust, baseLambdas, styleMultipliers, cornersEstimate } from "./model.mjs";
import { intel } from "./form.mjs";
import { api, cache } from "./apifb.mjs";

const PORT = process.env.PORT || 3026;
const PUBLIC = new URL("../public/", import.meta.url);
const PREDICTIONS = new URL("../predictions/", import.meta.url);

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function computePrediction(q) {
  const teamA = q.get("a"), teamB = q.get("b");
  const home = q.get("home") || null;
  const styleA = parseInt(q.get("sa") ?? "0", 10) || 0;
  const styleB = parseInt(q.get("sb") ?? "0", 10) || 0;
  const fineA = clampAdjust(parseFloat(q.get("la") ?? "1"));
  const fineB = clampAdjust(parseFloat(q.get("lb") ?? "1"));
  const base = baseLambdas(teamA, teamB, home);
  const style = styleMultipliers(styleA, styleB);
  const mA = style.mA * fineA, mB = style.mB * fineB;
  const baseline = predictFromLambdas(base.lambda, base.mu);
  const adjusted = (mA !== 1 || mB !== 1) ? predictFromLambdas(base.lambda * mA, base.mu * mB) : null;
  const f = adjusted ?? baseline;
  const corners = cornersEstimate(f.lambda, f.mu, styleA, styleB);
  return { teamA, teamB, home, eloA: base.ra, eloB: base.rb, styleA, styleB, mA, mB, baseline, adjusted, corners };
}

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
    } else if (url.pathname === "/api/lineups") {
      const fixture = url.searchParams.get("fixture");
      const lineups = await api("/fixtures/lineups", { fixture });
      cache(`lineups_${fixture}`, lineups);
      json(res, 200, lineups.map(t => ({
        team: t.team.name, formation: t.formation, coach: t.coach?.name ?? null,
        startXI: t.startXI.map(p => ({ name: p.player.name, number: p.player.number, pos: p.player.pos, grid: p.player.grid })),
        bench: t.substitutes.map(p => p.player.name),
      })));
    } else if (url.pathname === "/api/predictions") {
      if (!existsSync(PREDICTIONS)) return json(res, 200, []);
      const files = readdirSync(PREDICTIONS).filter(f => f.endsWith(".json")).sort().reverse();
      json(res, 200, files.map(f => ({ file: f, ...JSON.parse(readFileSync(new URL(f, PREDICTIONS), "utf8")) })));
    } else if (url.pathname === "/api/save" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const b = JSON.parse(body);
      const p = computePrediction(new URLSearchParams({
        a: b.teamA, b: b.teamB, home: b.home ?? "", sa: b.styleA ?? 0, sb: b.styleB ?? 0,
      }));
      mkdirSync(PREDICTIONS, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const file = `${stamp}_${b.teamA}-vs-${b.teamB}.json`;
      writeFileSync(new URL(file, PREDICTIONS), JSON.stringify({
        date: new Date().toISOString(),
        teamA: b.teamA, teamB: b.teamB, home: b.home ?? null,
        eloA: p.eloA, eloB: p.eloB,
        styleA: p.styleA, styleB: p.styleB, mA: p.mA, mB: p.mB,
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
