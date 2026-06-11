#!/usr/bin/env node
// API-Football CLI for World Cup 2026 (league 1, season 2026).
// Key: set APIFOOTBALL_KEY in .env or environment. Get one at https://www.api-football.com/
//
//   node src/api-football.mjs fixtures [YYYY-MM-DD]     today's (or a date's) WC fixtures
//   node src/api-football.mjs lineups <fixtureId>       confirmed XI + formation (~1h before KO)
//   node src/api-football.mjs injuries <fixtureId>      injuries for a fixture
//   node src/api-football.mjs teamstats <teamId>        WC season stats for a team
import { api, cache, LEAGUE, SEASON } from "./apifb.mjs";

const [cmd, arg] = process.argv.slice(2);

try {
  if (cmd === "fixtures") {
    const params = { league: LEAGUE, season: SEASON };
    if (arg) params.date = arg;
    const fixtures = await api("/fixtures", params);
    cache(`fixtures${arg ? "_" + arg : ""}`, fixtures);
    for (const f of fixtures) {
      console.log(`${f.fixture.id}  ${f.fixture.date.slice(0, 16)}  ${f.teams.home.name} vs ${f.teams.away.name}` +
        (f.fixture.status.short === "NS" ? "" : `  [${f.fixture.status.short} ${f.goals.home ?? ""}-${f.goals.away ?? ""}]`));
    }
    if (!fixtures.length) console.log("No fixtures returned.");
  } else if (cmd === "lineups" && arg) {
    const lineups = await api("/fixtures/lineups", { fixture: arg });
    cache(`lineups_${arg}`, lineups);
    for (const team of lineups) {
      console.log(`\n${team.team.name}  (${team.formation})  coach: ${team.coach?.name ?? "?"}`);
      for (const p of team.startXI) console.log(`  ${String(p.player.number).padStart(2)}  ${p.player.pos ?? "?"}  ${p.player.name}`);
      console.log(`  bench: ${team.substitutes.map(p => p.player.name).join(", ")}`);
    }
    if (!lineups.length) console.log("Lineups not published yet (usually ~1h before kickoff).");
  } else if (cmd === "injuries" && arg) {
    const injuries = await api("/injuries", { fixture: arg });
    cache(`injuries_${arg}`, injuries);
    for (const i of injuries) console.log(`${i.team.name}: ${i.player.name} — ${i.player.type} (${i.player.reason})`);
    if (!injuries.length) console.log("No injuries listed.");
  } else if (cmd === "teamstats" && arg) {
    const stats = await api("/teams/statistics", { league: LEAGUE, season: SEASON, team: arg });
    cache(`teamstats_${arg}`, stats);
    console.log(JSON.stringify(stats, null, 2));
  } else {
    console.log("Usage:\n  node src/api-football.mjs fixtures [YYYY-MM-DD]\n  node src/api-football.mjs lineups <fixtureId>\n  node src/api-football.mjs injuries <fixtureId>\n  node src/api-football.mjs teamstats <teamId>");
  }
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
