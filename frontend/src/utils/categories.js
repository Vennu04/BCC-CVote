// The five auction groups — one place for their order, names, short tags and
// colours, so a group looks and reads the same on every screen. Colours also
// differ in lightness (not just hue), so they stay tellable apart for
// colour-blind players.
export const CATEGORY_ORDER = ["extra_power_allrounder", "extra_power_batsman", "power", "power_batsman", "classic"];

export const CATEGORIES = {
  extra_power_allrounder: { label: "Extra Power All-rounders", name: "EP All-rounders", short: "EP-AR", chip: "bg-[#ede7fb] text-[#5b21b6]" },
  extra_power_batsman:    { label: "Extra Power Batters",      name: "EP Batsmen",      short: "EP-BAT", chip: "bg-[#fbeadb] text-[#9a3412]" },
  power:                  { label: "Power All-rounders",       name: "Power All-rounders", short: "P-AR", chip: "bg-[#dcebfa] text-[#0b4a84]" },
  power_batsman:          { label: "Power Batters",            name: "Power Batters",   short: "P-BAT", chip: "bg-[#d7f0ec] text-[#115e56]" },
  classic:                { label: "Classic",                  name: "Classic",         short: "CLASSIC", chip: "bg-[#e6e9ee] text-[#334155]" },
};

// Full name, e.g. "Extra Power All-rounders"; falls back to the raw key.
export const categoryLabel = (key) => CATEGORIES[key]?.label || key || "No group";
// Label map in the shape older screens expect ({ key: "Full name" }).
export const CATEGORY_LABELS = Object.fromEntries(CATEGORY_ORDER.map((k) => [k, CATEGORIES[k].label]));
