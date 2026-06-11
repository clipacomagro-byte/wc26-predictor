// Shared API-Football client (World Cup = league 1, season 2026).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";

const HOST = "https://v3.football.api-sports.io";
export const LEAGUE = 1;
export const SEASON = 2026;

export function loadKey() {
  if (process.env.APIFOOTBALL_KEY) return process.env.APIFOOTBALL_KEY;
  const envFile = new URL("../.env", import.meta.url);
  if (existsSync(envFile)) {
    const m = readFileSync(envFile, "utf8").match(/^APIFOOTBALL_KEY=(.+)$/m);
    if (m) return m[1].trim();
  }
  return null;
}

export async function api(path, params = {}) {
  const key = loadKey();
  if (!key) throw new Error("No API key — put APIFOOTBALL_KEY=xxx in .env (get one at api-football.com)");
  const url = new URL(HOST + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url, { headers: { "x-apisports-key": key } });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  const body = await res.json();
  if (body.errors && Object.keys(body.errors).length) throw new Error("API error: " + JSON.stringify(body.errors));
  return body.response;
}

// Cache raw responses so re-runs don't burn the daily quota.
export function cache(name, data) {
  mkdirSync(new URL("../data-cache/", import.meta.url), { recursive: true });
  writeFileSync(new URL(`../data-cache/${name}.json`, import.meta.url), JSON.stringify(data, null, 2));
}
