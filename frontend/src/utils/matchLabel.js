import { formatDateDisplay } from "./formatDate";

// One place that says which match a slot is, so every admin screen labels it
// the same way. Pool fixtures carry team_a_name/team_b_name (set when the
// fixture is scheduled, see backend tournament.py); the fixed weekend and
// one-off slots have no teams and fall back to their day + time.
export function matchTeams(slot) {
  return slot?.team_a_name && slot?.team_b_name ? `${slot.team_a_name} vs ${slot.team_b_name}` : "";
}

// "Sat · 19 Sep 2026 · 06:15 AM" — date is the real calendar date when known.
export function matchWhen(slot) {
  if (!slot) return "";
  const date = slot.resolved_match_date || slot.match_date;
  return [slot.day, date ? formatDateDisplay(date) : "", slot.match_time || slot.time_of_day]
    .filter(Boolean)
    .join(" · ");
}

// Single-line label for dropdowns and confirm prompts.
export function matchLabel(slot) {
  const teams = matchTeams(slot);
  return teams ? `${teams} — ${matchWhen(slot)}` : matchWhen(slot);
}
