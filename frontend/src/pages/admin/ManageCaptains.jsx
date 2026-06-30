import { useState, useEffect } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import { UserPlus, Trash2, Edit2, Check, X } from "lucide-react";

export default function ManageCaptains() {
  const [captains, setCaptains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({ name: "", team_code: "", password: "" });
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
      toast.success(`${res.data.captain.name} added! Default password: ${res.data.default_password}`);
      setForm({ name: "", team_code: "", password: "" });
      setShowForm(false);
      fetchCaptains();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add captain");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (id) => {
    setSubmitting(true);
    try {
      await api.put(`/admin/captains/${id}`, form);
      toast.success("Captain updated");
      setEditId(null);
      fetchCaptains();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (captain) => {
    try {
      await api.put(`/admin/captains/${captain.id}`, { is_active: !captain.is_active });
      toast.success(`${captain.name} ${captain.is_active ? "deactivated" : "activated"}`);
      fetchCaptains();
    } catch {
      toast.error("Failed to update status");
    }
  };

  const startEdit = (c) => {
    setEditId(c.id);
    setForm({ name: c.name, team_code: c.team_code, password: "" });
  };

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manage Captains</h1>
            <p className="text-sm text-gray-500">{captains.filter(c => c.is_active).length} active captains</p>
          </div>
          <button onClick={() => setShowForm(!showForm)} className="btn-primary flex items-center gap-2">
            <UserPlus size={16} /> Add Captain
          </button>
        </div>

        {/* Add form */}
        {showForm && (
          <form onSubmit={handleAdd} className="card mb-6">
            <h3 className="font-semibold text-gray-800 mb-4">New Captain</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input className="input-field" placeholder="Rohit Sharma" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} required />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Team Code *</label>
                <input className="input-field uppercase" placeholder="RHT" value={form.team_code}
                  onChange={e => setForm({ ...form, team_code: e.target.value.toUpperCase() })} required maxLength={6} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password (optional)</label>
                <input className="input-field" type="password" placeholder="Defaults to team code"
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

        {/* Captain list */}
        {loading ? (
          <p className="text-gray-500 text-sm">Loading…</p>
        ) : (
          <div className="card p-0 overflow-hidden">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Team Code</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                  <th className="text-left px-4 py-3 font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {captains.map((c, i) => (
                  <tr key={c.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
                    <td className="px-4 py-3 border-b">
                      {editId === c.id ? (
                        <input className="input-field py-1.5 text-sm" value={form.name}
                          onChange={e => setForm({ ...form, name: e.target.value })} />
                      ) : (
                        <span className="font-medium text-gray-900">{c.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 border-b">
                      {editId === c.id ? (
                        <input className="input-field py-1.5 text-sm uppercase w-24" value={form.team_code}
                          onChange={e => setForm({ ...form, team_code: e.target.value.toUpperCase() })} />
                      ) : (
                        <span className="bg-cricket-navy text-white text-xs font-bold px-2 py-0.5 rounded">{c.team_code}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 border-b">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.is_active ? "bg-green-100 text-green-800" : "bg-red-100 text-red-700"}`}>
                        {c.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-3 border-b">
                      <div className="flex gap-2">
                        {editId === c.id ? (
                          <>
                            <button onClick={() => handleUpdate(c.id)} disabled={submitting}
                              className="p-1.5 bg-green-100 text-green-700 rounded hover:bg-green-200"><Check size={14} /></button>
                            <button onClick={() => setEditId(null)}
                              className="p-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"><X size={14} /></button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(c)}
                              className="p-1.5 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"><Edit2 size={14} /></button>
                            <button onClick={() => handleToggleActive(c)}
                              className={`p-1.5 rounded ${c.is_active ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-green-100 text-green-700 hover:bg-green-200"}`}>
                              {c.is_active ? <Trash2 size={14} /> : <Check size={14} />}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {captains.length === 0 && (
              <div className="text-center py-10 text-gray-400 text-sm">No captains yet. Add one above.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
