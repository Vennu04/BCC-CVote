// Single place for date-only formatting on the frontend. The backend already
// pre-formats full opens_at/closes_at window timestamps as IST strings (see
// VotingWindow), but plain calendar dates (e.g. a league match's match_date)
// arrive as raw ISO "YYYY-MM-DD" — this renders those consistently instead of
// showing the raw ISO string.
export function formatDateDisplay(isoDate) {
  if (!isoDate) return "";
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

// "Fri 25 Sep" — match/auction dates are plain IST calendar dates.
export function shortDay(isoDate) {
  if (!isoDate) return "";
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
}

// Today's date in IST as "YYYY-MM-DD", whatever the device's own timezone.
export function todayIst(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}
