import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
export { isVoter } from "../utils/roles";

export function homePathFor(user) {
  if (!user) return "/login";
  if (user.role === "admin") return "/admin";
  if (user.role === "player") return "/player/dashboard";
  return "/captain/dashboard";
}

export function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><span className="text-pitch-600 font-medium">Loading…</span></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><span className="text-pitch-600 font-medium">Loading…</span></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.role !== "admin") return <Navigate to={homePathFor(user)} replace />;
  return children;
}

export function CaptainRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><span className="text-pitch-600 font-medium">Loading…</span></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (user.role !== "captain") return <Navigate to={homePathFor(user)} replace />;
  return children;
}

export function PlayerRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><span className="text-pitch-600 font-medium">Loading…</span></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  // role=="player" is the normal case; an admin who's also flagged is_player
  // (see isVoter) may reach the player dashboard too, without losing /admin.
  if (user.role !== "player" && !(user.role === "admin" && user.is_player)) {
    return <Navigate to={homePathFor(user)} replace />;
  }
  return children;
}
