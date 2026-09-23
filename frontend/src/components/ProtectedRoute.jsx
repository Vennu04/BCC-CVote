import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { isStaff, isVoter } from "../utils/roles";
import { homePathFor } from "../utils/nav";

// Where each role lands after login — see utils/nav.js.
export { homePathFor };

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
  // exception below. role=="organizer" gets the same console access; the
  // backend alone decides which specific actions organizer can't perform
  // (PERMISSIONS["destructive"] in utils/auth.py) — this route guard is
  // just "can see the admin console at all".
  if (!isStaff(user)) {
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

// Screens that only make sense for someone who votes (Home, the Auction tab):
// captains, players, and admin/organizer accounts flagged to vote.
export function VoterRoute({ children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center"><span className="text-pitch-600 font-medium">Loading…</span></div>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!isVoter(user)) return <Navigate to={homePathFor(user)} replace />;
  if (user.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }
  return children;
}
