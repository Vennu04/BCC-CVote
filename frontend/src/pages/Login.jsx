import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import toast from "react-hot-toast";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname || "/dashboard";

  const [form, setForm] = useState({ team_code: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(form.team_code.trim().toUpperCase(), form.password);
      toast.success(`Welcome, ${user.name}! 🏏`);
      navigate(user.role === "admin" ? "/admin" : from, { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error || "Login failed. Check your credentials.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-cricket-navy via-pitch-800 to-cricket-navy px-4">
      {/* Logo */}
      <div className="text-center mb-8">
        <div className="text-6xl mb-3">🏏</div>
        <h1 className="text-3xl font-bold text-white">BCC-CVote</h1>
        <p className="text-gray-300 text-sm mt-1">Cricket Captain Availability Voting</p>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
        <h2 className="text-xl font-bold text-gray-900 mb-1">Sign In</h2>
        <p className="text-sm text-gray-500 mb-6">Enter your team code and password</p>

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
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              className="input-field"
              placeholder="Your password"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full mt-2 flex items-center justify-center gap-2"
          >
            {loading ? "Signing in…" : "Sign In 🏏"}
          </button>
        </form>

        <p className="text-xs text-gray-400 text-center mt-6">
          Contact your organizer if you need access.
        </p>
      </div>
    </div>
  );
}
