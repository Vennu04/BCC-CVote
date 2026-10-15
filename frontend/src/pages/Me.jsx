import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";
import { isStaff, isVoter } from "../utils/roles";
import { isPushSupported, subscribeToPush } from "../utils/pushNotifications";
import { Bell, KeyRound, BarChart3, LayoutDashboard, LogOut, ChevronRight, Gavel, Trophy } from "lucide-react";
import CategoryTag from "../components/CategoryTag";

const STATUS_LABEL = {
  not_played: "Not played yet",
  in_progress: "In progress",
  qualified: "Qualified",
  eliminated: "Eliminated",
};
const ROLE_LABEL = { admin: "Admin", organizer: "Organizer", viewer: "Viewer", player: "Player", captain: "Captain" };

// Me tab — profile, captain numbers, notifications, password, logout, and
// the shortcuts that don't fit in the five bottom tabs.
export default function Me() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [permission, setPermission] = useState(isPushSupported() ? Notification.permission : "unsupported");

  const enableNotifications = async () => {
    try {
      const result = await subscribeToPush();
      setPermission(Notification.permission);
      if (result === "granted") toast.success("Notifications on — you'll hear when voting opens, auctions start and your duty is due");
      else if (result === "denied") toast.error("Notifications are blocked. Turn them on in your browser or phone settings.");
    } catch {
      toast.error("Couldn't turn on notifications — please try again.");
    }
  };

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out");
    navigate("/login");
  };

  const isCaptain = user?.role === "captain";
  const initials = (user?.name || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <div className="bg-brand-navy text-white">
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-6 flex items-center gap-4">
          <span className="w-14 h-14 rounded-full bg-brand-gold text-brand-navy grid place-items-center font-display text-2xl font-extrabold">{initials}</span>
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold leading-tight truncate">{user?.name}</h1>
            <p className="text-sm text-white/80">
              {ROLE_LABEL[user?.role] || "Captain"}{user?.is_admin && user?.role !== "admin" ? " · Admin" : ""}
              {" · code "}<span className="font-bold text-white">{user?.team_code}</span>
              {user?.team_name ? ` · ${user.team_name}` : ""}
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-3 pb-8 space-y-4">
        {isCaptain && (
          <div className="grid grid-cols-3 gap-2">
            <Tile value={user?.matches_scheduled ?? 0} label="Scheduled" />
            <Tile value={user?.matches_played ?? 0} label="Played" />
            <Tile value={STATUS_LABEL[user?.tournament_status] || STATUS_LABEL.not_played} label="Status" small />
          </div>
        )}

        {user?.auction_category && (
          <div className="bg-white rounded-2xl shadow-soft px-4 py-3.5">
            <p className="text-xs font-extrabold tracking-wider uppercase text-brand-muted mb-1.5">Your auction group</p>
            <CategoryTag category={user.auction_category} full />
            {statLine(user) && <p className="text-sm text-brand-muted mt-1.5">{statLine(user)}</p>}
          </div>
        )}

        <ul className="bg-white rounded-2xl shadow-soft divide-y divide-brand-line overflow-hidden">
          <li className="flex items-center gap-3 px-4 min-h-[56px]">
            <Bell size={18} className="text-brand-navy" />
            <span className="flex-1 font-semibold text-brand-ink">Notifications</span>
            {permission === "granted" && <span className="text-xs font-bold bg-pitch-100 text-pitch-800 rounded-full px-2.5 py-1">On</span>}
            {permission === "denied" && <span className="text-xs text-brand-muted">Blocked in settings</span>}
            {permission === "unsupported" && <span className="text-xs text-brand-muted">Not supported here</span>}
            {permission === "default" && <button onClick={enableNotifications} className="btn-primary !px-4 !py-1.5 !min-h-[36px] text-sm">Turn on</button>}
          </li>
          <Row to="/change-password" icon={KeyRound} label="Change password" />
          <Row to="/stats" icon={BarChart3} label="Stats & attendance" />
          <Row to="/matches" icon={Trophy} label="Matches & results" />
          {isVoter(user) && <Row to="/auction" icon={Gavel} label="How the auction works" />}
          {isStaff(user) && <Row to="/manage" icon={LayoutDashboard} label="Manage (admin)" />}
        </ul>

        <button onClick={handleLogout}
          className="w-full bg-white rounded-2xl shadow-soft flex items-center gap-3 px-4 min-h-[56px] text-[#a1251b] font-bold">
          <LogOut size={18} /> Log out
        </button>
      </div>
    </div>
  );
}

function Row({ to, icon: Icon, label }) {
  return (
    <li>
      <Link to={to} className="flex items-center gap-3 px-4 min-h-[56px] hover:bg-gray-50">
        <Icon size={18} className="text-brand-navy" />
        <span className="flex-1 font-semibold text-brand-ink">{label}</span>
        <ChevronRight size={18} className="text-brand-muted" />
      </Link>
    </li>
  );
}

function Tile({ value, label, small }) {
  return (
    <div className="bg-white rounded-2xl shadow-soft py-3 px-2 text-center">
      <span className={`block text-brand-navy ${small ? "text-sm font-extrabold leading-[30px]" : "font-display font-extrabold text-[30px] leading-none"}`}>{value}</span>
      <span className="block text-xs font-bold text-brand-muted mt-1">{label}</span>
    </div>
  );
}

// "Bat avg 26.3 · SR 128 · Econ 7.1" — only the stats that are on file.
function statLine(u) {
  const parts = [];
  if (u.batting_average != null) parts.push(`Bat avg ${u.batting_average}`);
  if (u.strike_rate != null) parts.push(`SR ${u.strike_rate}`);
  if (u.bowling_average != null) parts.push(`Bowl avg ${u.bowling_average}`);
  if (u.economy != null) parts.push(`Econ ${u.economy}`);
  return parts.join(" · ");
}
