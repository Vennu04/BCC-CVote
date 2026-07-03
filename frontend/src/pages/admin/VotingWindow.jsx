import { useState, useEffect } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import { Calendar, Clock, Save, XCircle } from "lucide-react";

export default function VotingWindow() {
  const [windows, setWindows] = useState([]);
  const [forms, setForms] = useState({}); // slot_id -> { opens_at, closes_at }
  const [loading, setLoading] = useState(true);
  const [savingSlot, setSavingSlot] = useState(null);

  const fetchWindows = async () => {
    try {
      const res = await api.get("/admin/window");
      const list = res.data.windows || [];
      setWindows(list);
      setForms((prev) => {
        const next = { ...prev };
        list.forEach(({ slot, suggested }) => {
          if (!next[slot.id] && suggested) {
            next[slot.id] = { opens_at: suggested.opens_at_iso, closes_at: suggested.closes_at_iso };
          }
        });
        return next;
      });
    } catch {
      toast.error("Failed to load voting windows");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchWindows(); }, []);

  const handleSave = async (slotId, e) => {
    e.preventDefault();
    const form = forms[slotId];
    if (!form?.opens_at || !form?.closes_at) return;
    setSavingSlot(slotId);
    try {
      await api.post("/admin/window", { slot_id: slotId, ...form });
      toast.success("Voting window updated! ✅");
      await fetchWindows();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save window");
    } finally {
      setSavingSlot(null);
    }
  };

  const handleCloseEarly = async (slotId) => {
    if (!confirm("Close this match's voting window early? Voters won't be able to vote on it anymore.")) return;
    try {
      await api.post("/admin/window/close", { slot_id: slotId });
      toast.success("Window closed early");
      fetchWindows();
    } catch {
      toast.error("Failed to close window");
    }
  };

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6">
          <Calendar className="text-pitch-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Voting Windows</h1>
            <p className="text-sm text-gray-500">Each match has its own window — set when it opens and closes</p>
          </div>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : (
          <div className="space-y-5">
            {windows.map(({ slot, window: win, suggested }) => {
              const form = forms[slot.id] || {};
              return (
                <div key={slot.id} className="card">
                  <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{slot.day}</p>
                      <h2 className="font-bold text-gray-900">{slot.match_time || slot.time_of_day} — {slot.time_of_day} Match</h2>
                    </div>
                    {win && (
                      <span className={`text-xs font-semibold rounded-full px-3 py-1 flex items-center gap-1 ${
                        win.is_open ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                      }`}>
                        <Clock size={12} />
                        {win.is_open ? "OPEN" : "CLOSED"} — {win.opens_at} to {win.closes_at}
                      </span>
                    )}
                  </div>

                  {suggested && (
                    <p className="text-xs text-gray-500 mb-3">
                      Suggested: <strong>{suggested.opens_at}</strong> → <strong>{suggested.closes_at}</strong>
                    </p>
                  )}

                  <form onSubmit={(e) => handleSave(slot.id, e)} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Opens At (IST)</label>
                      <input
                        type="datetime-local"
                        className="input-field"
                        value={form.opens_at || ""}
                        onChange={(e) => setForms({ ...forms, [slot.id]: { ...form, opens_at: e.target.value } })}
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-700 mb-1">Closes At (IST)</label>
                      <input
                        type="datetime-local"
                        className="input-field"
                        value={form.closes_at || ""}
                        onChange={(e) => setForms({ ...forms, [slot.id]: { ...form, closes_at: e.target.value } })}
                        required
                      />
                    </div>
                    <div className="sm:col-span-2 flex gap-3">
                      <button type="submit" disabled={savingSlot === slot.id} className="btn-primary flex items-center gap-2 text-sm py-2 px-4">
                        <Save size={14} /> {savingSlot === slot.id ? "Saving…" : "Save Window"}
                      </button>
                      {win?.is_open && (
                        <button
                          type="button"
                          onClick={() => handleCloseEarly(slot.id)}
                          className="flex items-center gap-2 text-sm py-2 px-4 rounded-lg border-2 border-red-300 text-red-700 bg-white hover:bg-red-50 font-medium"
                        >
                          <XCircle size={14} /> Close Early
                        </button>
                      )}
                    </div>
                  </form>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
