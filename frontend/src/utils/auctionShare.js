// Shared by the Run page and the "Share the teams" step so both copy the
// exact same WhatsApp text.
export const ACTIVE_AUCTION_KEY = "bcc_active_auction_id";

// Plain-text summary for pasting into WhatsApp once an auction is done —
// prices are deliberately left out (they're confidential post-completion,
// same as the on-screen rosters), just team/captain/player names.
export function buildWhatsAppSummary(auction) {
  const teamBlock = (label, captain) => {
    const heading = captain.team_name ? `${label} — ${captain.team_name}` : label;
    const lines = [`*${heading}*`, `Captain: ${captain.name}`, ""];
    (captain.roster || []).forEach((p, i) => lines.push(`${i + 1}. ${p.name}`));
    return lines.join("\n").trim();
  };
  const lines = [
    "🏏 *BCC-CVote Auction Results*",
    "",
    teamBlock("Team A", auction.captain_a),
    "",
    teamBlock("Team B", auction.captain_b),
  ];
  if (auction.is_test) lines.unshift("🧪 TEST DATA — DO NOT SHARE AS A REAL RESULT", "");
  return lines.join("\n");
}

// Pre-auction list for the captains' WhatsApp group: everyone going into
// the pool, grouped by auction category in release-group order, A-Z inside
// each group. Sit-outs (excludeIds) are left off since they won't be
// auctioned. Names only — no stats or release order.
export function buildPlayerListText({ matchLabel, captainA, captainB, groups, excludeIds = [], groupName = (g) => g }) {
  const skip = new Set(excludeIds);
  const blocks = [];
  let total = 0;
  groups.forEach((g) => {
    const names = g.players.filter((p) => !skip.has(p.user_id)).map((p) => p.name)
      .sort((x, y) => x.localeCompare(y, "en", { sensitivity: "base" }));
    if (!names.length) return;
    total += names.length;
    blocks.push([`*${groupName(g.category)} (${names.length})*`, ...names.map((n, i) => `${i + 1}. ${n}`)].join("\n"));
  });
  const head = ["🏏 *BCC-CVote Auction — Player List*"];
  if (matchLabel) head.push(matchLabel);
  if (captainA && captainB) head.push(`Captains: ${captainA} vs ${captainB}`);
  head.push(`${total} players in the pool`);
  return [head.join("\n"), ...blocks].join("\n\n");
}
