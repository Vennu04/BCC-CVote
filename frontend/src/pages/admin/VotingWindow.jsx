import { useState, useEffect } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import { Calendar, Clock, Save } from "lucide-react";

// Pre-fill to next Thu 18:00 → Fri 20:00 IST
function getDefaultWindow() {
  const now = new Date();
  const day = now.getDay(); // 0=Sun,1=Mon,...,4=Thu,5=Fri
  const daysUntilThu = (4 - day + 7) % 7 || 7;
  const thu = new Date(now);
  thu.setDate(now.getDate() + daysUntilThu);
  thu.setHours(18, 0, 0, 0);

  const fri = new Date(thu);
  fri.setDate(thu.getDate() + 1);
  fri.setHours(20, 0, 0, 0);

  const fmt = (d) => d.toISOString().slice(0, 16); // "YYYY-MM-DDTHH:MM"
  return { opens_at: fmt(thu), closes_at: fmt(fri) };
}

export default function VotingWindow() {
  const [window_, setWindow_] = useState(null);
  const [form, setForm] = useState(getDefaultWindow());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/admin/window")
      .then(res => setWindow_(res.data.window))
      .catch(() => toast.error("Failed to load window"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post("/admin/window", form);
      toast.success("Voting window updated! ✅");
      const res = await api.get("/admin/window");
      setWindow_(res.data.window);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save window");
    } finally {
      setSaving(false);
    }
  };

  const handleCloseEarly = async () => {
    if (!confirm("Close voting window early? Captains won't be able to vote.")) return;
    try {
      await api.post("/admin/window/close");
      toast.success("Window closed early");
      const res = await api.get("/admin/window");
      setWindow_(res.data.window);
    } catch {
      toast.error("Failed to close window");
    }
  };

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6">
          <Calendar className="text-pitch-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Voting Window</h1>
            <p className="text-sm text-gray-500">Set when captains can submit their availability</p>
          </div>
        </div>

        {/* Current window status */}
        {!loading && window_ && (
          <div className={`rounded-lg px-4 py-3 mb-6 text-sm font-medium border ${
            window_.is_open
              ? "bg-green-50 border-green-200 text-green-800"
              : "bg-gray-50 border-gray-200 text-gray-600"
          }`}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Clock size={16} />
                <span>
                  {window_.is_open ? "🟢 Voting is OPEN" : "🔴 Voting is CLOSED"}
                  {" — "}{window_.opens_at} to {window_.closes_at}
                </span>
              </div>
              {window_.is_open && (
                <button onClick={handleCloseEarly} className="text-red-700 underline text-xs hover:no-underline">
                  Close early
                </button>
              )}
            </div>
          </div>
        )}

        {/* Set new window form */}
        <form onSubmit={handleSave} className="card">
          <h2 className="font-semibold text-gray-800 mb-1">Set New Voting Window</h2>
          <p className="text-xs text-gray-500 mb-5">
            Default: Thursday 6:00 PM → Friday 8:00 PM IST. Times are interpreted as IST.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Opens At (IST) — Thursday 6 PM
              </label>
              <input
                type="datetime-local"
                className="input-field"
                value={form.opens_at}
                onChange={e => setForm({ ...form, opens_at: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Closes At (IST) — Friday 8 PM
              </label>
              <input
                type="datetime-local"
                className="input-field"
                value={form.closes_at}
                onChange={e => setForm({ ...form, closes_at: e.target.value })}
                required
              />
            </div>
          </div>

          <div className="mt-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-xs text-yellow-800">
            <strong>Note:</strong> Setting a new window deactivates the current one. Captains will immediately see the new window.
          </div>

          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2 mt-5">
            <Save size={15} /> {saving ? "Saving…" : "Save Window"}
          </button>
        </form>

        {/* Schedule guide */}
        <div className="card mt-6 bg-cricket-navy text-white">
          <h3 className="font-semibold mb-3 text-cricket-gold">🗓️ Recommended Weekly Schedule</h3>
          <div className="space-y-2 text-sm text-gray-300">
            <div className="flex justify-between"><span>Thursday 6:00 PM IST</span><span className="text-green-400">→ Open voting</span></div>
            <div className="flex justify-between"><span>Friday 8:00 PM IST</span><span className="text-red-400">→ Close voting</span></div>
            <div className="flex justify-between"><span>Saturday morning</span><span className="text-cricket-gold">→ Finalize schedule</span></div>
            <div className="flex justify-between"><span>Weekend</span><span>→ Matches 🏏</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
