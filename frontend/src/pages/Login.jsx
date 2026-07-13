import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { homePathFor } from "../components/ProtectedRoute";
import { COMPANY_NAME } from "../config/appMeta";
import toast from "react-hot-toast";
import loginBackground from "../assets/branding/login-background.webp";
import venuhyaIcon from "../assets/branding/venuhya-icon.png";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from?.pathname;

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
      navigate(from || homePathFor(user), { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error || "Login failed. Check your credentials.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 relative bg-cover bg-center"
      style={{ backgroundImage: `url(${loginBackground})` }}
    >
      {/* Dark navy overlay over the photo — just enough to keep the card/text
          readable without hiding the photo entirely. */}
      <div className="absolute inset-0 bg-gradient-to-br from-cricket-navy/60 via-cricket-navy/40 to-cricket-navy/70" />

      <div className="relative z-10 flex flex-col items-center w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src={venuhyaIcon} alt={COMPANY_NAME} className="w-20 h-20 mx-auto mb-3 rounded-2xl shadow-lg" />
          <h1 className="text-3xl font-bold text-white">BCC-CVote</h1>
          <p className="text-gray-300 text-sm mt-1">Cricket Captain Availability Voting</p>
          <p className="text-gray-400 text-xs mt-1">Powered by {COMPANY_NAME}</p>
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
              <div className="flex items-center justify-between mb-1">
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <Link to="/reset-password" className="text-xs text-pitch-600 hover:text-pitch-700 font-medium">
                  Reset Password
                </Link>
              </div>
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
    </div>
  );
}
