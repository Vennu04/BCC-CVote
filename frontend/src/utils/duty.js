// Mirrors backend routes/duty.py's _coverage() values — one chip style per state.
export const COVERAGE = {
  covered:      { label: "Covered",          className: "bg-pitch-100 text-pitch-800 border-pitch-300" },
  needs_backup: { label: "Needs a Backup",   className: "bg-amber-100 text-amber-800 border-amber-300" },
  to_confirm:   { label: "Ready to confirm", className: "bg-sky-100 text-sky-800 border-sky-300" },
  nobody:       { label: "Nobody available", className: "bg-red-100 text-red-800 border-red-300" },
  organiser:    { label: "Organiser runs it", className: "bg-gray-100 text-gray-700 border-gray-300" },
};

// "Fri 25 Sep" — the auction/match dates are plain IST calendar dates.
export function shortDay(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

// Today's date in IST as "YYYY-MM-DD" — the roster is IST regardless of the
// admin's own device timezone.
export function todayIst(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function nameOf(admins, id) {
  return admins.find((a) => a.id === id)?.name || "—";
}

export function slotLabelOf(slots, code) {
  return slots.find((s) => s.code === code)?.label || code || "";
}

// Admins free (and not a captain) in one slot of one evening.
export function availableIn(evening, code) {
  return Object.entries(evening.responses || {})
    .filter(([, r]) => !r.captain && (r.slots || []).includes(code))
    .map(([id]) => id);
}

// The one evening an admin most needs to see: tonight's if there is one,
// otherwise the next weekend evening coming up.
export function nextWeekendEvening(evenings, today) {
  return (evenings || []).find((e) => e.is_weekend && e.auction_date >= today) || null;
}

// Ready-to-paste roster for the admin WhatsApp group. Weekday matches are
// listed too so nobody wonders why they're missing, but marked as the
// Organiser's.
export function buildRosterMessage(data) {
  const { evenings = [], admins = [], slots = [] } = data || {};
  const lines = ["*🗓️ Live Auction Duty Roster*", ""];
  if (evenings.length === 0) {
    lines.push("No matches scheduled yet.");
    return lines.join("\n");
  }
  evenings.forEach((e) => {
    lines.push(`*${shortDay(e.auction_date)}* – auction for ${e.match_label} (${shortDay(e.match_date)}${e.kickoff ? `, ${e.kickoff}` : ""})`);
    if (!e.is_weekend) {
      lines.push("👤 Run by the Organiser (weekday match)");
    } else if (e.lead_id) {
      lines.push(`⏰ Starts ${slotLabelOf(slots, e.start_slot)}`);
      lines.push(`👤 Lead: ${nameOf(admins, e.lead_id)}`);
      lines.push(`🔁 Backup: ${e.backup_id ? nameOf(admins, e.backup_id) : "_still needed_"}`);
    } else {
      lines.push("⚠️ Not confirmed yet — please mark your availability in the app (Admin → Duty)");
    }
    lines.push("");
  });
  lines.push("Lead: close voting early, check attendance & categories, both captains ready (Admin Guide, Section 6).");
  lines.push("Can't make it? Untick your slot in the app and tell your Backup here.");
  return lines.join("\n");
}
