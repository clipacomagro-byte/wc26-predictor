#!/usr/bin/env node
// Build data/players.json from the EA FC 26 dataset (data-cache/players_raw.csv,
// from github.com/ismailoksuz/EAFC26-DataHub). Filters to the 54 rated nations,
// keeps the top 45 per nation by overall.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { ratings } from "./model.mjs";

// dataset nationality_name → our team slug (only where simple kebab-case differs)
const NATION_MAP = {
  "United States": "usa",
  "Korea Republic": "south-korea",
  "Côte d'Ivoire": "ivory-coast",
  "Côte d’Ivoire": "ivory-coast",
  "Ivory Coast": "ivory-coast",
  "Bosnia and Herzegovina": "bosnia-and-herzegovina",
  "Czechia": "czech-republic",
  "Czech Republic": "czech-republic",
  "Republic of Ireland": "republic-of-ireland",
  "Trinidad and Tobago": "trinidad-and-tobago",
  "IR Iran": "iran",
  "China PR": "china",
};
const kebab = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const toSlug = (name) => NATION_MAP[name] ?? kebab(name);

// minimal CSV parser (quoted fields, embedded commas/newlines)
function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csv = readFileSync(new URL("../data-cache/players_raw.csv", import.meta.url), "utf8");
const [header, ...rows] = parseCsv(csv);
const col = Object.fromEntries(header.map((h, i) => [h, i]));
const num = (v) => v === "" || v == null ? null : Math.round(parseFloat(v));

const byNation = {};
for (const r of rows) {
  const slug = toSlug(r[col.nationality_name]);
  if (ratings[slug] == null) continue;
  const isGk = (r[col.player_positions] || "").startsWith("GK");
  (byNation[slug] ??= []).push({
    name: r[col.short_name],
    fullName: r[col.long_name],
    positions: r[col.player_positions].split(",").map(s => s.trim()),
    ovr: num(r[col.overall]),
    pot: num(r[col.potential]),
    age: num(r[col.age]),
    club: r[col.club_name] || null,
    face: r[col.player_face_url] || null,
    foot: r[col.preferred_foot] || null,
    height: num(r[col.height_cm]),
    // six card stats; for GKs use the goalkeeping set
    stats: isGk
      ? { DIV: num(r[col.goalkeeping_diving]), HAN: num(r[col.goalkeeping_handling]), KIC: num(r[col.goalkeeping_kicking]), REF: num(r[col.goalkeeping_reflexes]), SPD: num(r[col.goalkeeping_speed]), POS: num(r[col.goalkeeping_positioning]) }
      : { PAC: num(r[col.pace]), SHO: num(r[col.shooting]), PAS: num(r[col.passing]), DRI: num(r[col.dribbling]), DEF: num(r[col.defending]), PHY: num(r[col.physic]) },
  });
}

for (const slug of Object.keys(byNation)) {
  byNation[slug].sort((a, b) => b.ovr - a.ovr);
  byNation[slug] = byNation[slug].slice(0, 45);
  // disambiguate duplicate short names within a nation (e.g. Lautaro vs Lisandro Martínez)
  const counts = {};
  for (const p of byNation[slug]) counts[p.name] = (counts[p.name] ?? 0) + 1;
  for (const p of byNation[slug]) {
    if (counts[p.name] > 1) {
      const w = p.fullName.split(" ");
      p.name = w[0] + " " + w[w.length - 1];
    }
  }
}

const missing = Object.keys(ratings).filter(s => !byNation[s]);
mkdirSync(new URL("../data/", import.meta.url), { recursive: true });
writeFileSync(new URL("../data/players.json", import.meta.url),
  JSON.stringify({ source: "EA FC 26 via EAFC26-DataHub", built: new Date().toISOString(), nations: byNation }));
console.log(`nations covered: ${Object.keys(byNation).length}/${Object.keys(ratings).length}`);
console.log(`players: ${Object.values(byNation).reduce((n, a) => n + a.length, 0)}`);
if (missing.length) console.log("MISSING:", missing.join(", "));
for (const s of ["mexico", "south-africa", "spain"]) {
  console.log(s, "top3:", byNation[s]?.slice(0, 3).map(p => `${p.name} ${p.ovr}`).join(" | "));
}
