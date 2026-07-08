import { useState, useEffect, useMemo } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import { ClipboardCheck, Shield, Trophy } from "lucide-react";

export default function Attendance() {
  const [rows, setRows] = useState([]);
  const [settings, setSettings] = useState({ total_matches_organized: 0, knockout_cutoff: 28 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
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

  useEffect(() => { fetchData(); }, []);

  const setCount = (id, value) => {
    const n = Math.max(0, parseInt(value, 10) || 0);
    setRows(prev => prev.map(r => r.id === id ? { ...r, attendance_count: n } : r));
  };

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
        api.put("/admin/attendance/settings", settings),
        api.put("/admin/attendance", {
          updates: rows.map(r => ({
            id: r.id, attendance_count: r.attendance_count, knockout_eligible: r.knockout_eligible,
          })),
        }),
      ]);
      toast.success("Attendance saved for everyone");
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-cricket-cream">
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

        {/* Settings */}
        <div className="card mb-6 flex flex-wrap items-end gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total League Matches Organized</label>
            <input
              type="number" min={0}
              className="input-field py-1.5 text-sm w-40"
              value={settings.total_matches_organized}
              onChange={e => setSettings(s => ({ ...s, total_matches_organized: Math.max(0, parseInt(e.target.value, 10) || 0) }))}
            />
          </div>
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
                      <td className="px-4 py-3">
                        <input
                          type="number" min={0}
                          className="input-field py-1.5 text-sm w-20"
                          value={r.attendance_count}
                          onChange={e => setCount(r.id, e.target.value)}
                        />
                      </td>
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
