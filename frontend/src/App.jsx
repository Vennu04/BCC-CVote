import { Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ProtectedRoute, AdminRoute } from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Results from "./pages/Results";
import AdminDashboard from "./pages/admin/AdminDashboard";
import ManageCaptains from "./pages/admin/ManageCaptains";
import VotingWindow from "./pages/admin/VotingWindow";

function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center text-center px-4">
      <div className="text-6xl mb-4">🏏</div>
      <h1 className="text-3xl font-bold text-gray-900 mb-2">404 — Stumped!</h1>
      <p className="text-gray-500 mb-6">This page doesn't exist.</p>
      <a href="/dashboard" className="btn-primary inline-block">Go to Dashboard</a>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
        <Route path="/results"   element={<ProtectedRoute><Results /></ProtectedRoute>} />

        <Route path="/admin"           element={<AdminRoute><AdminDashboard /></AdminRoute>} />
        <Route path="/admin/captains"  element={<AdminRoute><ManageCaptains /></AdminRoute>} />
        <Route path="/admin/window"    element={<AdminRoute><VotingWindow /></AdminRoute>} />

        <Route path="/"   element={<Navigate to="/dashboard" replace />} />
        <Route path="*"   element={<NotFound />} />
      </Routes>
    </AuthProvider>
  );
}
