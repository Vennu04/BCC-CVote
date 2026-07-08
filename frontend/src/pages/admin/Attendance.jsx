import { useState, useEffect } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import { ClipboardCheck, Shield } from "lucide-react";

export default function Attendance() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchRows = async () => {
    try {
      const res = await api.get("/admin/attendance");
      setRows(res.data);
    } catch {
      toast.error("Failed to load attendance");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRows(); }, []);

  const setCount = (id, value) => {
    const n = Math.max(0, parseInt(value, 10) || 0);
    setRows(prev => prev.map(r => r.id === id ? { ...r, attendance_count: n } : r));
  };

  const toggleEligible = (id) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, knockout_eligible: !r.knockout_eligible } : r));
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      await api.put("/admin/attendance", {
        updates: rows.map(r => ({
          id: r.id, attendance_count: r.attendance_count, knockout_eligible: r.knockout_eligible,
        })),
      });
      toast.success("Attendance saved for everyone");
      fetchRows();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to save attendance");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">

        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
              <ClipboardCheck size={22} /> Knockout Attendance
            </h1>
            <p className="text-sm text-gray-500">
              Reference only — league match attendance and knockout eligibility, for picking lineups once the league stage ends.
            </p>
          </div>
          <button onClick={handleSaveAll} disabled={saving || loading} className="btn-primary">
            {saving ? "Saving…" : "Save All"}
          </button>
        </div>

        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : (
          <div className="card p-0 overflow-hidden overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-cricket-navy text-white">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">#</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Code</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Name</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Role</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Attendance Count</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Knockout Eligible</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={`border-b last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-blue-50/30 transition-colors`}>
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
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        className="h-4 w-4 cursor-pointer"
                        checked={r.knockout_eligible}
                        onChange={() => toggleEligible(r.id)}
                      />
                    </td>
                  </tr>
                ))}
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
