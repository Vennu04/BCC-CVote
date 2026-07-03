import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { useAuth } from "./context/AuthContext";
import { ProtectedRoute, AdminRoute, CaptainRoute, PlayerRoute, homePathFor } from "./components/ProtectedRoute";
import Login from "./pages/Login";
import CaptainDashboard from "./pages/CaptainDashboard";
import PlayerDashboard from "./pages/PlayerDashboard";
import Results from "./pages/Results";
import AdminDashboard from "./pages/admin/AdminDashboard";
import ManageCaptains from "./pages/admin/ManageCaptains";
import ManagePlayers from "./pages/admin/ManagePlayers";
import VotingWindow from "./pages/admin/VotingWindow";

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
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/captain/dashboard" element={<CaptainRoute><CaptainDashboard /></CaptainRoute>} />
        <Route path="/player/dashboard"  element={<PlayerRoute><PlayerDashboard /></PlayerRoute>} />
        <Route path="/results"           element={<ProtectedRoute><Results /></ProtectedRoute>} />

        <Route path="/admin"           element={<AdminRoute><AdminDashboard /></AdminRoute>} />
        <Route path="/admin/captains"  element={<AdminRoute><ManageCaptains /></AdminRoute>} />
        <Route path="/admin/players"   element={<AdminRoute><ManagePlayers /></AdminRoute>} />
        <Route path="/admin/window"    element={<AdminRoute><VotingWindow /></AdminRoute>} />

        <Route path="/"   element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />
        <Route path="*"   element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
