import { Fragment, useState, useEffect, useMemo } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import PageBackgroundPhoto from "../../components/PageBackgroundPhoto";
import { LoadingState, EmptyState } from "../../components/LoadingState";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useConfirm } from "../../hooks/useConfirm";
import playersPhoto from "../../assets/dashboard-backgrounds/players.jpg";
import { UserPlus, Edit2, Check, X, Shield, KeyRound, ChevronDown, ChevronUp, Search } from "lucide-react";

const AUCTION_CATEGORY_OPTIONS = [
  { value: "",                       label: "Not set" },
  { value: "extra_power_allrounder", label: "Extra Power — All-Rounder" },
  { value: "extra_power_batsman",    label: "Extra Power — Batsman" },
  { value: "power",                  label: "Power" },
  { value: "classic",                label: "Classic" },
];

// Separate from AUCTION_CATEGORY_OPTIONS above: "" means "no filter applied"
// here (vs. "clear the category" in the per-row edit dropdown), so unset
// players need their own sentinel value to stay filterable.
const AUCTION_CATEGORY_FILTER_OPTIONS = [
  { value: "",                       label: "All Categories" },
  { value: "unset",                  label: "Not set" },
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
// alone carry tournament_status/team_name. Every mutation below picks the
// endpoint from the row's own role rather than assuming one, so a single
// table can safely edit both kinds of rows.
function endpointFor(person) {
  return person.role === "captain" ? "captains" : "players";
}

export default function ManagePlayers() {
  const [players, setPlayers]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState({ role: "player", name: "", team_code: "", password: "" });
  const [editRow, setEditRow]     = useState({ name: "", team_code: "", password: "", team_name: "" });
  const [submitting, setSubmitting] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [mobileExpanded, setMobileExpanded] = useState(new Set());
  const { confirmProps, requestConfirm } = useConfirm();

  // Bat Avg/Strike Rate/Bowl Avg/Economy live in their own expandable row
  // (one "Player Insights" column + a chevron), separate from the main
  // name/code/team edit above — same expand pattern Attendance.jsx already
  // uses per-player, so admins have seen it before. Only one row's insights
  // are open at a time.
  const [expandedStatsId, setExpandedStatsId] = useState(null);
  const [statsEditRow, setStatsEditRow] = useState({ batting_average: "", strike_rate: "", bowling_average: "", economy: "" });
  const [savingStats, setSavingStats] = useState(false);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players.filter(p => {
      const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.team_code.toLowerCase().includes(q);
      const matchesCategory = !categoryFilter
        || (categoryFilter === "unset" ? !p.auction_category : p.auction_category === categoryFilter);
      return matchesSearch && matchesCategory;
    });
  }, [players, search, categoryFilter]);

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

  const toggleMobileExpanded = (id) => {
    setMobileExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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
      fetchPlayers();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add player");
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
      fetchPlayers();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = (person) => {
    requestConfirm(`Remove ${person.name} from the player roster?`, async () => {
      try {
        await api.delete(`/admin/players/${person.id}`);
        toast.success(`${person.name} removed`);
        fetchPlayers();
      } catch {
        toast.error("Failed to remove player");
      }
    });
  };

  const startEdit = (p) => {
    setEditId(p.id);
    setEditRow({
      name: p.name, team_code: p.team_code, password: "",
      team_name: p.team_name || "",
    });
  };

  const toggleStats = (p) => {
    if (expandedStatsId === p.id) {
      setExpandedStatsId(null);
      return;
    }
    setExpandedStatsId(p.id);
    setStatsEditRow({
      batting_average: p.batting_average ?? "", strike_rate: p.strike_rate ?? "",
      bowling_average: p.bowling_average ?? "", economy: p.economy ?? "",
    });
  };

  const handleSaveStats = async (person) => {
    setSavingStats(true);
    try {
      await api.put(`/admin/${endpointFor(person)}/${person.id}`, statsEditRow);
      toast.success(`${person.name}'s player insights updated`);
      setExpandedStatsId(null);
      fetchPlayers();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update player insights");
    } finally {
      setSavingStats(false);
    }
  };

  // For a forgotten password (no self-service recovery — the person calls
  // admin directly). A random temp password is generated server-side (never
  // needs the old one), they're forced to change it on next login, and the
  // reset is logged for accountability.
  //
  // This and the two handlers below always refetch the full list after a
  // successful mutation rather than patching local state — standardized
  // across all four admin pages so displayed data can never drift from what
  // the server actually persisted.
  const handleResetPassword = (p) => {
    requestConfirm(`Reset ${p.name}'s password? A new temporary password will be generated — relay it to them directly (e.g. by phone).`, async () => {
      setResettingPassword(p.id);
      try {
        const res = await api.post(`/admin/${endpointFor(p)}/${p.id}/reset-password`);
        toast.success(`${p.name}'s temporary password: ${res.data.temp_password}`, { duration: 15000 });
        await fetchPlayers();
      } catch (err) {
        toast.error(err.response?.data?.error || "Failed to reset password");
      } finally {
        setResettingPassword(null);
      }
    });
  };

  const handleRoleChange = (person, newRole) => {
    if (newRole === person.role) return;
    const label = newRole === "captain" ? "Captain" : "Player";
    requestConfirm(
      `Change ${person.name}'s role to ${label}? Team Name, Status, and tournament fields are left as-is — fill them in separately if needed.`,
      async () => {
        try {
          await api.put(`/admin/${endpointFor(person)}/${person.id}`, { role: newRole });
          toast.success(`${person.name} is now a ${label}`);
          await fetchPlayers();
        } catch (err) {
          toast.error(err.response?.data?.error || "Failed to update role");
        }
      }
    );
  };

  const handleAuctionCategoryChange = async (person, newCategory) => {
    if (!newCategory) return;
    try {
      await api.put(`/admin/${endpointFor(person)}/${person.id}`, { auction_category: newCategory });
      toast.success(`${person.name}'s auction category updated`);
      await fetchPlayers();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update auction category");
    }
  };

  const handleStatusChange = async (person, newStatus) => {
    try {
      await api.put(`/admin/captains/${person.id}`, { tournament_status: newStatus });
      toast.success(`${person.name} → ${statusMeta(newStatus).label}`);
      await fetchPlayers();
    } catch {
      toast.error("Failed to update status");
    }
  };

  const captainCount = players.filter(p => p.role === "captain").length;
  const playerCount = players.length - captainCount;

  // Shared between the desktop table's expandable stats row and the mobile
  // card's expanded section — the editable Bat Avg/Strike Rate/Bowl Avg/
  // Economy form.
  const renderStatsForm = (p) => (
    <div className="flex flex-wrap items-end gap-4">
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Bat Avg</label>
        <input
          type="number" step="0.01" min="0"
          className="input-field py-1.5 text-sm w-24"
          value={statsEditRow.batting_average}
          onChange={e => setStatsEditRow({ ...statsEditRow, batting_average: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Strike Rate</label>
        <input
          type="number" step="0.01" min="0"
          className="input-field py-1.5 text-sm w-24"
          value={statsEditRow.strike_rate}
          onChange={e => setStatsEditRow({ ...statsEditRow, strike_rate: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Bowl Avg</label>
        <input
          type="number" step="0.01" min="0"
          className="input-field py-1.5 text-sm w-24"
          value={statsEditRow.bowling_average}
          onChange={e => setStatsEditRow({ ...statsEditRow, bowling_average: e.target.value })}
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Economy</label>
        <input
          type="number" step="0.01" min="0"
          className="input-field py-1.5 text-sm w-24"
          value={statsEditRow.economy}
          onChange={e => setStatsEditRow({ ...statsEditRow, economy: e.target.value })}
        />
      </div>
      <button onClick={() => handleSaveStats(p)} disabled={savingStats} className="btn-primary text-xs py-1.5 px-4">
        {savingStats ? "Saving…" : "Save"}
      </button>
      <button onClick={() => setExpandedStatsId(null)} className="btn-secondary text-xs py-1.5 px-4">
        Close
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-cricket-cream isolate">
      <PageBackgroundPhoto src={playersPhoto} />
      <Navbar />
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manage Players</h1>
            <p className="text-sm text-gray-500">
              {players.length} players who can cast an availability vote ({captainCount} captains + {playerCount} players)
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
                {submitting ? "Adding…" : "Add Player"}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-secondary text-sm py-2 px-4">
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Search + Auction Category filter */}
        {!loading && players.length > 0 && (
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="relative max-w-sm flex-1 min-w-[200px]">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                className="input-field pl-9"
                placeholder="Search by name or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              className="input-field max-w-[240px]"
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
            >
              {AUCTION_CATEGORY_FILTER_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}

        {/* Player list */}
        {loading ? (
          <LoadingState />
        ) : (
          <div className="card p-0 overflow-hidden">
            {/* Desktop / tablet: table with sticky header. max-h caps the
                table's own scroll area (not the whole page) so the sticky
                header has a scrolling ancestor to stick within. */}
            <div className="hidden sm:block max-h-[75vh] overflow-y-auto overflow-x-auto rounded-xl">
              <table className="min-w-full text-sm">
                <thead className="bg-cricket-navy text-white sticky top-0 z-10">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">#</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Code</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Name</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Role</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Team Name</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Auction Category</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Player Insights</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Status</th>
                    <th className="text-left px-4 py-3 font-semibold whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPlayers.map((p, i) => {
                    const isEditing = editId === p.id;
                    const isCaptain = p.role === "captain";
                    const meta = statusMeta(p.tournament_status);
                    const dash = <span className="text-gray-300 italic">—</span>;
                    const statsExpanded = expandedStatsId === p.id;
                    return (
                    <Fragment key={p.id}>
                      <tr className={`border-b last:border-0 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/60"} hover:bg-blue-50/30 transition-colors`}>
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

                        {/* Role + next-match availability, grouped together */}
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 items-start">
                            <select
                              value={p.role}
                              onChange={e => handleRoleChange(p, e.target.value)}
                              className={`flex items-center gap-1 text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cricket-navy/30 ${isCaptain ? "text-cricket-navy bg-blue-50" : "text-gray-500 bg-gray-100"}`}
                            >
                              <option value="player">Player</option>
                              <option value="captain">Captain</option>
                            </select>
                            <span
                              title={p.next_match_label ? `Availability for ${p.next_match_label}` : "No upcoming match scheduled yet"}
                              className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${p.next_match_available ? "bg-green-100 text-green-700" : "bg-red-50 text-red-600"}`}
                            >
                              {p.next_match_available ? "Available" : "Not Available"}
                            </span>
                          </div>
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

                        {/* Auction Category — single home for this */}
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

                        {/* Player Insights — collapsed to one cell, expands to an editable row below */}
                        <td className="px-4 py-3">
                          <button
                            onClick={() => toggleStats(p)}
                            className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-cricket-navy whitespace-nowrap"
                            title="View / edit player insights (batting & bowling)"
                          >
                            <span>Bat {p.batting_average ?? "—"}/{p.strike_rate ?? "—"} · Bowl {p.bowling_average ?? "—"}/{p.economy ?? "—"}</span>
                            {statsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
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
                                title="Edit name / code"
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

                      {statsExpanded && (
                        <tr className="border-b bg-blue-50/40">
                          <td colSpan={9} className="px-4 py-3">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                              Player Insights — {p.name}
                            </p>
                            {renderStatsForm(p)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile: stacked cards — code/name/role up front, tap to
                expand team name, auction category, status, player insights,
                and actions. */}
            <div className="sm:hidden divide-y">
              {filteredPlayers.map((p) => {
                const isEditing = editId === p.id;
                const isCaptain = p.role === "captain";
                const meta = statusMeta(p.tournament_status);
                const statsExpanded = expandedStatsId === p.id;
                const isExpanded = mobileExpanded.has(p.id);
                return (
                  <div key={p.id} className="p-3">
                    <button
                      type="button"
                      onClick={() => toggleMobileExpanded(p.id)}
                      className="w-full flex items-center justify-between gap-2 text-left"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="bg-cricket-navy text-white text-xs font-bold px-2 py-1 rounded shrink-0">{p.team_code}</span>
                        <span className="font-medium text-gray-900 truncate">{p.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {isCaptain ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-cricket-navy bg-blue-50 rounded-full px-2 py-0.5">
                            <Shield size={10} /> Captain
                          </span>
                        ) : (
                          <span className="text-xs font-medium text-gray-500 bg-gray-100 rounded-full px-2 py-0.5">Player</span>
                        )}
                        {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                      </div>
                    </button>

                    {isExpanded && (
                      <div className="mt-3 pl-1 space-y-3 text-sm">
                        {isEditing && (
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Code</label>
                              <input className="input-field py-1.5 text-sm uppercase" value={editRow.team_code}
                                onChange={e => setEditRow({ ...editRow, team_code: e.target.value.toUpperCase() })} />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">Name</label>
                              <input className="input-field py-1.5 text-sm" value={editRow.name}
                                onChange={e => setEditRow({ ...editRow, name: e.target.value })} />
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-2">
                          <span className="text-gray-500">Role</span>
                          <div className="flex items-center gap-2">
                            <select
                              value={p.role}
                              onChange={e => handleRoleChange(p, e.target.value)}
                              className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 ${isCaptain ? "text-cricket-navy bg-blue-50" : "text-gray-500 bg-gray-100"}`}
                            >
                              <option value="player">Player</option>
                              <option value="captain">Captain</option>
                            </select>
                            <span
                              title={p.next_match_label ? `Availability for ${p.next_match_label}` : "No upcoming match scheduled yet"}
                              className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${p.next_match_available ? "bg-green-100 text-green-700" : "bg-red-50 text-red-600"}`}
                            >
                              {p.next_match_available ? "Available" : "Not Available"}
                            </span>
                          </div>
                        </div>

                        {isCaptain && (
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-gray-500">Team Name</span>
                            {isEditing ? (
                              <input className="input-field py-1.5 text-sm flex-1 max-w-[60%]" placeholder="Team name"
                                value={editRow.team_name} onChange={e => setEditRow({ ...editRow, team_name: e.target.value })} />
                            ) : (
                              <span className="text-gray-800 font-medium">{p.team_name || "—"}</span>
                            )}
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <span className="text-gray-500">Auction Category</span>
                          <select
                            value={p.auction_category || ""}
                            onChange={e => handleAuctionCategoryChange(p, e.target.value)}
                            className="text-xs font-medium rounded px-2 py-1 border border-gray-200 bg-white text-gray-700"
                          >
                            {AUCTION_CATEGORY_OPTIONS.map(opt => (
                              <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                          </select>
                        </div>

                        {isCaptain && (
                          <div className="flex items-center justify-between">
                            <span className="text-gray-500">Status</span>
                            <select
                              value={p.tournament_status || "not_played"}
                              onChange={e => handleStatusChange(p, e.target.value)}
                              className={`text-xs font-semibold rounded px-2 py-1 border-0 ${meta.color}`}
                            >
                              {STATUS_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </div>
                        )}

                        <div>
                          <button
                            onClick={() => toggleStats(p)}
                            className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-cricket-navy"
                          >
                            <span>Bat {p.batting_average ?? "—"}/{p.strike_rate ?? "—"} · Bowl {p.bowling_average ?? "—"}/{p.economy ?? "—"}</span>
                            {statsExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          </button>
                          {statsExpanded && (
                            <div className="mt-2 pt-2 border-t">
                              {renderStatsForm(p)}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-2 pt-1">
                          <button
                            onClick={() => handleResetPassword(p)}
                            disabled={resettingPassword === p.id}
                            className="flex items-center gap-1 text-xs py-1.5 px-3 bg-amber-100 text-amber-700 rounded hover:bg-amber-200 disabled:opacity-50"
                          >
                            <KeyRound size={13} /> Reset Password
                          </button>
                          {isEditing ? (
                            <>
                              <button
                                onClick={() => handleSaveRow(p)}
                                disabled={submitting}
                                className="flex items-center gap-1 text-xs py-1.5 px-3 bg-green-100 text-green-700 rounded hover:bg-green-200"
                              >
                                <Check size={13} /> Save
                              </button>
                              <button
                                onClick={() => setEditId(null)}
                                className="flex items-center gap-1 text-xs py-1.5 px-3 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                              >
                                <X size={13} /> Cancel
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={() => startEdit(p)}
                              className="flex items-center gap-1 text-xs py-1.5 px-3 bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                            >
                              <Edit2 size={13} /> Edit
                            </button>
                          )}
                          {!isCaptain && !isEditing && (
                            <button
                              onClick={() => handleDeactivate(p)}
                              className="flex items-center gap-1 text-xs py-1.5 px-3 bg-red-100 text-red-700 rounded hover:bg-red-200"
                            >
                              <X size={13} /> Remove
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {players.length === 0 && <EmptyState message="No players yet. Add one above." />}
            {players.length > 0 && filteredPlayers.length === 0 && (
              <EmptyState message={
                search
                  ? `No players match "${search}"${categoryFilter ? " in that category" : ""}.`
                  : "No players in that category."
              } />
            )}
          </div>
        )}
      </div>

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
