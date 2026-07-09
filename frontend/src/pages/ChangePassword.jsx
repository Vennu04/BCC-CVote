import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";
import { homePathFor } from "../components/ProtectedRoute";
import api from "../utils/api";
import { KeyRound } from "lucide-react";

export default function ChangePassword() {
  const { user, refreshMe } = useAuth();
  const navigate = useNavigate();
  const forced = !!user?.must_change_password;

  const [form, setForm] = useState({ current_password: "", new_password: "", confirm_password: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (form.new_password !== form.confirm_password) {
      setError("New password and confirmation don't match");
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/auth/change-password", {
        current_password: form.current_password,
        new_password: form.new_password,
      });
      toast.success("Password updated");
      const updated = await refreshMe();
      navigate(homePathFor(updated), { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-sm mx-auto px-4 py-8">
        <div className="card">
          <div className="flex items-center gap-2 mb-1">
            <KeyRound size={20} className="text-pitch-600" />
            <h1 className="text-xl font-bold text-gray-900">Change Password</h1>
          </div>
          <p className="text-sm text-gray-500 mb-6">
            {forced
              ? "You're using a default password — set your own before continuing."
              : "Update your login password."}
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-lg mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
              <input
                type="password" className="input-field" required
                value={form.current_password}
                onChange={(e) => setForm({ ...form, current_password: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
              <input
                type="password" className="input-field" required minLength={4}
                value={form.new_password}
                onChange={(e) => setForm({ ...form, new_password: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
              <input
                type="password" className="input-field" required minLength={4}
                value={form.confirm_password}
                onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
              />
            </div>
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? "Updating…" : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
