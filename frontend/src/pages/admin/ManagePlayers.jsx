import { useState, useEffect } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import { UserPlus, Edit2, Check, X, Shield } from "lucide-react";

export default function ManagePlayers() {
  const [players, setPlayers]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState({ name: "", team_code: "", password: "" });
  const [editRow, setEditRow]     = useState({ name: "", team_code: "", password: "" });
  const [submitting, setSubmitting] = useState(false);

  const fetchPlayers = async () => {
    try {
      const res = await api.get("/admin/players");
      setPlayers(res.data);
    } catch {
      toast.error("Failed to load players");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchPlayers(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api.post("/admin/players", form);
      toast.success(`${res.data.player.name} added! Password: ${res.data.default_password}`);
      setForm({ name: "", team_code: "", password: "" });
      setShowForm(false);
      fetchPlayers();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add player");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveRow = async (id) => {
    setSubmitting(true);
    try {
      await api.put(`/admin/players/${id}`, editRow);
      toast.success("Player updated");
      setEditId(null);
      fetchPlayers();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (player) => {
    if (!confirm(`Remove ${player.name} from the player roster?`)) return;
    try {
      await api.delete(`/admin/players/${player.id}`);
      toast.success(`${player.name} removed`);
      fetchPlayers();
    } catch {
      toast.error("Failed to remove player");
    }
  };

  const startEdit = (p) => {
    setEditId(p.id);
    setEditRow({ name: p.name, team_code: p.team_code, password: "" });
  };

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manage Players</h1>
            <p className="text-sm text-gray-500">
              {players.length} people who can cast an availability vote
              {" "}({players.filter(p => p.role === "captain").length} captains + {players.filter(p => p.role === "player").length} players)
            </p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
            <UserPlus size={16} /> Add Player
          </button>
        </div>

        {/* Add player form */}
        {showForm && (
          <form onSubmit={handleAdd} className="card mb-6">
            <h3 className="font-semibold text-gray-800 mb-4">New Player</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Player Name *</label>
                <input className="input-field" placeholder="Abhi" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Login Code *</label>
                <input className="input-field uppercase" placeholder="ABH" value={form.team_code}
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
                {submitting ? "Adding…" : "Add Player"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm py-2 px-4">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Player table */}
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
                  <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {players.map((p, i) => {
                  const isEditing = editId === p.id;
                  const isCaptain = p.role === "captain";
                  return (
                    <tr key={p.id} className={`border-b last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-blue-50/30 transition-colors`}>
                      <td className="px-4 py-3 text-gray-400 font-mono">{i + 1}</td>

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

                      <td className="px-4 py-3">
                        {isCaptain ? (
                          <span className="text-xs text-gray-400 italic" title="Edit this captain from Manage Captains">
                            Managed in Captains
                          </span>
                        ) : (
                          <div className="flex gap-2 items-center">
                            {isEditing ? (
                              <>
                                <button
                                  onClick={() => handleSaveRow(p.id)}
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
                              <>
                                <button
                                  onClick={() => startEdit(p)}
                                  className="p-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                                  title="Edit name / code"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button
                                  onClick={() => handleDeactivate(p)}
                                  className="p-1.5 bg-red-100 text-red-700 rounded hover:bg-red-200"
                                  title="Remove player"
                                >
                                  <X size={14} />
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {players.length === 0 && (
              <div className="text-center py-12 text-gray-400 text-sm">No players yet. Add one above.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
