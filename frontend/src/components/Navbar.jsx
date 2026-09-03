import { useState, useEffect } from "react";
import { Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { homePathFor } from "./ProtectedRoute";
import api from "../utils/api";
import toast from "react-hot-toast";
import { LogOut, LayoutDashboard, Users, UserCircle, Settings, Gavel, ClipboardCheck, KeyRound } from "lucide-react";
import { TOURNAMENT_NAME } from "../config/appMeta";

const MY_AUCTION_POLL_MS = 10000;

export default function Navbar() {
  const { user, logout, isAdmin, isVoter } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [myAuctionId, setMyAuctionId] = useState(null);

  // Highlights whichever nav link matches the current route, so a fast-scanning
  // admin always has an at-a-glance answer to "which admin page am I on".
  const navLinkClass = (path) =>
    `flex items-center gap-1.5 transition-colors duration-150 whitespace-nowrap py-2 px-1 min-h-[44px] rounded-lg ${
      location.pathname === path
        ? "text-cricket-gold font-semibold bg-white/10"
        : "text-white/85 hover:text-cricket-gold active:bg-white/10"
    }`;

  // Lets a captain (or an admin who's also flagged as a voter) discover "I'm
  // in a live auction right now" without needing a manually-shared link —
  // polled from here so it surfaces on every page.
  useEffect(() => {
    if (!user || !isVoter) return;
    let cancelled = false;
    const check = () => {
      api.get("/auction/my-active")
        .then((res) => { if (!cancelled) setMyAuctionId(res.data?.auction_id || null); })
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, MY_AUCTION_POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [user, isVoter]);

  const handleLogout = async () => {
    await logout();
    toast.success("Logged out");
    navigate("/login");
  };

  return (
    <nav className="sticky top-0 z-40 bg-gradient-to-b from-cricket-navy to-cricket-navy-light text-white shadow-soft safe-top">
      <div className="max-w-6xl mx-auto px-4 py-2.5 flex items-center justify-between flex-wrap gap-y-2">
        {/* Logo */}
        <Link to={homePathFor(user)} className="flex items-center gap-2 font-bold text-lg tracking-tight min-h-[44px]">
          <span className="text-2xl">🏏</span>
          <span className="flex flex-col leading-tight">
            <span>BCC<span className="text-cricket-gold">-CVote</span></span>
            <span className="hidden sm:block text-[10px] font-medium text-white/60 tracking-wide">{TOURNAMENT_NAME}</span>
          </span>
        </Link>

        {/* Nav links */}
        <div className="order-3 sm:order-none w-full sm:w-auto flex items-center gap-x-3 gap-y-1 text-sm overflow-x-auto scroll-touch flex-wrap sm:flex-nowrap">
          {isAdmin && (
            <>
              <Link to="/admin" className={navLinkClass("/admin")}>
                <LayoutDashboard size={15} /> Admin
              </Link>
              <Link to="/admin/players" className={navLinkClass("/admin/players")}>
                <Users size={15} /> Players
              </Link>
              <Link to="/admin/window" className={navLinkClass("/admin/window")}>
                <Settings size={15} /> Window
              </Link>
              <Link to="/admin/attendance" className={navLinkClass("/admin/attendance")}>
                <ClipboardCheck size={15} /> Attendance
              </Link>
              <Link to="/admin/auction" className={navLinkClass("/admin/auction")}>
                <Gavel size={15} /> Auction
              </Link>
            </>
          )}
          {user?.role === "admin" && isVoter && (
            // Specifically for role=="admin" (flagged is_player) — their logo
            // link goes to /admin, so they need an explicit way to their own
            // vote via /player/dashboard. A captain/player flagged is_admin
            // is the reverse case: their logo link already goes to their own
            // dashboard (homePathFor is unchanged), so they don't need this —
            // and /player/dashboard would be wrong for one whose role is
            // actually "captain".
            <Link to="/player/dashboard" className={navLinkClass("/player/dashboard")}>
              <UserCircle size={15} /> My Votes
            </Link>
          )}
          {isVoter && (
            <>
              <Link to="/results" className={navLinkClass("/results")}>
                Results
              </Link>
              {myAuctionId && (
                <Link
                  to={`/auction/${myAuctionId}`}
                  className="flex items-center gap-1.5 text-xs font-semibold bg-gradient-to-b from-cricket-gold to-cricket-gold-dark text-cricket-navy rounded-full px-3.5 py-2 min-h-[36px] whitespace-nowrap shadow-soft animate-pulse active:scale-95 transition-transform duration-150"
                >
                  <Gavel size={13} /> Join Auction
                </Link>
              )}
            </>
          )}
        </div>

        {/* User + logout */}
        <div className="flex items-center gap-1.5">
          <div className="text-right hidden sm:block mr-1">
            <p className="text-xs text-gray-300">
              {{ admin: "Admin", organizer: "Organizer", viewer: "Viewer", player: "Player" }[user?.role] || "Captain"}
            </p>
            <p className="text-sm font-semibold">{user?.name}</p>
          </div>
          <span className="bg-gradient-to-b from-pitch-500 to-pitch-600 text-white text-xs font-bold px-2.5 py-1 rounded-lg shadow-soft">
            {user?.team_code}
          </span>
          <Link to="/change-password" className="icon-btn text-white/85 hover:text-cricket-gold" title="Change Password">
            <KeyRound size={18} />
          </Link>
          <button onClick={handleLogout} className="icon-btn text-white/85 hover:text-cricket-gold" title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
}
