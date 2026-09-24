import { Suspense, lazy } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/AuthContext";
import { ProtectedRoute, AdminRoute, VoterRoute, homePathFor } from "./components/ProtectedRoute";
import { REDIRECTS } from "./utils/nav";
import Footer from "./components/Footer";
import NotificationPrompt from "./components/NotificationPrompt";
// Login/ResetPassword stay eager — they're the very first thing almost every
// session sees, and lazy-loading them would add a network round-trip before
// the login form even renders. Everything past auth is role-specific (a
// captain never touches the 5 admin pages and vice versa), so those split
// into per-route chunks instead of one bundle everyone downloads regardless
// of which half of the app they actually use.
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";

const ChangePassword = lazy(() => import("./pages/ChangePassword"));
const Home = lazy(() => import("./pages/Home"));
const Matches = lazy(() => import("./pages/Matches"));
const Stats = lazy(() => import("./pages/Stats"));
const Me = lazy(() => import("./pages/Me"));
const AuctionHome = lazy(() => import("./pages/AuctionHome"));
const Auction = lazy(() => import("./pages/Auction"));
const VotesInsights = lazy(() => import("./pages/admin/AdminDashboard"));
const ThisWeek = lazy(() => import("./pages/admin/ThisWeek"));
const GuidedStep = lazy(() => import("./pages/admin/GuidedSteps"));
const AllTools = lazy(() => import("./pages/admin/AllTools"));
const ManagePlayers = lazy(() => import("./pages/admin/ManagePlayers"));
const Attendance = lazy(() => import("./pages/admin/Attendance"));
const VotingWindow = lazy(() => import("./pages/admin/VotingWindow"));
const AdminAuction = lazy(() => import("./pages/admin/Auction"));
const AdminTournament = lazy(() => import("./pages/admin/Tournament"));
const AuctionDuty = lazy(() => import("./pages/admin/AuctionDuty"));

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

          {/* Stumps-style tabs (2026-09 redesign) */}
          <Route path="/home"            element={<VoterRoute><Home /></VoterRoute>} />
          <Route path="/matches"         element={<ProtectedRoute><Matches /></ProtectedRoute>} />
          <Route path="/matches/groups"  element={<ProtectedRoute><Matches /></ProtectedRoute>} />
          <Route path="/matches/whos-in" element={<ProtectedRoute><Matches /></ProtectedRoute>} />
          <Route path="/stats"           element={<ProtectedRoute><Stats /></ProtectedRoute>} />
          <Route path="/stats/knockout"  element={<ProtectedRoute><Stats /></ProtectedRoute>} />
          <Route path="/me"              element={<ProtectedRoute><Me /></ProtectedRoute>} />
          <Route path="/auction"         element={<VoterRoute><AuctionHome /></VoterRoute>} />
          <Route path="/auction/:id"     element={<ProtectedRoute><Auction /></ProtectedRoute>} />

          {/* Manage hubs */}
          <Route path="/manage"                     element={<AdminRoute><ThisWeek /></AdminRoute>} />
          <Route path="/manage/step/:step"          element={<AdminRoute><GuidedStep /></AdminRoute>} />
          <Route path="/manage/tools"               element={<AdminRoute><AllTools /></AdminRoute>} />
          <Route path="/manage/tools/votes"         element={<AdminRoute><VotesInsights /></AdminRoute>} />
          <Route path="/manage/matches"             element={<Navigate to="/manage/matches/fixtures" replace />} />
          <Route path="/manage/matches/fixtures"    element={<AdminRoute><AdminTournament /></AdminRoute>} />
          <Route path="/manage/matches/windows"     element={<AdminRoute><VotingWindow /></AdminRoute>} />
          <Route path="/manage/auction"             element={<Navigate to="/manage/auction/run" replace />} />
          <Route path="/manage/auction/run"         element={<AdminRoute><AdminAuction /></AdminRoute>} />
          <Route path="/manage/auction/duty"        element={<AdminRoute><AuctionDuty /></AdminRoute>} />
          <Route path="/manage/players"             element={<Navigate to="/manage/players/people" replace />} />
          <Route path="/manage/players/people"      element={<AdminRoute><ManagePlayers /></AdminRoute>} />
          <Route path="/manage/players/attendance"  element={<AdminRoute><Attendance /></AdminRoute>} />

          {/* Pre-redesign addresses keep working (bookmarks, WhatsApp links) */}
          {Object.entries(REDIRECTS).map(([from, to]) => (
            <Route key={from} path={from} element={<Navigate to={to} replace />} />
          ))}

          <Route path="/"   element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />
          <Route path="*"   element={<NotFound />} />
        </Routes>
      </Suspense>
      <NotificationPrompt />
      <Footer />
    </AuthProvider>
  );
}
