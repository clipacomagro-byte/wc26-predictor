// Team-name → slug resolver for engine/data/results.json, whose homeSlug/awaySlug
// fields are unreliable (null for ~15 rated teams). Derives the slug from the
// display name instead; falls back to the dataset slug when present.
const SPECIAL = {
  "usa": "usa", "united-states": "usa",
  "korea-republic": "south-korea",
  "cote-d-ivoire": "ivory-coast", "cote-divoire": "ivory-coast",
  "czechia": "czech-republic",
  "bosnia-herzegovina": "bosnia-and-herzegovina",
  "trinidad-tobago": "trinidad-and-tobago",
  "ir-iran": "iran",
  "republic-of-ireland": "republic-of-ireland", "rep-of-ireland": "republic-of-ireland",
  "turkiye": "turkey",
  "cabo-verde": "cape-verde", "cape-verde-islands": "cape-verde",
  "congo-dr": "dr-congo", "democratic-republic-of-the-congo": "dr-congo", "congo": "dr-congo",
};

export function slugForName(name) {
  if (!name) return null;
  const kebab = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return SPECIAL[kebab] ?? kebab;
}

// Resolve a match side: prefer dataset slug, fall back to name-derived.
export function sideSlug(m, side) {
  return (side === "home" ? m.homeSlug : m.awaySlug) ?? slugForName(side === "home" ? m.homeName : m.awayName);
}
