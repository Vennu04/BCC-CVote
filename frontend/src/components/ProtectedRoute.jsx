import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
export { isVoter } from "../utils/roles";

export function homePathFor(user) {
  if (!user) return "/login";
  if (user.role === "admin") return "/admin";
  if (user.role === "player") return "/player/dashboard";
  return "/captain/dashboard";
}

function RequireAuth({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><span className="text-pitch-600 font-medium">Loading…</span></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (role && user.role !== role) return <Navigate to={homePathFor(user)} replace />;
  // A default-password account must reset it before touching anything else.
  if (user.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

export function ProtectedRoute({ children }) {
  return <RequireAuth role={null}>{children}</RequireAuth>;
}

export function AdminRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><span className="text-pitch-600 font-medium">Loading…</span></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  // role=="admin" is the normal case; a captain/player flagged is_admin=True
  // (see AuthContext's isAdmin) may reach admin routes too, without losing
  // their own dashboard/login — the reverse of PlayerRoute's admin+is_player
  // exception below.
  if (user.role !== "admin" && !user.is_admin) {
    return <Navigate to={homePathFor(user)} replace />;
  }
  // A default-password account must reset it before touching anything else.
  if (user.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}

export function CaptainRoute({ children }) {
  return <RequireAuth role="captain">{children}</RequireAuth>;
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
  // A default-password account must reset it before touching anything else.
  if (user.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}
