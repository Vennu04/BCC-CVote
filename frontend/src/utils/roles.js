// A handful of admin accounts are also flagged is_player so the same login
// can vote too (see backend VOTER_FILTER) — this is true for them in addition
// to the normal captain/player roles, not instead of.
export function isVoter(user) {
  return user?.role === "captain" || user?.role === "player" || !!user?.is_player;
}

// role=="organizer" is a new staff tier: same admin-console access as
// role=="admin"/is_admin, except the backend's admin_only_required routes
// (delete captain/player, reset-device, close-window-early — see
// backend/app/utils/auth.py PERMISSIONS["destructive"]) reject it. Mirrored
// here so the frontend can decide what to *show*, even though the backend
// is the actual enforcement point either way.
export function isStaff(user) {
  return user?.role === "admin" || user?.role === "organizer" || !!user?.is_admin;
}

export function isOrganizer(user) {
  return user?.role === "organizer";
}

// Read-only role: sees results/leaderboard/attendance, never votes/bids
// (backend's captain_required decorator rejects role=="viewer" outright).
export function isViewer(user) {
  return user?.role === "viewer";
}

// Gates destructive-only UI (delete/reset-device/close-window-early buttons)
// — matches PERMISSIONS["destructive"] on the backend exactly, so an
// organizer never sees a button that would just 403 if clicked.
export function canDoDestructive(user) {
  return user?.role === "admin" || !!user?.is_admin;
}
