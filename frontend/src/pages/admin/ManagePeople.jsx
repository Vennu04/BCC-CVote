import { useState, useEffect } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import PageBackgroundPhoto from "../../components/PageBackgroundPhoto";
import playersPhoto from "../../assets/dashboard-backgrounds/players.jpg";
import { UserPlus, Edit2, Check, X, Shield, Smartphone, SmartphoneNfc, KeyRound } from "lucide-react";

const AUCTION_CATEGORY_OPTIONS = [
  { value: "",                       label: "Not set" },
  { value: "extra_power_allrounder", label: "Extra Power — All-Rounder" },
  { value: "extra_power_batsman",    label: "Extra Power — Batsman" },
  { value: "power",                  label: "Power" },
  { value: "classic",                label: "Classic" },
];

const STATUS_OPTIONS = [
  { value: "not_played",  label: "Not played match yet", color: "bg-gray-100 text-gray-600" },
  { value: "in_progress", label: "In-Progress",          color: "bg-blue-100 text-blue-700" },
  { value: "qualified",   label: "Qualified",            color: "bg-green-100 text-green-700" },
  { value: "eliminated",  label: "Eliminated",           color: "bg-red-100 text-red-700" },
];

function statusMeta(value) {
  return STATUS_OPTIONS.find(s => s.value === value) || STATUS_OPTIONS[0];
}

// Captains and players are both rows in the same voter roster (GET
// /admin/players already returns everyone), but they're backed by two
// different Mongo update paths with different accepted fields — captains
// alone carry matches_scheduled/matches_played/tournament_status/team_name.
// Every mutation below picks the endpoint from the row's own role rather
// than assuming one, so a single table can safely edit both kinds of rows.
function endpointFor(person) {
  return person.role === "captain" ? "captains" : "players";
}

export default function ManagePeople() {
  const [people, setPeople]       = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState({ role: "player", name: "", team_code: "", password: "" });
  const [editRow, setEditRow]     = useState({
    name: "", team_code: "", password: "", team_name: "",
    matches_scheduled: 0, matches_played: 0,
    batting_average: "", strike_rate: "", bowling_average: "", economy: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [resettingDevice, setResettingDevice] = useState(null);
  const [resettingPassword, setResettingPassword] = useState(null);

  const fetchPeople = async () => {
    try {
      const res = await api.get("/admin/players");
      setPeople(res.data);
    } catch {
      toast.error("Failed to load people");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPeople(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const endpoint = form.role === "captain" ? "captains" : "players";
      const res = await api.post(`/admin/${endpoint}`, {
        name: form.name, team_code: form.team_code, password: form.password,
      });
      const added = res.data.captain || res.data.player;
      toast.success(`${added.name} added! Password: ${res.data.default_password}`);
      setForm({ role: "player", name: "", team_code: "", password: "" });
      setShowForm(false);
      fetchPeople();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add person");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveRow = async (person) => {
    setSubmitting(true);
    try {
      await api.put(`/admin/${endpointFor(person)}/${person.id}`, editRow);
      toast.success(`${person.name} updated`);
      setEditId(null);
      fetchPeople();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (person) => {
    if (!confirm(`Remove ${person.name} from the player roster?`)) return;
    try {
      await api.delete(`/admin/players/${person.id}`);
      toast.success(`${person.name} removed`);
      fetchPeople();
    } catch {
      toast.error("Failed to remove player");
    }
  };

  const startEdit = (p) => {
    setEditId(p.id);
    setEditRow({
      name: p.name, team_code: p.team_code, password: "",
      team_name: p.team_name || "",
      matches_scheduled: p.matches_scheduled ?? 0,
      matches_played: p.matches_played ?? 0,
      batting_average: p.batting_average ?? "", strike_rate: p.strike_rate ?? "",
      bowling_average: p.bowling_average ?? "", economy: p.economy ?? "",
    });
  };

  const handleResetDevice = async (p) => {
    if (!confirm(`Reset device lock for ${p.name}? Their next login will register whatever device they use then.`)) return;
    setResettingDevice(p.id);
    try {
      await api.post(`/admin/${endpointFor(p)}/${p.id}/reset-device`);
      toast.success(`${p.name}'s device reset`);
      setPeople(prev => prev.map(x => x.id === p.id ? { ...x, device_locked: false } : x));
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to reset device");
    } finally {
      setResettingDevice(null);
    }
  };

  // For a forgotten password (no self-service recovery — the person calls
  // admin directly). A random temp password is generated server-side (never
  // needs the old one), they're forced to change it on next login, and the
  // reset is logged for accountability.
  const handleResetPassword = async (p) => {
    if (!confirm(`Reset ${p.name}'s password? A new temporary password will be generated — relay it to them directly (e.g. by phone).`)) return;
    setResettingPassword(p.id);
    try {
      const res = await api.post(`/admin/${endpointFor(p)}/${p.id}/reset-password`);
      toast.success(`${p.name}'s temporary password: ${res.data.temp_password}`, { duration: 15000 });
      setPeople(prev => prev.map(x => x.id === p.id ? { ...x, must_change_password: true } : x));
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to reset password");
    } finally {
      setResettingPassword(null);
    }
  };

  const handleAuctionCategoryChange = async (person, newCategory) => {
    if (!newCategory) return;
    try {
      await api.put(`/admin/${endpointFor(person)}/${person.id}`, { auction_category: newCategory });
      setPeople(prev => prev.map(p => p.id === person.id ? { ...p, auction_category: newCategory } : p));
      toast.success(`${person.name}'s auction category updated`);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update auction category");
    }
  };

  const handleStatusChange = async (person, newStatus) => {
    try {
      await api.put(`/admin/captains/${person.id}`, { tournament_status: newStatus });
      setPeople(prev => prev.map(p => p.id === person.id ? { ...p, tournament_status: newStatus } : p));
      toast.success(`${person.name} → ${statusMeta(newStatus).label}`);
    } catch {
      toast.error("Failed to update status");
    }
  };

  const captainCount = people.filter(p => p.role === "captain").length;
  const playerCount = people.length - captainCount;

  return (
    <div className="min-h-screen bg-cricket-cream isolate">
      <PageBackgroundPhoto src={playersPhoto} />
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manage People</h1>
            <p className="text-sm text-gray-500">
              {people.length} people who can cast an availability vote ({captainCount} captains + {playerCount} players)
            </p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
            <UserPlus size={16} /> Add Person
          </button>
        </div>

        {/* Add person form */}
        {showForm && (
          <form onSubmit={handleAdd} className="card mb-6">
            <h3 className="font-semibold text-gray-800 mb-4">New Person</h3>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
                <select
                  className="input-field"
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                >
                  <option value="player">Player</option>
                  <option value="captain">Captain</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
                <input className="input-field" placeholder={form.role === "captain" ? "Rohit Sharma" : "Abhi"} value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Login Code *</label>
                <input className="input-field uppercase" placeholder={form.role === "captain" ? "MI" : "ABH"} value={form.team_code}
                  onChange={e => setForm({ ...form, team_code: e.target.value.toUpperCase() })} required maxLength={6} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password (optional)</label>
                <input className="input-field" type="password" placeholder="Defaults to login code"
                  value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button type="submit" disabled={submitting} className="btn-primary text-sm py-2 px-4">
                {submitting ? "Adding…" : "Add Person"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm py-2 px-4">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* People table */}
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
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Team Name</th>
                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Sched.</th>
                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Played</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Status</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Auction Category</th>
                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Bat Avg</th>
                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Strike Rate</th>
                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Bowl Avg</th>
                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Economy</th>
                  <th className="text-center px-4 py-3 font-semibold whitespace-nowrap">Device</th>
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p, i) => {
                  const isEditing = editId === p.id;
                  const isCaptain = p.role === "captain";
                  const meta = statusMeta(p.tournament_status);
                  const dash = <span className="text-gray-300 italic">—</span>;
                  return (
                    <tr key={p.id} className={`border-b last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-blue-50/30 transition-colors`}>
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
                            {p.team_code}
                          </span>
                        )}
                      </td>

                      {/* Name */}
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            className="input-field py-1.5 text-sm"
                            value={editRow.name}
                            onChange={e => setEditRow({ ...editRow, name: e.target.value })}
                          />
                        ) : (
                          <span className="font-medium text-gray-900">{p.name}</span>
                        )}
                      </td>

                      {/* Role */}
                      <td className="px-4 py-3">
                        {isCaptain ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-cricket-navy bg-blue-50 rounded-full px-2.5 py-1 w-fit">
                            <Shield size={11} /> Captain
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2.5 py-1 w-fit">
                            Player
                          </span>
                        )}
                      </td>

                      {/* Team Name — captain-only */}
                      <td className="px-4 py-3">
                        {!isCaptain ? dash : isEditing ? (
                          <input
                            className="input-field py-1.5 text-sm"
                            value={editRow.team_name}
                            onChange={e => setEditRow({ ...editRow, team_name: e.target.value })}
                            placeholder="Team name"
                          />
                        ) : (
                          <span className="text-gray-800 font-medium">{p.team_name || <span className="text-gray-400 italic">—</span>}</span>
                        )}
                      </td>

                      {/* Matches Scheduled — captain-only */}
                      <td className="px-4 py-3 text-center">
                        {!isCaptain ? dash : isEditing ? (
                          <input
                            type="number" min="0"
                            className="input-field py-1.5 text-sm text-center w-16 mx-auto"
                            value={editRow.matches_scheduled}
                            onChange={e => setEditRow({ ...editRow, matches_scheduled: e.target.value })}
                          />
                        ) : (
                          <span className="font-semibold text-gray-700">{p.matches_scheduled ?? 0}</span>
                        )}
                      </td>

                      {/* Matches Played — captain-only */}
                      <td className="px-4 py-3 text-center">
                        {!isCaptain ? dash : isEditing ? (
                          <input
                            type="number" min="0"
                            className="input-field py-1.5 text-sm text-center w-16 mx-auto"
                            value={editRow.matches_played}
                            onChange={e => setEditRow({ ...editRow, matches_played: e.target.value })}
                          />
                        ) : (
                          <span className="font-semibold text-gray-700">{p.matches_played ?? 0}</span>
                        )}
                      </td>

                      {/* Status — captain-only, always a dropdown for admin */}
                      <td className="px-4 py-3">
                        {!isCaptain ? dash : (
                          <select
                            value={p.tournament_status || "not_played"}
                            onChange={e => handleStatusChange(p, e.target.value)}
                            className={`text-xs font-semibold rounded px-2 py-1 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cricket-navy/30 ${meta.color}`}
                          >
                            {STATUS_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        )}
                      </td>

                      {/* Auction Category — single home for this now */}
                      <td className="px-4 py-3">
                        <select
                          value={p.auction_category || ""}
                          onChange={e => handleAuctionCategoryChange(p, e.target.value)}
                          className="text-xs font-medium rounded px-2 py-1 border border-gray-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cricket-navy/30 bg-white text-gray-700"
                        >
                          {AUCTION_CATEGORY_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                          ))}
                        </select>
                      </td>

                      {/* Batting Average */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <input
                            type="number" step="0.01" min="0"
                            className="input-field py-1.5 text-sm text-center w-20 mx-auto"
                            value={editRow.batting_average}
                            onChange={e => setEditRow({ ...editRow, batting_average: e.target.value })}
                          />
                        ) : (
                          <span className="text-gray-700">{p.batting_average ?? <span className="text-gray-400 italic">—</span>}</span>
                        )}
                      </td>

                      {/* Strike Rate */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <input
                            type="number" step="0.01" min="0"
                            className="input-field py-1.5 text-sm text-center w-20 mx-auto"
                            value={editRow.strike_rate}
                            onChange={e => setEditRow({ ...editRow, strike_rate: e.target.value })}
                          />
                        ) : (
                          <span className="text-gray-700">{p.strike_rate ?? <span className="text-gray-400 italic">—</span>}</span>
                        )}
                      </td>

                      {/* Bowling Average */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <input
                            type="number" step="0.01" min="0"
                            className="input-field py-1.5 text-sm text-center w-20 mx-auto"
                            value={editRow.bowling_average}
                            onChange={e => setEditRow({ ...editRow, bowling_average: e.target.value })}
                          />
                        ) : (
                          <span className="text-gray-700">{p.bowling_average ?? <span className="text-gray-400 italic">—</span>}</span>
                        )}
                      </td>

                      {/* Economy */}
                      <td className="px-4 py-3 text-center">
                        {isEditing ? (
                          <input
                            type="number" step="0.01" min="0"
                            className="input-field py-1.5 text-sm text-center w-20 mx-auto"
                            value={editRow.economy}
                            onChange={e => setEditRow({ ...editRow, economy: e.target.value })}
                          />
                        ) : (
                          <span className="text-gray-700">{p.economy ?? <span className="text-gray-400 italic">—</span>}</span>
                        )}
                      </td>

                      {/* Device lock status */}
                      <td className="px-4 py-3 text-center">
                        {p.device_locked ? (
                          <button
                            onClick={() => handleResetDevice(p)}
                            disabled={resettingDevice === p.id}
                            className="p-1.5 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 inline-flex"
                            title="Device registered — click to reset (lost/new phone)"
                          >
                            <SmartphoneNfc size={14} />
                          </button>
                        ) : (
                          <span className="text-gray-300 inline-flex" title="No device registered yet">
                            <Smartphone size={14} />
                          </span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex gap-2 items-center">
                          <button
                            onClick={() => handleResetPassword(p)}
                            disabled={resettingPassword === p.id}
                            className="p-1.5 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 disabled:opacity-50"
                            title="Reset password (forgotten password — generates a new temporary one)"
                          >
                            <KeyRound size={14} />
                          </button>
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSaveRow(p)}
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
                              onClick={() => startEdit(p)}
                              className="p-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                              title="Edit name / code / stats"
                            >
                              <Edit2 size={14} />
                            </button>
                          )}
                          {!isCaptain && !isEditing && (
                            <button
                              onClick={() => handleDeactivate(p)}
                              className="p-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200"
                              title="Remove player"
                            >
                              <X size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {people.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">No one yet. Add someone above.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
