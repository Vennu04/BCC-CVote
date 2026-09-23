import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";
import { isStaff, isVoter } from "../utils/roles";
import { isPushSupported, subscribeToPush } from "../utils/pushNotifications";
import { Bell, KeyRound, BarChart3, LayoutDashboard, LogOut, ChevronRight, Gavel, Trophy } from "lucide-react";

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
          <span className="w-14 h-14 rounded-full bg-brand-gold text-brand-navy grid place-items-center text-lg font-black">{initials}</span>
          <div className="min-w-0">
            <h1 className="text-2xl font-black leading-tight truncate">{user?.name}</h1>
            <p className="text-sm text-white/60">
              {ROLE_LABEL[user?.role] || "Captain"}{user?.is_admin && user?.role !== "admin" ? " · Admin" : ""}
              {" · code "}<span className="font-bold text-white/80">{user?.team_code}</span>
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

        <ul className="bg-white rounded-2xl shadow-soft divide-y divide-gray-100 overflow-hidden">
          <li className="flex items-center gap-3 px-4 min-h-[56px]">
            <Bell size={18} className="text-brand-navy" />
            <span className="flex-1 font-semibold text-gray-900">Notifications</span>
            {permission === "granted" && <span className="text-xs font-bold bg-pitch-100 text-pitch-800 rounded-full px-2.5 py-1">On</span>}
            {permission === "denied" && <span className="text-xs text-gray-500">Blocked in settings</span>}
            {permission === "unsupported" && <span className="text-xs text-gray-500">Not supported here</span>}
            {permission === "default" && <button onClick={enableNotifications} className="btn-primary !px-4 !py-1.5 !min-h-[36px] text-sm">Turn on</button>}
          </li>
          <Row to="/change-password" icon={KeyRound} label="Change password" />
          <Row to="/stats" icon={BarChart3} label="Stats & attendance" />
          <Row to="/matches" icon={Trophy} label="Matches & results" />
          {isVoter(user) && <Row to="/auction" icon={Gavel} label="How the auction works" />}
          {isStaff(user) && <Row to="/manage" icon={LayoutDashboard} label="Manage (admin)" />}
        </ul>

        <button onClick={handleLogout}
          className="w-full bg-white rounded-2xl shadow-soft flex items-center gap-3 px-4 min-h-[56px] text-red-700 font-semibold">
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
        <span className="flex-1 font-semibold text-gray-900">{label}</span>
        <ChevronRight size={18} className="text-gray-400" />
      </Link>
    </li>
  );
}

function Tile({ value, label, small }) {
  return (
    <div className="bg-white rounded-2xl shadow-soft py-3 px-2 text-center">
      <span className={`block font-black text-brand-navy ${small ? "text-sm leading-6" : "text-2xl"}`}>{value}</span>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
    </div>
  );
}
