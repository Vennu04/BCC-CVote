import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { homePathFor } from "./ProtectedRoute";
import toast from "react-hot-toast";
import { LogOut, LayoutDashboard, Users, UserCircle, Settings } from "lucide-react";

export default function Navbar() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

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
              <Link to="/admin/captains" className="flex items-center gap-1 hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
                <Users size={15} /> Captains
              </Link>
              <Link to="/admin/players" className="flex items-center gap-1 hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
                <UserCircle size={15} /> Players
              </Link>
              <Link to="/admin/window" className="flex items-center gap-1 hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
                <Settings size={15} /> Window
              </Link>
            </>
          )}
          {!isAdmin && (
            <Link to="/results" className="hover:text-cricket-gold transition-colors whitespace-nowrap py-1">
              Results
            </Link>
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
          <button onClick={handleLogout} className="p-1.5 hover:text-cricket-gold transition-colors min-h-[36px] min-w-[36px] flex items-center justify-center" title="Logout">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
}
