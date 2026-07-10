import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../utils/api";
import { KeyRound } from "lucide-react";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ team_code: "", current_password: "", new_password: "", confirm_password: "" });
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
      await api.post("/auth/reset-password", {
        team_code: form.team_code.trim().toUpperCase(),
        current_password: form.current_password,
        new_password: form.new_password,
      });
      toast.success("Password updated — sign in with your new password");
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-cricket-navy via-pitch-800 to-cricket-navy px-4">
      <div className="text-center mb-8">
        <div className="text-6xl mb-3">🏏</div>
        <h1 className="text-3xl font-bold text-white">BCC-CVote</h1>
      </div>

      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <div className="flex items-center gap-2 mb-1">
          <KeyRound size={20} className="text-pitch-600" />
          <h2 className="text-xl font-bold text-gray-900">Reset Password</h2>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Enter your team code and current password to set a new one — no need to sign in first.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-2.5 rounded-lg mb-4">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Team Code</label>
            <input
              type="text"
              className="input-field uppercase"
              placeholder="e.g. RHT"
              value={form.team_code}
              onChange={(e) => setForm({ ...form, team_code: e.target.value })}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label>
            <input
              type="password"
              className="input-field"
              value={form.current_password}
              onChange={(e) => setForm({ ...form, current_password: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
            <input
              type="password" className="input-field" required minLength={6}
              value={form.new_password}
              onChange={(e) => setForm({ ...form, new_password: e.target.value })}
            />
            <p className="text-xs text-gray-400 mt-1">At least 6 characters, and not all numbers.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label>
            <input
              type="password" className="input-field" required minLength={6}
              value={form.confirm_password}
              onChange={(e) => setForm({ ...form, confirm_password: e.target.value })}
            />
          </div>
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? "Updating…" : "Update Password"}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-6">
          Forgot your current password too? <Link to="/login" className="underline">Contact your organizer</Link> for a manual reset.
        </p>
      </div>
    </div>
  );
}
