import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { homePathFor } from "../components/ProtectedRoute";
import { COMPANY_NAME, TOURNAMENT_NAME } from "../config/appMeta";
import toast from "react-hot-toast";
import loginBackground from "../assets/branding/login-background.webp";
import venuhyaIcon from "../assets/branding/venuhya-icon.png";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();

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
      // Always land on the voter's own dashboard, never wherever they happened
      // to be sitting before their session went stale (e.g. a bookmarked or
      // PWA-reopened /results page) -- that's what silently drops captains/
      // players onto Results after a routine re-login instead of their actual
      // voting screen, which reads as "the app only shows Results".
      navigate(homePathFor(user), { replace: true });
    } catch (err) {
      const msg = err.response?.data?.error || "Login failed. Check your credentials.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-8 relative bg-cover bg-center safe-top safe-bottom safe-x bg-gradient-to-br from-royal-950 via-royal-900 to-royal-950"
      style={{ backgroundImage: `linear-gradient(160deg, rgba(3,13,36,0.88), rgba(5,24,54,0.82)), url(${loginBackground})` }}
    >
      <div className="relative z-10 flex flex-col items-center w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-sky-400/10 border border-sky-400/30 backdrop-blur flex items-center justify-center">
            <img src={venuhyaIcon} alt={COMPANY_NAME} className="w-10 h-10 rounded-lg" />
          </div>
          <span className="inline-block text-[11px] font-bold tracking-wider uppercase text-white/40 mb-2">
            {TOURNAMENT_NAME}
          </span>
          <h1 className="text-3xl font-black text-white tracking-tight">
            BCC <span className="text-sky-400">CVote</span>
          </h1>
          <p className="text-white/50 text-sm mt-1">Cricket Captain Availability Voting</p>
        </div>

        {/* Card */}
        <div className="card-dark backdrop-blur w-full max-w-sm p-8 shadow-[0_20px_50px_-14px_rgba(0,10,30,0.7)]">
          <h2 className="text-xl font-extrabold text-white mb-1">Sign in</h2>
          <p className="text-sm text-white/45 mb-6">Enter your team code and password</p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/35 text-red-400 text-sm px-4 py-3 rounded-xl mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[10.5px] font-extrabold tracking-wider uppercase text-white/40 mb-1.5">Team Code</label>
              <input
                type="text"
                className="input-field-dark uppercase"
                placeholder="e.g. RHT"
                value={form.team_code}
                onChange={(e) => setForm({ ...form, team_code: e.target.value })}
                required
                autoFocus
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-[10.5px] font-extrabold tracking-wider uppercase text-white/40">Password</label>
                <Link to="/reset-password" className="text-xs text-sky-400 hover:text-sky-300 font-bold min-h-[44px] flex items-center">
                  Reset Password
                </Link>
              </div>
              <input
                type="password"
                className="input-field-dark"
                placeholder="Your password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary-dark w-full mt-2 flex items-center justify-center gap-2"
            >
              {loading ? "Signing in…" : "Sign In 🏏"}
            </button>
          </form>

          <p className="text-xs text-white/30 text-center mt-6">
            Contact your support at email{" "}
            <a href="mailto:buddybccsupport@gmail.com" className="text-sky-400 font-medium underline">
              buddybccsupport@gmail.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
