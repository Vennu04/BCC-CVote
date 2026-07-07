// A handful of admin accounts are also flagged is_player so the same login
// can vote too (see backend VOTER_FILTER) — this is true for them in addition
// to the normal captain/player roles, not instead of.
export function isVoter(user) {
  return user?.role === "captain" || user?.role === "player" || !!user?.is_player;
}
