import { isStaff, isVoter, canDoDestructive } from "./roles";

// Single source of truth for the app's navigation — the bottom tab bar
// (phones), the left sidebar (laptops) and the Manage hub sub-tabs all read
// from here, so a page can never be reachable from one and missing from
// another.

// Bottom tabs, per role. Five at most (a phone fits five comfortably).
// Staff swap Stats for Manage: four of the five admins are also captains, so
// they still need Home and the live Auction tab; Stats stays one tap away
// under Me and in the laptop sidebar.
export function tabsFor(user) {
  if (!user) return [];
  const voter = isVoter(user);
  const tabs = [];
  if (voter) tabs.push({ key: "home", label: "Home", to: "/home" });
  tabs.push({ key: "matches", label: "Matches", to: "/matches" });
  if (voter) tabs.push({ key: "auction", label: "Auction", to: "/auction" });
  if (isStaff(user)) tabs.push({ key: "manage", label: "Manage", to: "/manage" });
  else tabs.push({ key: "stats", label: "Stats", to: "/stats" });
  tabs.push({ key: "me", label: "Me", to: "/me" });
  return tabs;
}

// Which bottom tab a path belongs to.
export function tabKeyFor(pathname) {
  if (pathname.startsWith("/manage")) return "manage";
  if (pathname.startsWith("/auction")) return "auction";
  if (pathname.startsWith("/matches")) return "matches";
  if (pathname.startsWith("/stats")) return "stats";
  if (pathname.startsWith("/me") || pathname === "/change-password") return "me";
  if (pathname.startsWith("/home")) return "home";
  return null;
}

// Manage hubs and their sub-tabs. `fullAdminOnly` mirrors the backend's
// admin_only_required (organizers are refused there, so they never see it).
export const HUBS = [
  { key: "control", label: "This week", to: "/manage", subs: [] },
  { key: "tools", label: "All tools", to: "/manage/tools", subs: [] },
  { key: "matches", label: "Matches", to: "/manage/matches/fixtures", subs: [
    { key: "fixtures", label: "Fixtures & teams", to: "/manage/matches/fixtures" },
    { key: "windows", label: "Voting & extra matches", to: "/manage/matches/windows" },
  ] },
  { key: "auction", label: "Auction", to: "/manage/auction/run", subs: [
    { key: "run", label: "Run", to: "/manage/auction/run" },
    { key: "practice", label: "Practice", to: "/manage/auction/run#practice" },
    { key: "duty", label: "Duty roster", to: "/manage/auction/duty", fullAdminOnly: true },
  ] },
  { key: "players", label: "Players", to: "/manage/players/people", subs: [
    { key: "people", label: "People", to: "/manage/players/people" },
    { key: "attendance", label: "Attendance", to: "/manage/players/attendance" },
  ] },
];

// The two top-level Manage places on a phone: the guided checklist, and
// everything else. Matches / Auction / Players pages count as "All tools".
export function manageTopFor(hub) {
  return hub === "control" ? "control" : "tools";
}

export function hubsFor(user) {
  const full = canDoDestructive(user);
  return HUBS.map((h) => ({ ...h, subs: h.subs.filter((s) => full || !s.fullAdminOnly) }));
}

// Old addresses keep working — bookmarks and links in WhatsApp messages
// land on the page's new home.
export const REDIRECTS = {
  "/captain/dashboard": "/home",
  "/player/dashboard": "/home",
  "/tournament": "/matches",
  "/results": "/matches/whos-in",
  "/admin": "/manage",
  "/admin/players": "/manage/players/people",
  "/admin/captains": "/manage/players/people",
  "/admin/people": "/manage/players/people",
  "/admin/attendance": "/manage/players/attendance",
  "/admin/window": "/manage/matches/windows",
  "/admin/tournament": "/manage/matches/fixtures",
  "/admin/auction": "/manage/auction/run",
  "/admin/duty": "/manage/auction/duty",
};

export function homePathFor(user) {
  if (!user) return "/login";
  if (isStaff(user)) return "/manage";
  if (user.role === "viewer") return "/matches";
  return "/home";
}
