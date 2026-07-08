import { useState, useEffect, useMemo } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import PageBackgroundIcon from "../../components/PageBackgroundIcon";
import attendanceIcon from "../../assets/dashboard-icons/bcc-icon-attendance.png";
import { ClipboardCheck, Shield, Trophy, Plus, Trash2, Users } from "lucide-react";

export default function Attendance() {
  const [rows, setRows] = useState([]);
  const [settings, setSettings] = useState({ total_matches_organized: 0, knockout_cutoff: 28 });
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newMatchLabel, setNewMatchLabel] = useState("");
  const [newMatchDate, setNewMatchDate] = useState("");
  const [addingMatch, setAddingMatch] = useState(false);

  const [expandedMatchId, setExpandedMatchId] = useState(null);
  const [expandedAttendeeIds, setExpandedAttendeeIds] = useState(new Set());
  const [savingMatch, setSavingMatch] = useState(false);

  const fetchAttendance = async () => {
    const res = await api.get("/admin/attendance");
    setRows(res.data.voters);
    setSettings(res.data.settings);
  };

  const fetchMatches = async () => {
    const res = await api.get("/admin/attendance/matches");
    setMatches(res.data);
  };

  const fetchAll = async () => {
    try {
      await Promise.all([fetchAttendance(), fetchMatches()]);
    } catch {
      toast.error("Failed to load attendance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAll(); }, []);

  const toggleEligible = (id) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, knockout_eligible: !r.knockout_eligible } : r));
  };

  // Ranked by % attended (ties broken by name so the order is stable) — this
  // is purely a display/ranking concern, not what gets saved; knockout_eligible
  // stays whatever was last saved (or hand-edited) until "Auto-Mark Top N" or
  // a manual checkbox flip changes it.
  const ranked = useMemo(() => {
    const totalMatches = settings.total_matches_organized;
    return [...rows]
      .map(r => ({
        ...r,
        percentage: totalMatches > 0 ? Math.round((r.attendance_count / totalMatches) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.percentage - a.percentage || a.name.localeCompare(b.name));
  }, [rows, settings.total_matches_organized]);

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

  const handleAddMatch = async (e) => {
    e.preventDefault();
    setAddingMatch(true);
    try {
      await api.post("/admin/attendance/matches", {
        label: newMatchLabel.trim(), match_date: newMatchDate || null,
      });
      setNewMatchLabel("");
      setNewMatchDate("");
      await fetchMatches();
      toast.success("Match added");
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add match");
    } finally {
      setAddingMatch(false);
    }
  };

  const handleRemoveMatch = async (match) => {
    if (!confirm(`Remove "${match.label}"? This also removes it from everyone's attendance count.`)) return;
    try {
      await api.delete(`/admin/attendance/matches/${match.id}`);
      if (expandedMatchId === match.id) setExpandedMatchId(null);
      await Promise.all([fetchMatches(), fetchAttendance()]);
      toast.success("Match removed");
    } catch {
      toast.error("Failed to remove match");
    }
  };

  const openChecklist = (match) => {
    setExpandedMatchId(match.id);
    setExpandedAttendeeIds(new Set(match.attendee_ids));
  };

  const toggleAttendee = (voterId) => {
    setExpandedAttendeeIds(prev => {
      const next = new Set(prev);
      if (next.has(voterId)) next.delete(voterId); else next.add(voterId);
      return next;
    });
  };

  const handleSaveMatchAttendance = async (matchId) => {
    setSavingMatch(true);
    try {
      await api.put(`/admin/attendance/matches/${matchId}`, {
        attendee_ids: Array.from(expandedAttendeeIds),
      });
      setExpandedMatchId(null);
      await Promise.all([fetchMatches(), fetchAttendance()]);
      toast.success("Match attendance saved");
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save match attendance");
    } finally {
      setSavingMatch(false);
    }
  };

  return (
    <div className="min-h-screen bg-cricket-cream isolate">
      <PageBackgroundIcon src={attendanceIcon} />
      <Navbar />
      <div className="max-w-5xl mx-auto px-4 py-8">

        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ClipboardCheck size={22} /> Knockout Attendance
            </h1>
            <p className="text-sm text-gray-500">
              Reference only — ranked by % of league matches attended, for picking knockout lineups once the league stage ends.
            </p>
          </div>
          <button onClick={handleSaveAll} disabled={saving || loading} className="btn-primary">
            {saving ? "Saving…" : "Save All"}
          </button>
        </div>

        {/* Matches */}
        <div className="card mb-6">
          <h2 className="font-semibold text-gray-800 mb-1">League Matches</h2>
          <p className="text-sm text-gray-500 mb-4">
            {settings.total_matches_organized} match{settings.total_matches_organized === 1 ? "" : "es"} recorded so far — attendance counts and % below are derived from these.
          </p>

          <form onSubmit={handleAddMatch} className="flex flex-wrap items-end gap-3 mb-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Label (optional)</label>
              <input className="input-field py-1.5 text-sm w-40" placeholder={`Match ${matches.length + 1}`}
                value={newMatchLabel} onChange={e => setNewMatchLabel(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date (optional)</label>
              <input type="date" className="input-field py-1.5 text-sm" value={newMatchDate}
                onChange={e => setNewMatchDate(e.target.value)} />
            </div>
            <button type="submit" disabled={addingMatch} className="btn-secondary flex items-center gap-2">
              <Plus size={15} /> Add Match
            </button>
          </form>

          {matches.length === 0 ? (
            <p className="text-gray-400 text-sm">No matches recorded yet — add one above, then mark who attended it.</p>
          ) : (
            <div className="space-y-2">
              {matches.map(m => (
                <div key={m.id} className="border rounded-lg">
                  <div className="flex items-center justify-between px-3 py-2 flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="font-medium text-gray-900">{m.label}</span>
                      {m.match_date && <span className="text-xs text-gray-400">{m.match_date}</span>}
                      <span className="text-xs text-gray-500 flex items-center gap-1">
                        <Users size={12} /> {m.attendee_count} attended
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => expandedMatchId === m.id ? setExpandedMatchId(null) : openChecklist(m)}
                        className="btn-secondary text-xs py-1.5 px-3"
                      >
                        {expandedMatchId === m.id ? "Close" : "Edit Attendance"}
                      </button>
                      <button onClick={() => handleRemoveMatch(m)} className="p-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200" title="Remove match">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {expandedMatchId === m.id && (
                    <div className="border-t px-3 py-3">
                      <div className="max-h-64 overflow-y-auto grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 mb-3">
                        {rows.map(r => (
                          <label key={r.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer"
                              checked={expandedAttendeeIds.has(r.id)}
                              onChange={() => toggleAttendee(r.id)}
                            />
                            {r.name}
                          </label>
                        ))}
                      </div>
                      <button
                        onClick={() => handleSaveMatchAttendance(m.id)}
                        disabled={savingMatch}
                        className="btn-primary text-sm py-1.5 px-4"
                      >
                        {savingMatch ? "Saving…" : "Save This Match's Attendance"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
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

        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : (
          <div className="card p-0 overflow-hidden overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-cricket-navy text-white">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Rank</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Code</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Name</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Role</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Attendance Count</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">% Attended</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Knockout Eligible</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((r, i) => {
                  const withinCutoff = i < settings.knockout_cutoff;
                  return (
                    <tr key={r.id} className={`border-b last:border-0 ${withinCutoff ? "bg-green-50/60" : i % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-blue-50/30 transition-colors`}>
                      <td className="px-4 py-3 text-gray-400 font-mono">{i + 1}</td>
                      <td className="px-4 py-3">
                        <span className="bg-cricket-navy text-white text-xs font-bold px-2.5 py-1 rounded">
                          {r.team_code}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                      <td className="px-4 py-3">
                        {r.role === "captain" ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-cricket-navy bg-blue-50 rounded-full px-2.5 py-1 w-fit">
                            <Shield size={11} /> Captain
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2.5 py-1 w-fit">
                            {r.role === "admin" ? "Admin" : "Player"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700">{r.attendance_count}</td>
                      <td className="px-4 py-3 font-medium text-gray-700">{r.percentage}%</td>
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer"
                          checked={r.knockout_eligible}
                          onChange={() => toggleEligible(r.id)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {rows.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">No voters yet.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
