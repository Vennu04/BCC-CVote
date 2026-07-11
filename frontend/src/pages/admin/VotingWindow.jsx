import { useState, useEffect, useMemo } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import PageBackgroundPhoto from "../../components/PageBackgroundPhoto";
import WeatherForecast from "../../components/WeatherForecast";
import ConfirmedPlayersPanel from "../../components/ConfirmedPlayersPanel";
import { LoadingState } from "../../components/LoadingState";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useConfirm } from "../../hooks/useConfirm";
import { formatDateDisplay } from "../../utils/formatDate";
import windowPhoto from "../../assets/dashboard-backgrounds/window.jpg";
import { Calendar, Clock, Save, XCircle, CalendarPlus, Trash2 } from "lucide-react";

const EMPTY_NEW_SLOT = { match_date: "", day: "", time_of_day: "Morning", description: "" };

// Confirmed-players turnout needs to update as votes come in without a manual
// refresh — 5s is frequent enough for admin to watch it live while deciding
// whether to start an auction, without hammering the server the way the
// 2.5s in-auction bidding poll needs to (that's live bidding; this is just
// pre-auction monitoring).
const POLL_INTERVAL_MS = 5000;

export default function VotingWindow() {
  const [windows, setWindows] = useState([]);
  const [voteMatrix, setVoteMatrix] = useState([]);
  const [forms, setForms] = useState({}); // slot_id -> { opens_at, closes_at }
  const [loading, setLoading] = useState(true);
  const [savingSlot, setSavingSlot] = useState(null);
  const [newSlot, setNewSlot] = useState(EMPTY_NEW_SLOT);
  const [addingSlot, setAddingSlot] = useState(false);
  const { confirmProps, requestConfirm } = useConfirm();

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

  // vote_matrix already has every voter's role/category alongside their vote
  // per slot — the same data admin/Auction.jsx already uses to preview
  // quotas, computed client-side rather than adding a parallel backend route.
  const fetchVoteMatrix = async () => {
    try {
      const res = await api.get("/admin/dashboard");
      setVoteMatrix(res.data.vote_matrix || []);
    } catch {
      // Silent — the confirmed-players panel just won't show counts this tick;
      // window controls above it don't depend on this and shouldn't error out.
    }
  };

  useEffect(() => { fetchWindows(); fetchVoteMatrix(); }, []);

  useEffect(() => {
    const interval = setInterval(() => { fetchWindows(); fetchVoteMatrix(); }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  // Ad-hoc slots sharing a match_date are candidate options for the same match
  // day (e.g. two alternate Saturday slots) — grouped side by side so admin can
  // compare turnout at a glance. Everything else (the 4 fixed recurring slots,
  // or an ad-hoc slot with a date no one else shares) keeps its own row, same
  // as before.
  const dayGroups = useMemo(() => {
    const groups = new Map();
    windows.forEach((w) => {
      const key = w.slot.is_adhoc && w.slot.match_date ? w.slot.match_date : w.slot.id;
      if (!groups.has(key)) groups.set(key, { key, label: w.slot.is_adhoc ? w.slot.match_date : null, items: [] });
      groups.get(key).items.push(w);
    });
    return Array.from(groups.values());
  }, [windows]);

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

  const handleCloseEarly = (slotId) => {
    requestConfirm("Close this match's voting window early? Voters won't be able to vote on it anymore.", async () => {
      try {
        await api.post("/admin/window/close", { slot_id: slotId });
        toast.success("Window closed early");
        fetchWindows();
      } catch {
        toast.error("Failed to close window");
      }
    });
  };

  const handleAddSlot = async (e) => {
    e.preventDefault();
    if (!newSlot.match_date || !newSlot.day) return;
    setAddingSlot(true);
    try {
      await api.post("/admin/slots", newSlot);
      toast.success("Ad-hoc match added — set its voting window below ✅");
      setNewSlot(EMPTY_NEW_SLOT);
      await fetchWindows();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add match");
    } finally {
      setAddingSlot(false);
    }
  };

  const handleRemoveSlot = (slotId) => {
    requestConfirm("Remove this ad-hoc match? Its voting history stays on record, but it will disappear from the voting list.", async () => {
      try {
        await api.delete(`/admin/slots/${slotId}`);
        toast.success("Match removed");
        fetchWindows();
      } catch (err) {
        toast.error(err.response?.data?.error || "Failed to remove match");
      }
    });
  };

  return (
    <div className="min-h-screen bg-cricket-cream isolate">
      <PageBackgroundPhoto src={windowPhoto} />
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6">
          <Calendar className="text-pitch-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Voting Windows</h1>
            <p className="text-sm text-gray-500">Each match has its own window — set when it opens and closes</p>
          </div>
        </div>

        <div className="card mb-6">
          <div className="flex items-center gap-2 mb-3">
            <CalendarPlus size={18} className="text-pitch-600" />
            <h2 className="font-bold text-gray-900">Add Ad-hoc Match</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            For a weather-driven date or an Indian public holiday — any day, not just the usual weekend slots.
          </p>
          <form onSubmit={handleAddSlot} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Match Date</label>
              <input
                type="date"
                className="input-field"
                value={newSlot.match_date}
                onChange={(e) => setNewSlot({ ...newSlot, match_date: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Time of Day</label>
              <select
                className="input-field"
                value={newSlot.time_of_day}
                onChange={(e) => setNewSlot({ ...newSlot, time_of_day: e.target.value })}
              >
                <option value="Morning">Morning</option>
                <option value="Evening">Evening</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Day Label</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Independence Day"
                value={newSlot.day}
                onChange={(e) => setNewSlot({ ...newSlot, day: e.target.value })}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Description (optional)</label>
              <input
                type="text"
                className="input-field"
                placeholder="e.g. Independence Day Match"
                value={newSlot.description}
                onChange={(e) => setNewSlot({ ...newSlot, description: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <button type="submit" disabled={addingSlot} className="btn-primary flex items-center gap-2 text-sm py-2 px-4">
                <CalendarPlus size={14} /> {addingSlot ? "Adding…" : "Add Match"}
              </button>
            </div>
          </form>
        </div>

        {loading ? (
          <LoadingState />
        ) : (
          <div className="space-y-5">
            {dayGroups.map((group) => (
              <div key={group.key}>
                {group.items.length > 1 && (
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                    {formatDateDisplay(group.label)} — {group.items.length} candidate slots, compare turnout below
                  </p>
                )}
                <div className={group.items.length > 1 ? "grid grid-cols-1 sm:grid-cols-2 gap-5" : ""}>
                  {group.items.map(({ slot, window: win, suggested }) => {
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

                        <WeatherForecast weather={slot.weather} />

                        {win && (
                          <div className="mb-4">
                            <ConfirmedPlayersPanel voteMatrix={voteMatrix} slotId={slot.id} />
                          </div>
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
                            {slot.is_adhoc && (
                              <button
                                type="button"
                                onClick={() => handleRemoveSlot(slot.id)}
                                className="flex items-center gap-2 text-sm py-2 px-4 rounded-lg border-2 border-red-300 text-red-700 bg-white hover:bg-red-50 font-medium"
                              >
                                <Trash2 size={14} /> Remove
                              </button>
                            )}
                          </div>
                        </form>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
