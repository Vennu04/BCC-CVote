import { useState, useEffect } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import PageBackgroundPhoto from "../../components/PageBackgroundPhoto";
import captainsPhoto from "../../assets/dashboard-backgrounds/captains.jpg";
import { UserPlus, Edit2, Check, X } from "lucide-react";

const STATUS_OPTIONS = [
  { value: "not_played",  label: "Not played match yet", color: "bg-gray-100 text-gray-600" },
  { value: "in_progress", label: "In-Progress",          color: "bg-blue-100 text-blue-700" },
  { value: "qualified",   label: "Qualified",            color: "bg-green-100 text-green-700" },
  { value: "eliminated",  label: "Eliminated",           color: "bg-red-100 text-red-700" },
];

function statusMeta(value) {
  return STATUS_OPTIONS.find(s => s.value === value) || STATUS_OPTIONS[0];
}

const AUCTION_CATEGORY_OPTIONS = [
  { value: "",                       label: "Not set" },
  { value: "extra_power_allrounder", label: "Extra Power — All-Rounder" },
  { value: "extra_power_batsman",    label: "Extra Power — Batsman" },
  { value: "power",                  label: "Power" },
  { value: "classic",                label: "Classic" },
];

export default function ManageCaptains() {
  const [captains, setCaptains]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState({ name: "", team_code: "", password: "" });
  const [editRow, setEditRow]     = useState({ name: "", team_code: "", team_name: "", password: "", matches_scheduled: 0, matches_played: 0 });
  const [submitting, setSubmitting] = useState(false);

  const fetchCaptains = async () => {
    try {
      const res = await api.get("/admin/captains");
      setCaptains(res.data);
    } catch {
      toast.error("Failed to load captains");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCaptains(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post("/admin/captains", form);
      toast.success(`${res.data.captain.name} added! Password: ${res.data.default_password}`);
      setForm({ name: "", team_code: "", password: "" });
      setShowForm(false);
      fetchCaptains();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add captain");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveRow = async (id) => {
    setSubmitting(true);
    try {
      await api.put(`/admin/captains/${id}`, editRow);
      toast.success("Captain updated");
      setEditId(null);
      fetchCaptains();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (captain, newStatus) => {
    try {
      await api.put(`/admin/captains/${captain.id}`, { tournament_status: newStatus });
      setCaptains(prev => prev.map(c => c.id === captain.id ? { ...c, tournament_status: newStatus } : c));
      toast.success(`${captain.name} → ${statusMeta(newStatus).label}`);
    } catch {
      toast.error("Failed to update status");
    }
  };

  const handleAuctionCategoryChange = async (captain, newCategory) => {
    if (!newCategory) return;
    try {
      await api.put(`/admin/captains/${captain.id}`, { auction_category: newCategory });
      setCaptains(prev => prev.map(c => c.id === captain.id ? { ...c, auction_category: newCategory } : c));
      toast.success(`${captain.name}'s auction category updated`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update auction category");
    }
  };

  const startEdit = (c) => {
    setEditId(c.id);
    setEditRow({
      name: c.name,
      team_code: c.team_code,
      team_name: c.team_name || "",
      password: "",
      matches_scheduled: c.matches_scheduled ?? 0,
      matches_played: c.matches_played ?? 0,
    });
  };

  return (
    <div className="min-h-screen bg-cricket-cream isolate">
      <PageBackgroundPhoto src={captainsPhoto} />
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manage Captains</h1>
            <p className="text-sm text-gray-500">{captains.length} teams registered</p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
            <UserPlus size={16} /> Add Captain
          </button>
        </div>

        {/* Add captain form */}
        {showForm && (
          <form onSubmit={handleAdd} className="card mb-6">
            <h3 className="font-semibold text-gray-800 mb-4">New Captain</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Captain Name *</label>
                <input className="input-field" placeholder="Rohit Sharma" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Team Name *</label>
                <input className="input-field uppercase" placeholder="MI" value={form.team_code}
                  onChange={e => setForm({ ...form, team_code: e.target.value.toUpperCase() })} required maxLength={6} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password (optional)</label>
                <input className="input-field" type="password" placeholder="Defaults to team name"
                  value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button type="submit" disabled={submitting} className="btn-primary text-sm py-2 px-4">
                {submitting ? "Adding…" : "Add Captain"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm py-2 px-4">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Captain table */}
        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : (
          <div className="card p-0 overflow-hidden overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-cricket-navy text-white">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">#</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Code</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Team Name</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Captain</th>
                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Player</th>
                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Matches Scheduled</th>
                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Matches Played</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Status</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Auction Category</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {captains.map((c, i) => {
                  const isEditing = editId === c.id;
                  const meta = statusMeta(c.tournament_status);
                  return (
                    <tr key={c.id} className={`border-b last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-blue-50/30 transition-colors`}>

                      {/* # */}
                      <td className="px-4 py-3 text-gray-400 font-mono">{i + 1}</td>

                      {/* Code */}
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className="input-field py-1.5 text-sm uppercase w-24"
                            value={editRow.team_code}
                            onChange={e => setEditRow({ ...editRow, team_code: e.target.value.toUpperCase() })}
                          />
                        ) : (
                          <span className="bg-cricket-navy text-white text-xs font-bold px-2.5 py-1 rounded">
                            {c.team_code}
                          </span>
                        )}
                      </td>

                      {/* Team Name */}
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className="input-field py-1.5 text-sm"
                            value={editRow.team_name || ""}
                            onChange={e => setEditRow({ ...editRow, team_name: e.target.value })}
                            placeholder="Team name"
                          />
                        ) : (
                          <span className="text-gray-800 font-medium">{c.team_name || <span className="text-gray-400 italic">—</span>}</span>
                        )}
                      </td>

                      {/* Captain name */}
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className="input-field py-1.5 text-sm"
                            value={editRow.name}
                            onChange={e => setEditRow({ ...editRow, name: e.target.value })}
                          />
                        ) : (
                          <span className="font-medium text-gray-900">{c.name}</span>
                        )}
                      </td>

                      {/* Also votes as a player */}
                      <td className="px-4 py-3 text-center">
                        {c.is_player && <span title="Also votes as a player">🏏</span>}
                      </td>

                      {/* Matches Scheduled */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <input
                            type="number" min="0"
                            className="input-field py-1.5 text-sm text-center w-20 mx-auto"
                            value={editRow.matches_scheduled}
                            onChange={e => setEditRow({ ...editRow, matches_scheduled: e.target.value })}
                          />
                        ) : (
                          <span className="font-semibold text-gray-700">{c.matches_scheduled ?? 0}</span>
                        )}
                      </td>

                      {/* Matches Played */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <input
                            type="number" min="0"
                            className="input-field py-1.5 text-sm text-center w-20 mx-auto"
                            value={editRow.matches_played}
                            onChange={e => setEditRow({ ...editRow, matches_played: e.target.value })}
                          />
                        ) : (
                          <span className="font-semibold text-gray-700">{c.matches_played ?? 0}</span>
                        )}
                      </td>

                      {/* Status — always a dropdown for admin */}
                      <td className="px-4 py-3">
                        <select
                          value={c.tournament_status || "not_played"}
                          onChange={e => handleStatusChange(c, e.target.value)}
                          className={`text-xs font-semibold rounded px-2 py-1 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cricket-navy/30 ${meta.color}`}
                        >
                          {STATUS_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>

                      {/* Auction Category */}
                      <td className="px-4 py-3">
                        <select
                          value={c.auction_category || ""}
                          onChange={e => handleAuctionCategoryChange(c, e.target.value)}
                          className="text-xs font-medium rounded px-2 py-1 border border-gray-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cricket-navy/30 bg-white text-gray-700"
                        >
                          {AUCTION_CATEGORY_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex gap-2 items-center">
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSaveRow(c.id)}
                                disabled={submitting}
                                className="p-1.5 bg-green-100 text-green-700 rounded hover:bg-green-200"
                                title="Save"
                              >
                                <Check size={14} />
                              </button>
                              <button
                                onClick={() => setEditId(null)}
                                className="p-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                                title="Cancel"
                              >
                                <X size={14} />
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEdit(c)}
                              className="p-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                              title="Edit name / team / match counts"
                            >
                              <Edit2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {captains.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">No captains yet. Add one above.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
