import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/AuthContext";
import { ProtectedRoute, AdminRoute, CaptainRoute, PlayerRoute, homePathFor } from "./components/ProtectedRoute";
import Footer from "./components/Footer";
// Login/ResetPassword stay eager — they're the very first thing almost every
// session sees, and lazy-loading them would add a network round-trip before
// the login form even renders. Everything past auth is role-specific (a
// captain never touches the 5 admin pages and vice versa), so those split
// into per-route chunks instead of one bundle everyone downloads regardless
// of which half of the app they actually use.
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";

const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const CaptainDashboard = lazy(() => import("./pages/CaptainDashboard"));
const PlayerDashboard = lazy(() => import("./pages/PlayerDashboard"));
const Results = lazy(() => import("./pages/Results"));
const Auction = lazy(() => import("./pages/Auction"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));
const ManagePlayers = lazy(() => import("./pages/admin/ManagePlayers"));
const Attendance = lazy(() => import("./pages/admin/Attendance"));
const VotingWindow = lazy(() => import("./pages/admin/VotingWindow"));
const AdminAuction = lazy(() => import("./pages/admin/Auction"));

function RouteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-gray-500">Loading…</p>
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <div className="text-6xl mb-4">🏏</div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">404 — Stumped!</h1>
      <p className="text-gray-500 mb-6">This page doesn't exist.</p>
      <a href="/" className="btn-primary inline-block">Go Home</a>
    </div>
  );
}

// Sends an already-authenticated user to the dashboard for their role
function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={homePathFor(user)} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/change-password" element={<ProtectedRoute><ChangePassword /></ProtectedRoute>} />

          <Route path="/captain/dashboard" element={<CaptainRoute><CaptainDashboard /></CaptainRoute>} />
          <Route path="/player/dashboard"  element={<PlayerRoute><PlayerDashboard /></PlayerRoute>} />
          <Route path="/results"           element={<ProtectedRoute><Results /></ProtectedRoute>} />
          <Route path="/auction/:id"       element={<ProtectedRoute><Auction /></ProtectedRoute>} />

          <Route path="/admin"           element={<AdminRoute><AdminDashboard /></AdminRoute>} />
          <Route path="/admin/players"   element={<AdminRoute><ManagePlayers /></AdminRoute>} />
          {/* Manage Captains + Manage Players merged into one page — redirect old links/bookmarks */}
          <Route path="/admin/captains"  element={<Navigate to="/admin/players" replace />} />
          <Route path="/admin/people"    element={<Navigate to="/admin/players" replace />} />
          <Route path="/admin/attendance" element={<AdminRoute><Attendance /></AdminRoute>} />
          <Route path="/admin/window"    element={<AdminRoute><VotingWindow /></AdminRoute>} />
          <Route path="/admin/auction"   element={<AdminRoute><AdminAuction /></AdminRoute>} />

          <Route path="/"   element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />
          <Route path="*"   element={<NotFound />} />
        </Routes>
      </Suspense>
      <Footer />
    </AuthProvider>
  );
}
