// Coloured-initials team badge — the redesign's stand-in for team logos.
// The colour is derived from the team name, so a team looks the same on
// every screen without anyone having to pick or store a colour.
const CREST_COLORS = ["#b54708", "#6941c6", "#1570ef", "#c01048", "#067647", "#344054", "#0e7090", "#9e165f", "#4e5ba6", "#b93815"];

export function crestColor(name = "") {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CREST_COLORS[h % CREST_COLORS.length];
}

export function crestInitials(name = "") {
  const words = name.replace(/^demo\s+/i, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export default function TeamCrest({ name, size = 28 }) {
  return (
    <span
      aria-hidden="true"
      className="inline-grid place-items-center rounded-lg text-white font-black shrink-0"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38), background: crestColor(name) }}
    >
      {crestInitials(name)}
    </span>
  );
}

// "Team A  VS  Team B" row used on every match card.
export function TeamsVs({ a, b, middle = "VS" }) {
  return (
    <div className="flex items-center justify-between gap-2 my-2">
      <span className="flex items-center gap-2 min-w-0 flex-1 font-extrabold text-gray-900 leading-tight">
        <TeamCrest name={a} /> <span className="break-words">{a}</span>
      </span>
      <span className="text-xs font-black text-gray-400 shrink-0">{middle}</span>
      <span className="flex items-center gap-2 min-w-0 flex-1 font-extrabold text-gray-900 leading-tight justify-end text-right">
        <span className="break-words">{b}</span> <TeamCrest name={b} />
      </span>
    </div>
  );
}
