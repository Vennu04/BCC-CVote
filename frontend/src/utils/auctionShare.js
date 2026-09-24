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
