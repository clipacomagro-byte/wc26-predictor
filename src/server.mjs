#!/usr/bin/env node
// Personal dashboard server. Zero dependencies.
//   node src/server.mjs            → http://localhost:3026
import { createServer } from "node:http";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { ratings, predictFromLambdas, clampAdjust, baseLambdas } from "./model.mjs";

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
  const base = baseLambdas(teamA, teamB, home);
  const mA = clampAdjust(parseFloat(q.get("la") ?? "1"));
  const mB = clampAdjust(parseFloat(q.get("lb") ?? "1"));
  const baseline = predictFromLambdas(base.lambda, base.mu);
  const adjusted = (mA !== 1 || mB !== 1) ? predictFromLambdas(base.lambda * mA, base.mu * mB) : null;
  return { teamA, teamB, home, eloA: base.ra, eloB: base.rb, mA, mB, baseline, adjusted };
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
    } else if (url.pathname === "/api/predictions") {
      if (!existsSync(PREDICTIONS)) return json(res, 200, []);
      const files = readdirSync(PREDICTIONS).filter(f => f.endsWith(".json")).sort().reverse();
      json(res, 200, files.map(f => ({ file: f, ...JSON.parse(readFileSync(new URL(f, PREDICTIONS), "utf8")) })));
    } else if (url.pathname === "/api/save" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { teamA, teamB, home, mA, mB, reasoning } = JSON.parse(body);
      const p = computePrediction(new URLSearchParams({ a: teamA, b: teamB, home: home ?? "", la: mA, lb: mB }));
      mkdirSync(PREDICTIONS, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const file = `${stamp}_${teamA}-vs-${teamB}.json`;
      writeFileSync(new URL(file, PREDICTIONS), JSON.stringify({
        date: new Date().toISOString(), teamA, teamB, home: home ?? null,
        eloA: p.eloA, eloB: p.eloB, baseline: p.baseline, adjusted: p.adjusted,
        adjustment: (p.mA !== 1 || p.mB !== 1) ? { lambdaA: p.mA, lambdaB: p.mB, reasoning: reasoning || "" } : null,
        actual: null,
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

server.listen(PORT, () => console.log(`wc26 dashboard → http://localhost:${PORT}`));
