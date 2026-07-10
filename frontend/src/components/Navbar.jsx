import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { homePathFor } from "./ProtectedRoute";
import api from "../utils/api";
import toast from "react-hot-toast";
import { LogOut, LayoutDashboard, Users, UserCircle, Settings, Gavel, ClipboardCheck, KeyRound } from "lucide-react";

const MY_AUCTION_POLL_MS = 10000;

export default function Navbar() {
  const { user, logout, isAdmin, isVoter } = useAuth();
  const navigate = useNavigate();
  const [myAuctionId, setMyAuctionId] = useState(null);

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
    <nav className="bg-cricket-navy text-white shadow-md">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between flex-wrap gap-y-2">
        {/* Logo */}
        <Link to={homePathFor(user)} className="flex items-center gap-2 font-bold text-lg tracking-tight">
          <span className="text-2xl">🏏</span>
          <span>BCC<span className="text-cricket-gold">-CVote</span></span>
        </Link>

        {/* Nav links */}
        <div className="order-3 sm:order-none w-full sm:w-auto flex items-center gap-x-4 gap-y-1 text-sm overflow-x-auto flex-wrap sm:flex-nowrap">
          {isAdmin && (
            <>
              <Link to="/admin" className="flex items-center gap-1 hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
                <LayoutDashboard size={15} /> Admin
              </Link>
              <Link to="/admin/players" className="flex items-center gap-1 hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
                <Users size={15} /> Players
              </Link>
              <Link to="/admin/window" className="flex items-center gap-1 hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
                <Settings size={15} /> Window
              </Link>
              <Link to="/admin/attendance" className="flex items-center gap-1 hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
                <ClipboardCheck size={15} /> Attendance
              </Link>
              <Link to="/admin/auction" className="flex items-center gap-1 hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
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
            <Link to="/player/dashboard" className="flex items-center gap-1 hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
              <UserCircle size={15} /> My Votes
            </Link>
          )}
          {isVoter && (
            <>
              <Link to="/results" className="hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
                Results
              </Link>
              {myAuctionId && (
                <Link
                  to={`/auction/${myAuctionId}`}
                  className="flex items-center gap-1 text-xs font-semibold bg-cricket-gold text-cricket-navy rounded-full px-3 py-1 whitespace-nowrap animate-pulse"
                >
                  <Gavel size={13} /> Join Auction
                </Link>
              )}
            </>
          )}
        </div>

        {/* User + logout */}
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <p className="text-xs text-gray-300">{user?.role === "admin" ? "Organizer" : user?.role === "player" ? "Player" : "Captain"}</p>
            <p className="text-sm font-semibold">{user?.name}</p>
          </div>
          <span className="bg-pitch-600 text-white text-xs font-bold px-2 py-0.5 rounded">
            {user?.team_code}
          </span>
          <Link to="/change-password" className="p-1.5 hover:text-cricket-gold transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center" title="Change Password">
            <KeyRound size={18} />
          </Link>
          <button onClick={handleLogout} className="p-1.5 hover:text-cricket-gold transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center" title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
}
