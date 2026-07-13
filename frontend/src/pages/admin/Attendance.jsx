import { useState, useEffect, useMemo } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import PageBackgroundPhoto from "../../components/PageBackgroundPhoto";
import { LoadingState, EmptyState } from "../../components/LoadingState";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useConfirm } from "../../hooks/useConfirm";
import attendancePhoto from "../../assets/dashboard-backgrounds/attendance.webp";
import { ClipboardCheck, Trophy, Plus, Search, ChevronDown, ChevronUp, UserCheck } from "lucide-react";

// Mirrors the same role-aware endpoint pattern used on Manage Players —
// captains and players are both rows in this roster but live on two
// different Mongo update paths.
function endpointFor(person) {
  return person.role === "captain" ? "captains" : "players";
}

export default function Attendance() {
  const [rows, setRows] = useState([]);
  const [settings, setSettings] = useState({ knockout_cutoff: 14 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [incrementingId, setIncrementingId] = useState(null);
  const [search, setSearch] = useState("");
  const [mobileExpanded, setMobileExpanded] = useState(new Set());
  const { confirmProps, requestConfirm } = useConfirm();

  // Suggest Attendance from Votes — ties the "+1" credit to who actually
  // voted available for a real match, instead of it being a blind click
  // with no relationship to any match. Admin picks the slot explicitly
  // (recurring slots don't carry their own per-occurrence history — see the
  // backend comment on _attendance_suggest_candidates).
  const [slots, setSlots] = useState([]);
  const [suggestSlotId, setSuggestSlotId] = useState("");
  const [suggestData, setSuggestData] = useState(null);
  const [loadingSuggest, setLoadingSuggest] = useState(false);
  const [applyingSuggest, setApplyingSuggest] = useState(false);

  const fetchAttendance = async () => {
    try {
      const res = await api.get("/admin/attendance");
      setRows(res.data.voters);
      setSettings(res.data.settings);
    } catch {
      toast.error("Failed to load attendance");
    } finally {
      setLoading(false);
    }
  };

  const fetchSlots = async () => {
    try {
      const res = await api.get("/admin/window");
      setSlots(res.data.windows || []);
    } catch {
      // Silent — the suggest panel just won't have a slot list this tick;
      // doesn't block the rest of the page.
    }
  };

  useEffect(() => { fetchAttendance(); fetchSlots(); }, []);

  const fetchSuggestData = async (slotId) => {
    setLoadingSuggest(true);
    try {
      const res = await api.get("/admin/attendance/suggest", { params: { slot_id: slotId } });
      setSuggestData(res.data);
    } catch {
      toast.error("Failed to load suggested attendance");
      setSuggestData(null);
    } finally {
      setLoadingSuggest(false);
    }
  };

  useEffect(() => {
    if (!suggestSlotId) { setSuggestData(null); return; }
    fetchSuggestData(suggestSlotId);
  }, [suggestSlotId]);

  const handleApplySuggested = () => {
    const eligible = suggestData?.eligible_count ?? 0;
    if (!eligible) return;
    const matchLabel = `${suggestData.slot.day} ${suggestData.slot.match_time || suggestData.slot.time_of_day}`;
    requestConfirm(`Credit attendance for ${eligible} player(s) who voted available for ${matchLabel}?`, async () => {
      setApplyingSuggest(true);
      try {
        const res = await api.post("/admin/attendance/suggest/apply", { slot_id: suggestSlotId });
        toast.success(res.data.message);
        await fetchAttendance();
        await fetchSuggestData(suggestSlotId);
      } catch (err) {
        toast.error(err.response?.data?.error || "Failed to credit attendance");
      } finally {
        setApplyingSuggest(false);
      }
    });
  };

  const toggleMobileExpanded = (id) => {
    setMobileExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleEligible = (id) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, knockout_eligible: !r.knockout_eligible } : r));
  };

  // Ranked by Attendance % (real season data from the bulk stats load, not
  // the old empty league_matches mechanism) — nulls (never recorded) sort
  // last, ties broken by name so the order is stable. Purely a display/
  // ranking concern, not what gets saved; knockout_eligible stays whatever
  // was last saved (or hand-edited) until "Auto-Mark Top N" or a manual
  // checkbox flip changes it. `rank` is attached here (not derived from
  // array index at render time) so the Rank column and the Top-N highlight
  // stay correct even when the search filter narrows the list.
  const ranked = useMemo(() => {
    return [...rows]
      .sort((a, b) => {
        const pa = a.attendance_percentage;
        const pb = b.attendance_percentage;
        if (pa == null && pb == null) return a.name.localeCompare(b.name);
        if (pa == null) return 1;
        if (pb == null) return -1;
        return pb - pa || a.name.localeCompare(b.name);
      })
      .map((r, idx) => ({ ...r, rank: idx + 1 }));
  }, [rows]);

  const filteredRanked = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ranked;
    return ranked.filter(r => r.name.toLowerCase().includes(q) || r.team_code.toLowerCase().includes(q));
  }, [ranked, search]);

  const handleAutoMarkTopN = () => {
    const cutoff = settings.knockout_cutoff;
    const eligibleIds = new Set(ranked.slice(0, cutoff).map(r => r.id));
    setRows(prev => prev.map(r => ({ ...r, knockout_eligible: eligibleIds.has(r.id) })));
    toast.success(`Marked the top ${Math.min(cutoff, rows.length)} as eligible — review and Save All to persist`);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      await Promise.all([
        api.put("/admin/attendance/settings", { knockout_cutoff: settings.knockout_cutoff }),
        api.put("/admin/attendance", {
          updates: rows.map(r => ({ id: r.id, knockout_eligible: r.knockout_eligible })),
        }),
      ]);
      toast.success("Eligibility saved for everyone");
      fetchAttendance();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  // The whole point: one click credits this person with having attended one
  // more match. No shared "match" concept — their own matches_present and
  // total_matches both advance by 1, independent of everyone else's numbers.
  // Refetches the full list afterward (like every other mutation on this
  // app) rather than patching local state from the response, so this page
  // can never drift from what the server actually persisted.
  const handleIncrementAttendance = async (person) => {
    setIncrementingId(person.id);
    try {
      const res = await api.post(`/admin/${endpointFor(person)}/${person.id}/attendance/increment`);
      toast.success(`${person.name}: ${res.data.matches_present}/${res.data.total_matches} (${res.data.attendance_percentage}%)`);
      await fetchAttendance();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update attendance");
    } finally {
      setIncrementingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-cricket-cream isolate">
      <PageBackgroundPhoto src={attendancePhoto} />
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">

        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ClipboardCheck size={22} /> Knockout Attendance
            </h1>
            <p className="text-sm text-gray-500">
              Ranked by Attendance % — green rows are currently eligible for knockout matches. Click "+1" after a match to credit whoever played.
            </p>
          </div>
          <button onClick={handleSaveAll} disabled={saving || loading} className="btn-primary">
            {saving ? "Saving…" : "Save All"}
          </button>
        </div>

        {/* Knockout cutoff */}
        <div className="card mb-6 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Knockout Cutoff (Top N)</label>
            <input
              type="number" min={0}
              className="input-field py-1.5 text-sm w-32"
              value={settings.knockout_cutoff}
              onChange={e => setSettings(s => ({ ...s, knockout_cutoff: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
            />
          </div>
          <button onClick={handleAutoMarkTopN} disabled={loading} className="btn-secondary flex items-center gap-2">
            <Trophy size={15} /> Auto-Mark Top {settings.knockout_cutoff} as Eligible
          </button>
        </div>

        {/* Suggest Attendance from Votes */}
        <div className="card mb-6">
          <div className="flex items-center gap-2 mb-1">
            <UserCheck size={16} className="text-pitch-600" />
            <h2 className="font-bold text-gray-900 text-sm">Suggest Attendance from Votes</h2>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Credit everyone who voted "Available" for a match — pick which one, review who's included, then apply.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[220px]">
              <label className="block text-xs font-medium text-gray-700 mb-1">Match</label>
              <select
                className="input-field py-1.5 text-sm"
                value={suggestSlotId}
                onChange={e => setSuggestSlotId(e.target.value)}
              >
                <option value="">Select a match…</option>
                {slots.map(({ slot }) => (
                  <option key={slot.id} value={slot.id}>{slot.day} {slot.match_time || slot.time_of_day}</option>
                ))}
              </select>
            </div>
            {suggestSlotId && !loadingSuggest && suggestData?.window && (
              <button
                onClick={handleApplySuggested}
                disabled={applyingSuggest || suggestData.eligible_count === 0}
                className="btn-primary text-sm py-1.5 px-4 disabled:opacity-50"
              >
                {applyingSuggest ? "Crediting…" : `Credit ${suggestData.eligible_count} Player(s)`}
              </button>
            )}
          </div>

          {suggestSlotId && loadingSuggest && <p className="text-xs text-gray-400 mt-3">Loading…</p>}

          {suggestSlotId && !loadingSuggest && suggestData && (
            !suggestData.window ? (
              <p className="text-xs text-gray-400 mt-3">No voting window has ever been set for this match yet.</p>
            ) : suggestData.candidates.length === 0 ? (
              <p className="text-xs text-gray-400 mt-3">Nobody voted "Available" for this match.</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {suggestData.candidates.map(c => (
                  <span
                    key={c.id}
                    title={c.already_credited ? "Already credited for this match" : "Will be credited"}
                    className={`text-xs font-medium rounded-full px-2.5 py-1 ${
                      c.already_credited ? "bg-gray-100 text-gray-400 line-through" : "bg-pitch-50 text-pitch-700"
                    }`}
                  >
                    {c.name}
                  </span>
                ))}
              </div>
            )
          )}
        </div>

        {/* Search */}
        {!loading && rows.length > 0 && (
          <div className="relative mb-4 max-w-sm">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              className="input-field pl-9"
              placeholder="Search by name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}

        {loading ? (
          <LoadingState />
        ) : (
          <div className="card p-0 overflow-hidden">
            {/* Desktop / tablet: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-cricket-navy text-white">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Rank</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Code</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Name</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Matches Present</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Total Matches</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Attendance %</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Knockout Eligible</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap"></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRanked.map((r, i) => {
                    const withinCutoff = r.rank <= settings.knockout_cutoff;
                    return (
                      <tr key={r.id} className={`border-b last:border-0 ${withinCutoff ? "bg-green-50/60" : i % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-blue-50/30 transition-colors`}>
                        <td className="px-4 py-3 text-gray-400 font-mono">{r.rank}</td>
                        <td className="px-4 py-3">
                          <span className="bg-cricket-navy text-white text-xs font-bold px-2.5 py-1 rounded">
                            {r.team_code}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                        <td className="px-4 py-3 text-gray-700">{r.matches_present ?? <span className="text-gray-400 italic">—</span>}</td>
                        <td className="px-4 py-3 text-gray-700">{r.total_matches ?? <span className="text-gray-400 italic">—</span>}</td>
                        <td className="px-4 py-3 font-medium text-gray-700">{r.attendance_percentage != null ? `${r.attendance_percentage}%` : <span className="text-gray-400 italic">—</span>}</td>
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer"
                            checked={r.knockout_eligible}
                            onChange={() => toggleEligible(r.id)}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => handleIncrementAttendance(r)}
                            disabled={incrementingId === r.id}
                            className="flex items-center gap-1 text-xs py-1 px-2 rounded border border-pitch-500 text-pitch-700 bg-pitch-50 hover:bg-pitch-100 disabled:opacity-50 whitespace-nowrap"
                            title={`Credit ${r.name} with attending one more match`}
                          >
                            <Plus size={13} /> {incrementingId === r.id ? "…" : "+1"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked cards — rank/code/name/% up front, tap to
                expand matches present/total/eligibility + the +1 button. */}
            <div className="sm:hidden divide-y">
              {filteredRanked.map((r) => {
                const withinCutoff = r.rank <= settings.knockout_cutoff;
                const isExpanded = mobileExpanded.has(r.id);
                return (
                  <div key={r.id} className={`p-3 ${withinCutoff ? "bg-green-50/60" : ""}`}>
                    <button
                      type="button"
                      onClick={() => toggleMobileExpanded(r.id)}
                      className="w-full flex items-center justify-between gap-2 text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-gray-400 font-mono text-xs w-5 shrink-0">{r.rank}</span>
                        <span className="bg-cricket-navy text-white text-xs font-bold px-2 py-1 rounded shrink-0">{r.team_code}</span>
                        <span className="font-medium text-gray-900 truncate">{r.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-semibold text-gray-700">
                          {r.attendance_percentage != null ? `${r.attendance_percentage}%` : "—"}
                        </span>
                        {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="mt-3 pl-1 space-y-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Matches Present</span>
                          <span className="text-gray-700">{r.matches_present ?? "—"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Total Matches</span>
                          <span className="text-gray-700">{r.total_matches ?? "—"}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Knockout Eligible</span>
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer"
                            checked={r.knockout_eligible}
                            onChange={() => toggleEligible(r.id)}
                          />
                        </div>
                        <button
                          onClick={() => handleIncrementAttendance(r)}
                          disabled={incrementingId === r.id}
                          className="flex items-center gap-1 text-xs py-1.5 px-3 rounded border border-pitch-500 text-pitch-700 bg-pitch-50 hover:bg-pitch-100 disabled:opacity-50"
                        >
                          <Plus size={13} /> {incrementingId === r.id ? "…" : "+1 Attendance"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {rows.length === 0 && <EmptyState message="No voters yet." />}
            {rows.length > 0 && filteredRanked.length === 0 && (
              <EmptyState message={`No voters match "${search}".`} />
            )}
          </div>
        )}
      </div>

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
