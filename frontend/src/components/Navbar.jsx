import { useEffect } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useMyAuction } from "../hooks/useMyAuction";
import { tabsFor, tabKeyFor, hubsFor, homePathFor } from "../utils/nav";
import { isStaff, isVoter } from "../utils/roles";
import { TOURNAMENT_NAME } from "../config/appMeta";
import { Home, Trophy, Gavel, BarChart3, UserCircle, LayoutDashboard, Users } from "lucide-react";

const TAB_ICONS = { home: Home, matches: Trophy, auction: Gavel, stats: BarChart3, manage: LayoutDashboard, me: UserCircle };
const HUB_ICONS = { control: LayoutDashboard, matches: Trophy, auction: Gavel, players: Users };
const ROLE_LABEL = { admin: "Admin", organizer: "Organizer", viewer: "Viewer", player: "Player", captain: "Captain" };

// The app frame, Stumps-style: a slim navy top bar, a bottom tab bar on
// phones, and the same destinations as a left sidebar on laptops. Every
// page renders <Navbar /> at the top, so this one component is the whole
// navigation — the tab list itself lives in utils/nav.js.
export default function Navbar() {
  const { user } = useAuth();
  const location = useLocation();
  const liveAuctionId = useMyAuction();
  const tabs = tabsFor(user);
  const activeTab = tabKeyFor(location.pathname);

  // Room for the fixed tab bar / sidebar, set once for whichever page is showing.
  useEffect(() => {
    document.body.classList.add("has-shell");
    return () => document.body.classList.remove("has-shell");
  }, []);

  const tabTarget = (tab) => (tab.key === "auction" && liveAuctionId ? `/auction/${liveAuctionId}` : tab.to);

  return (
    <>
      <header className="sticky top-0 z-40 bg-brand-navy text-white safe-top shadow-soft">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to={homePathFor(user)} className="lg:invisible flex flex-col leading-tight min-h-[44px] justify-center">
            <span className="font-black text-lg tracking-tight">BCC<span className="text-brand-gold">-CVote</span></span>
            <span className="text-[10px] font-medium text-white/55 tracking-wide hidden sm:block">{TOURNAMENT_NAME}</span>
          </Link>
          <div className="flex items-center gap-2">
            {liveAuctionId && (
              <Link to={`/auction/${liveAuctionId}`}
                className="flex items-center gap-1.5 text-xs font-bold bg-red-600 text-white rounded-full px-3 py-1.5 min-h-[36px] animate-pulse">
                <span className="w-1.5 h-1.5 rounded-full bg-white" /> LIVE AUCTION
              </Link>
            )}
            <Link to="/me" className="flex items-center gap-2 min-h-[44px]" title="Your profile">
              <span className="text-right hidden sm:block leading-tight">
                <span className="block text-[11px] text-white/60">{ROLE_LABEL[user?.role] || "Captain"}{user?.is_admin && user?.role !== "admin" ? " · Admin" : ""}</span>
                <span className="block text-sm font-semibold">{user?.name}</span>
              </span>
              <span className="w-9 h-9 rounded-full bg-brand-gold text-brand-navy grid place-items-center text-xs font-black">
                {initials(user?.name)}
              </span>
            </Link>
          </div>
        </div>
      </header>

      {/* Laptop: left sidebar */}
      <aside className="hidden lg:flex fixed left-0 top-0 bottom-0 w-56 z-50 bg-white border-r border-gray-200 flex-col pb-4 gap-1 overflow-y-auto">
        <Link to={homePathFor(user)} className="h-14 shrink-0 bg-brand-navy text-white flex flex-col justify-center px-5 mb-3">
          <span className="font-black text-lg tracking-tight leading-tight">BCC<span className="text-brand-gold">-CVote</span></span>
          <span className="text-[10px] font-medium text-white/55 tracking-wide leading-tight">{TOURNAMENT_NAME}</span>
        </Link>
        <div className="px-3 flex flex-col gap-1 flex-1">
        <SideSection title={isStaff(user) ? "Play" : null}>
          {isVoter(user) && <SideLink to="/home" icon={Home} label="Home" />}
          <SideLink to="/matches" icon={Trophy} label="Matches" />
          {isVoter(user) && <SideLink to={liveAuctionId ? `/auction/${liveAuctionId}` : "/auction"} match="/auction" icon={Gavel} label="Auction" live={!!liveAuctionId} />}
          <SideLink to="/stats" icon={BarChart3} label="Stats" />
        </SideSection>
        {isStaff(user) && (
          <SideSection title="Manage">
            {hubsFor(user).map((h) => (
              <SideLink key={h.key} to={h.to} match={h.key === "control" ? "/manage" : `/manage/${h.key}`} exact={h.key === "control"}
                icon={HUB_ICONS[h.key]} label={h.label} />
            ))}
          </SideSection>
        )}
        <div className="mt-auto pt-2 border-t border-gray-100">
          <SideLink to="/me" icon={UserCircle} label="Me" />
        </div>
        </div>
      </aside>

      {/* Phone: bottom tab bar */}
      <nav aria-label="Main" className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-gray-200 safe-bottom">
        <div className="flex justify-around">
          {tabs.map((tab) => {
            const Icon = TAB_ICONS[tab.key];
            const on = activeTab === tab.key;
            return (
              <Link key={tab.key} to={tabTarget(tab)} aria-current={on ? "page" : undefined}
                className={`relative flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[56px] text-[11px] font-bold transition-colors duration-150 ${on ? "text-pitch-700" : "text-gray-500"}`}>
                <Icon size={21} strokeWidth={on ? 2.4 : 1.9} />
                {tab.label}
                {tab.key === "auction" && liveAuctionId && <span className="absolute top-2 right-[calc(50%-16px)] w-2 h-2 rounded-full bg-red-600" aria-label="live" />}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}

function SideSection({ title, children }) {
  return (
    <div className="mb-3">
      {title && <p className="px-3 mb-1 text-[11px] font-bold uppercase tracking-wider text-gray-400">{title}</p>}
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function SideLink({ to, match, exact, icon: Icon, label, live }) {
  const location = useLocation();
  const base = match || to;
  const on = exact ? location.pathname === base : location.pathname === base || location.pathname.startsWith(`${base}/`);
  return (
    <NavLink to={to} className={`flex items-center gap-3 rounded-xl px-3 min-h-[42px] text-sm font-semibold transition-colors duration-150 ${
      on ? "bg-pitch-50 text-pitch-700" : "text-gray-600 hover:bg-gray-50"}`}>
      <Icon size={18} /> <span className="flex-1">{label}</span>
      {live && <span className="w-2 h-2 rounded-full bg-red-600" />}
    </NavLink>
  );
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

