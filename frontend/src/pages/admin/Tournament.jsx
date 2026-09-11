import { useState, useEffect } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import { LoadingState } from "../../components/LoadingState";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useConfirm } from "../../hooks/useConfirm";
import { Trophy, Users, Calendar, Plus, Trash2, Save } from "lucide-react";

const GROUPS = ["A", "B", "C"];
const EMPTY_FIXTURE = { team1_id: "", team2_id: "", date: "", time: "", venue: "" };

export default function AdminTournament() {
  const [teams, setTeams] = useState([]);
  const [fixtures, setFixtures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeGroup, setActiveGroup] = useState("A");
  const [newTeamName, setNewTeamName] = useState("");
  const [addingTeam, setAddingTeam] = useState(false);
  const [teamEdits, setTeamEdits] = useState({}); // id -> pending name
  const [savingTeam, setSavingTeam] = useState(null);
  const [newFixture, setNewFixture] = useState(EMPTY_FIXTURE);
  const [addingFixture, setAddingFixture] = useState(false);
  const [fixtureEdits, setFixtureEdits] = useState({}); // id -> { date, time, venue, result }
  const [savingFixture, setSavingFixture] = useState(null);
  const { confirmProps, requestConfirm } = useConfirm();

  const fetchData = () => {
    setLoading(true);
    Promise.all([api.get("/tournament/teams"), api.get("/tournament/fixtures")])
      .then(([teamsRes, fixturesRes]) => {
        setTeams(teamsRes.data.teams || []);
        setFixtures(fixturesRes.data.fixtures || []);
      })
      .catch(() => toast.error("Failed to load tournament data"))
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, []);

  const groupTeams = teams.filter((t) => t.group === activeGroup);
  const groupFixtures = fixtures.filter((f) => f.group === activeGroup);

  const handleAddTeam = async (e) => {
    e.preventDefault();
    const name = newTeamName.trim();
    if (!name) return;
    setAddingTeam(true);
    try {
      await api.post("/admin/tournament/teams", { name, group: activeGroup });
      toast.success("Team added");
      setNewTeamName("");
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add team");
    } finally {
      setAddingTeam(false);
    }
  };

  const handleSaveTeam = async (teamId) => {
    const name = teamEdits[teamId];
    if (!name?.trim()) return;
    setSavingTeam(teamId);
    try {
      await api.put(`/admin/tournament/teams/${teamId}`, { name: name.trim() });
      toast.success("Team updated");
      setTeamEdits((prev) => { const next = { ...prev }; delete next[teamId]; return next; });
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update team");
    } finally {
      setSavingTeam(null);
    }
  };

  const handleDeleteTeam = (teamId, name) => {
    requestConfirm(`Remove "${name}"? This only works if it has no fixtures.`, async () => {
      try {
        await api.delete(`/admin/tournament/teams/${teamId}`);
        toast.success("Team removed");
        fetchData();
      } catch (err) {
        toast.error(err.response?.data?.error || "Failed to remove team");
      }
    });
  };

  const handleAddFixture = async (e) => {
    e.preventDefault();
    if (!newFixture.team1_id || !newFixture.team2_id) return;
    if (newFixture.team1_id === newFixture.team2_id) {
      toast.error("Pick two different teams");
      return;
    }
    setAddingFixture(true);
    try {
      await api.post("/admin/tournament/fixtures", { group: activeGroup, ...newFixture });
      toast.success("Fixture added");
      setNewFixture(EMPTY_FIXTURE);
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to add fixture");
    } finally {
      setAddingFixture(false);
    }
  };

  const handleSaveFixture = async (fixtureId) => {
    const edit = fixtureEdits[fixtureId];
    if (!edit) return;
    setSavingFixture(fixtureId);
    try {
      await api.put(`/admin/tournament/fixtures/${fixtureId}`, edit);
      toast.success("Fixture updated");
      setFixtureEdits((prev) => { const next = { ...prev }; delete next[fixtureId]; return next; });
      fetchData();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to update fixture");
    } finally {
      setSavingFixture(null);
    }
  };

  const handleDeleteFixture = (fixtureId) => {
    requestConfirm("Remove this fixture?", async () => {
      try {
        await api.delete(`/admin/tournament/fixtures/${fixtureId}`);
        toast.success("Fixture removed");
        fetchData();
      } catch (err) {
        toast.error(err.response?.data?.error || "Failed to remove fixture");
      }
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="flex items-center justify-center h-64"><LoadingState label="Loading tournament…" /></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6">
          <Trophy className="text-pitch-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Manage Tournament</h1>
            <p className="text-sm text-gray-500">Teams, groups, and fixture schedule</p>
          </div>
        </div>

        <div className="flex gap-2 mb-6">
          {GROUPS.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setActiveGroup(g)}
              className={`flex-1 py-2.5 rounded-xl font-bold text-sm min-h-[44px] transition-colors duration-150 ${
                activeGroup === g ? "bg-pitch-600 text-white" : "bg-white text-gray-600 border border-gray-200"
              }`}
            >
              Group {g} ({teams.filter((t) => t.group === g).length})
            </button>
          ))}
        </div>

        {/* Teams */}
        <div className="card mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Users size={18} className="text-pitch-600" />
            <h2 className="font-bold text-gray-900">Group {activeGroup} Teams</h2>
          </div>
          <div className="space-y-2 mb-4">
            {groupTeams.map((t) => {
              const dirty = teamEdits[t.id] !== undefined && teamEdits[t.id] !== t.name;
              return (
                <div key={t.id} className="flex items-center gap-2">
                  <input
                    type="text"
                    className="input-field flex-1 text-sm py-2"
                    value={teamEdits[t.id] ?? t.name}
                    onChange={(e) => setTeamEdits({ ...teamEdits, [t.id]: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveTeam(t.id)}
                    disabled={!dirty || savingTeam === t.id}
                    className="text-pitch-600 hover:text-pitch-700 min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-30"
                    title="Save"
                  >
                    <Save size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTeam(t.id, t.name)}
                    className="text-red-500 hover:text-red-700 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    title="Remove"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              );
            })}
            {groupTeams.length === 0 && <p className="text-sm text-gray-400">No teams in this group yet.</p>}
          </div>
          <form onSubmit={handleAddTeam} className="flex items-center gap-2">
            <input
              type="text"
              className="input-field flex-1 text-sm py-2"
              placeholder="New team name"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              required
            />
            <button type="submit" disabled={addingTeam} className="btn-primary flex items-center gap-1.5 text-sm py-2 px-3.5">
              <Plus size={14} /> {addingTeam ? "Adding…" : "Add"}
            </button>
          </form>
        </div>

        {/* Fixtures */}
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Calendar size={18} className="text-pitch-600" />
            <h2 className="font-bold text-gray-900">Group {activeGroup} Fixtures</h2>
          </div>
          <div className="space-y-3 mb-4">
            {groupFixtures.map((f) => {
              const edit = fixtureEdits[f.id] || {};
              const dirty = fixtureEdits[f.id] !== undefined;
              return (
                <div key={f.id} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2 gap-2">
                    <span className="text-sm font-semibold text-gray-900">
                      Match {f.match_number}: {f.team1_name} vs {f.team2_name}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteFixture(f.id)}
                      className="text-red-500 hover:text-red-700 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                      title="Remove fixture"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input
                      type="date"
                      className="input-field text-xs py-1.5"
                      value={edit.date ?? f.date ?? ""}
                      onChange={(e) => setFixtureEdits({ ...fixtureEdits, [f.id]: { ...edit, date: e.target.value } })}
                    />
                    <input
                      type="time"
                      className="input-field text-xs py-1.5"
                      value={edit.time ?? f.time ?? ""}
                      onChange={(e) => setFixtureEdits({ ...fixtureEdits, [f.id]: { ...edit, time: e.target.value } })}
                    />
                    <input
                      type="text"
                      className="input-field text-xs py-1.5"
                      placeholder="Venue"
                      value={edit.venue ?? f.venue ?? ""}
                      onChange={(e) => setFixtureEdits({ ...fixtureEdits, [f.id]: { ...edit, venue: e.target.value } })}
                    />
                    <input
                      type="text"
                      className="input-field text-xs py-1.5"
                      placeholder="Result"
                      value={edit.result ?? f.result ?? ""}
                      onChange={(e) => setFixtureEdits({ ...fixtureEdits, [f.id]: { ...edit, result: e.target.value } })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSaveFixture(f.id)}
                    disabled={!dirty || savingFixture === f.id}
                    className="btn-secondary text-xs py-1.5 px-3 mt-2 disabled:opacity-40"
                  >
                    {savingFixture === f.id ? "Saving…" : "Save"}
                  </button>
                </div>
              );
            })}
            {groupFixtures.length === 0 && <p className="text-sm text-gray-400">No fixtures in this group yet.</p>}
          </div>
          <form onSubmit={handleAddFixture} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              className="input-field text-sm py-2"
              value={newFixture.team1_id}
              onChange={(e) => setNewFixture({ ...newFixture, team1_id: e.target.value })}
              required
            >
              <option value="">Team 1</option>
              {groupTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <select
              className="input-field text-sm py-2"
              value={newFixture.team2_id}
              onChange={(e) => setNewFixture({ ...newFixture, team2_id: e.target.value })}
              required
            >
              <option value="">Team 2</option>
              {groupTeams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            <input
              type="date"
              className="input-field text-sm py-2"
              value={newFixture.date}
              onChange={(e) => setNewFixture({ ...newFixture, date: e.target.value })}
            />
            <input
              type="time"
              className="input-field text-sm py-2"
              value={newFixture.time}
              onChange={(e) => setNewFixture({ ...newFixture, time: e.target.value })}
            />
            <input
              type="text"
              className="input-field text-sm py-2 sm:col-span-2"
              placeholder="Venue (optional)"
              value={newFixture.venue}
              onChange={(e) => setNewFixture({ ...newFixture, venue: e.target.value })}
            />
            <button type="submit" disabled={addingFixture} className="btn-primary sm:col-span-2 flex items-center justify-center gap-1.5 text-sm py-2">
              <Plus size={14} /> {addingFixture ? "Adding…" : "Add Fixture"}
            </button>
          </form>
        </div>
      </div>

      <ConfirmDialog {...confirmProps} />
    </div>
  );
}
