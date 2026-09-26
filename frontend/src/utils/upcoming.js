// Helpers for the live "Coming up" list (auction.upcoming from the API —
// already in real release order, so nothing here re-sorts it).

const fmt = (v, digits = 1) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v).toFixed(digits).replace(/\.0+$/, ""));

// One compact line of the stats captains care about; missing stats skipped.
export function statLine(p) {
  const parts = [];
  const bat = fmt(p.batting_average); if (bat) parts.push(`Bat ${bat}`);
  const sr = fmt(p.strike_rate, 0); if (sr) parts.push(`SR ${sr}`);
  const bowl = fmt(p.bowling_average); if (bowl && Number(bowl) > 0) parts.push(`Bowl ${bowl}`);
  const eco = fmt(p.economy); if (eco && Number(eco) > 0) parts.push(`Econ ${eco}`);
  const att = fmt(p.attendance_percentage, 0); if (att) parts.push(`Att ${att}%`);
  return parts.join(" · ");
}

// Consecutive runs of the same category, keeping queue order:
// [{ category, players: [...] }, ...]
export function groupUpcoming(upcoming = []) {
  const groups = [];
  upcoming.forEach((p) => {
    const last = groups[groups.length - 1];
    if (last && last.category === p.category) last.players.push(p);
    else groups.push({ category: p.category, players: [p] });
  });
  return groups;
}

// How many more a captain still needs in a category (null when unknown).
export function stillNeeded(summary, quotas, category) {
  if (!summary || !quotas || quotas[category] == null) return null;
  return Math.max(0, quotas[category] - (summary.group_counts?.[category] ?? 0));
}
