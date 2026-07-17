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
import windowPhoto from "../../assets/dashboard-backgrounds/window.webp";
import { Calendar, Clock, Save, XCircle, CalendarPlus, Trash2, Pencil, RotateCcw, Ban } from "lucide-react";

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
  const [editingDateSlot, setEditingDateSlot] = useState(null); // slot_id currently showing the date-override input
  const [dateEdits, setDateEdits] = useState({}); // slot_id -> pending date value
  const [savingDateSlot, setSavingDateSlot] = useState(null);
  const [cancelingSlot, setCancelingSlot] = useState(null); // slot_id currently showing the cancel-reason input
  const [cancelReasons, setCancelReasons] = useState({}); // slot_id -> pending reason
  const [savingCancelSlot, setSavingCancelSlot] = useState(null);
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

  const handleCancelMatch = async (slotId) => {
    const reason = (cancelReasons[slotId] || "").trim();
    if (!reason) {
      toast.error("A cancellation reason is required");
      return;
    }
    setSavingCancelSlot(slotId);
    try {
      await api.post("/admin/window/cancel", { slot_id: slotId, reason });
      toast.success("Match cancelled");
      setCancelingSlot(null);
      fetchWindows();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to cancel match");
    } finally {
      setSavingCancelSlot(null);
    }
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

  const handleSaveDateOverride = async (slotId) => {
    const match_date = dateEdits[slotId];
    if (!match_date) return;
    setSavingDateSlot(slotId);
    try {
      await api.post(`/admin/slots/${slotId}/date`, { match_date });
      toast.success("Match date updated ✅");
      setEditingDateSlot(null);
      await fetchWindows();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update date");
    } finally {
      setSavingDateSlot(null);
    }
  };

  const handleResetDateOverride = async (slotId) => {
    setSavingDateSlot(slotId);
    try {
      await api.post(`/admin/slots/${slotId}/date`, { match_date: null });
      toast.success("Date override cleared");
      await fetchWindows();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to clear date override");
    } finally {
      setSavingDateSlot(null);
    }
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
                            {!slot.is_adhoc && (
                              <div className="mt-1">
                                {editingDateSlot === slot.id ? (
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="date"
                                      className="input-field text-sm py-1"
                                      value={dateEdits[slot.id] ?? slot.resolved_match_date ?? ""}
                                      onChange={(e) => setDateEdits({ ...dateEdits, [slot.id]: e.target.value })}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => handleSaveDateOverride(slot.id)}
                                      disabled={savingDateSlot === slot.id}
                                      className="text-xs font-medium text-pitch-600 hover:text-pitch-700"
                                    >
                                      {savingDateSlot === slot.id ? "Saving…" : "Save"}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setEditingDateSlot(null)}
                                      className="text-xs text-gray-500 hover:text-gray-700"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 text-sm text-gray-600">
                                    <span>{formatDateDisplay(slot.resolved_match_date)}</span>
                                    {slot.date_override && (
                                      <span className="text-xs font-medium text-amber-700 bg-amber-100 rounded-full px-2 py-0.5">overridden</span>
                                    )}
                                    <button
                                      type="button"
                                      onClick={() => setEditingDateSlot(slot.id)}
                                      title="Change date for this week"
                                      className="text-gray-400 hover:text-pitch-600"
                                    >
                                      <Pencil size={12} />
                                    </button>
                                    {slot.date_override && (
                                      <button
                                        type="button"
                                        onClick={() => handleResetDateOverride(slot.id)}
                                        disabled={savingDateSlot === slot.id}
                                        title="Reset to natural weekend date"
                                        className="text-gray-400 hover:text-red-600"
                                      >
                                        <RotateCcw size={12} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                          {win && (
                            <span className={`text-xs font-semibold rounded-full px-3 py-1 flex items-center gap-1 ${
                              win.is_cancelled ? "bg-red-100 text-red-700" : win.is_open ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
                            }`}>
                              <Clock size={12} />
                              {win.is_cancelled ? "CANCELLED" : win.is_open ? "OPEN" : "CLOSED"} — {win.opens_at} to {win.closes_at}
                            </span>
                          )}
                        </div>

                        {win?.is_cancelled && (
                          <div className="mb-3 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            <Ban size={14} />
                            <span>Cancelled — {win.cancel_reason}</span>
                          </div>
                        )}

                        {suggested && (
                          <p className="text-xs text-gray-500 mb-3">
                            Suggested: <strong>{suggested.opens_at}</strong> → <strong>{suggested.closes_at}</strong>
                          </p>
                        )}

                        <WeatherForecast weather={slot.weather} />

                        {win && (
                          <div className="mb-4">
                            <ConfirmedPlayersPanel voteMatrix={voteMatrix} slotId={slot.id} onVoteSet={fetchVoteMatrix} />
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
                            {win && !win.is_cancelled && (
                              <button
                                type="button"
                                onClick={() => setCancelingSlot(cancelingSlot === slot.id ? null : slot.id)}
                                className="flex items-center gap-2 text-sm py-2 px-4 rounded-lg border-2 border-red-300 text-red-700 bg-white hover:bg-red-50 font-medium"
                              >
                                <Ban size={14} /> Cancel Match
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

                        {cancelingSlot === slot.id && (
                          <div className="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
                            <input
                              type="text"
                              className="input-field flex-1 text-sm"
                              placeholder="Reason, e.g. Not enough players"
                              value={cancelReasons[slot.id] || ""}
                              onChange={(e) => setCancelReasons({ ...cancelReasons, [slot.id]: e.target.value })}
                            />
                            <button
                              type="button"
                              onClick={() => handleCancelMatch(slot.id)}
                              disabled={savingCancelSlot === slot.id}
                              className="text-sm py-2 px-4 rounded-lg bg-red-600 text-white font-medium hover:bg-red-700 disabled:opacity-50"
                            >
                              {savingCancelSlot === slot.id ? "Cancelling…" : "Confirm Cancel"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setCancelingSlot(null)}
                              className="text-sm py-2 px-4 text-gray-500 hover:text-gray-700"
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
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
