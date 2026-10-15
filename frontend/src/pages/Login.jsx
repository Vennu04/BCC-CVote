import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { homePathFor } from "../components/ProtectedRoute";
import { COMPANY_NAME, TOURNAMENT_NAME } from "../config/appMeta";
import toast from "react-hot-toast";
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
      toast.success(`Welcome, ${user.name}`);
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
    <div className="min-h-screen bg-brand-navy text-white flex flex-col items-center justify-center px-5 py-10 safe-top safe-bottom safe-x">
      <div className="w-full max-w-sm flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <img src={venuhyaIcon} alt={COMPANY_NAME} className="w-12 h-12 rounded-xl" />
          <p className="text-xs font-bold tracking-wider uppercase text-white/70 mt-2">{TOURNAMENT_NAME}</p>
          <h1 className="font-display font-extrabold text-5xl tracking-wide leading-none">
            BCC <span className="text-brand-gold">CVOTE</span>
          </h1>
          <p className="text-[15px] text-white/80 leading-snug">Say if you're playing. Build your team at the live auction.</p>
        </div>

        <div className="bg-white text-brand-ink rounded-3xl p-6 shadow-soft-lg">
          <h2 className="text-2xl font-extrabold mb-5">Sign in</h2>

          {error && (
            <div role="alert" className="bg-[#fce8e6] text-[#a1251b] text-sm font-semibold px-4 py-3 rounded-xl mb-4">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-code" className="text-sm font-bold">Your player code</label>
              <input
                id="login-code"
                type="text"
                className="input-field uppercase placeholder:normal-case !text-[17px] !border-2 !min-h-[52px]"
                placeholder="e.g. SADA"
                value={form.team_code}
                onChange={(e) => setForm({ ...form, team_code: e.target.value })}
                required
                autoFocus
                autoCapitalize="characters"
                autoComplete="username"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="login-password" className="text-sm font-bold">Password</label>
              <input
                id="login-password"
                type="password"
                className="input-field !text-[17px] !border-2 !min-h-[52px]"
                placeholder="Your password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                autoComplete="current-password"
              />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full !min-h-[54px] text-[17px] mt-1">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-5 flex flex-col items-center gap-1 text-sm text-brand-muted text-center">
            <Link to="/reset-password" className="font-bold text-brand-navy min-h-[44px] flex items-center underline underline-offset-2">
              Forgot your password?
            </Link>
            <p>
              Or ask any admin, or email{" "}
              <a href="mailto:buddybccsupport@gmail.com" className="font-semibold text-brand-navy underline">buddybccsupport@gmail.com</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
