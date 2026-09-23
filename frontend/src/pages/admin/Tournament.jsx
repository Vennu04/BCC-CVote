import { useState, useEffect } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import ManageHeader from "../../components/ManageHeader";
import { LoadingState } from "../../components/LoadingState";
import ConfirmDialog from "../../components/ConfirmDialog";
import { useConfirm } from "../../hooks/useConfirm";
import { Link } from "react-router-dom";
import { STATUS_STYLES } from "../../utils/windowStatus";
import { Trophy, Users, Calendar, Plus, Trash2, Save, Clock, Vote, Gavel } from "lucide-react";

const GROUPS = ["A", "B", "C"];
const EMPTY_FIXTURE = { team1_id: "", team2_id: "", date: "", time: "", venue: "", voting_opens_at: "" };

// One-line "what happens next" for a fixture, from the backend's window +
// auction state (tournament.py _schedule_info_by_fixture). Reuses the Window
// Dashboard's chip styles so a match reads the same on both pages.
function fixtureStage(f) {
  if (!f.match_slot_id || !f.window_status) return { label: "NOT SCHEDULED", className: "bg-gray-100 text-gray-500", detail: "Add a date and time to schedule it" };
  if (f.auction_status === "active") return { label: "AUCTION LIVE", className: "bg-amber-100 text-amber-700" };
  if (f.auction_status === "pending") return { label: "AUCTION READY", className: "bg-amber-100 text-amber-700", detail: "Created — waiting for you to start it" };
  const style = STATUS_STYLES[f.window_status] || STATUS_STYLES.closed;
  const detail = {
    scheduled: `Voting opens ${f.voting_opens_display}`,
    open: `Voting closes ${f.voting_closes_display}`,
    closed: "Voting ended — ready to set up the auction",
  }[f.window_status];
  return { label: style.label, className: style.className, detail };
}

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
      const res = await api.post("/admin/tournament/fixtures", { group: activeGroup, ...newFixture });
      // A fixture saved with a date gets a voting window right away (open now,
      // or at the picked "voting opens" time) and becomes votable/auctionable —
      // see backend/app/routes/tournament.py _sync_match_slot_and_window. One
      // without a date yet is just listed; voting is set up once a date is added.
      const created = res.data?.fixture;
      toast.success(
        !created?.match_slot_id ? "Fixture added"
          : created.window_status === "scheduled" ? `Fixture scheduled — voting opens ${created.voting_opens_display}`
          : "Fixture added — voting window is open! 🗳️"
      );
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
    const hadNoSlotYet = !fixtures.find((f) => f.id === fixtureId)?.match_slot_id;
    setSavingFixture(fixtureId);
    try {
      const res = await api.put(`/admin/tournament/fixtures/${fixtureId}`, edit);
      // Only call out the voting window the first time a date lands on this
      // fixture, or when the schedule itself moved — a routine edit (just the
      // venue or result) is not a "voting just started" event.
      const scheduleChanged = ["date", "time", "voting_opens_at"].some((k) => k in edit);
      toast.success(
        hadNoSlotYet && res.data?.match_slot_id ? "Fixture scheduled — voting window is set up 🗳️"
          : scheduleChanged && res.data?.match_slot_id ? "Fixture rescheduled — voting window updated"
          : "Fixture updated"
      );
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
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <ManageHeader hub="matches" sub="fixtures" subtitle="Teams, groups and the fixture schedule — saving a date creates the match and opens voting" />
      <div className="max-w-4xl mx-auto px-4 py-4">

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
              const stage = fixtureStage(f);
              // Once an auction exists its voter pool is locked to this window,
              // so the backend refuses date/time changes — say so up front.
              const scheduleLocked = !!f.auction_id;
              return (
                <div key={f.id} className="border border-gray-100 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1 gap-2">
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
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className={`text-[11px] font-semibold rounded-full px-2.5 py-0.5 ${stage.className}`}>{stage.label}</span>
                    {stage.detail && <span className="text-xs text-gray-500">{stage.detail}</span>}
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <input
                      type="date"
                      className="input-field text-xs py-1.5"
                      title="Match date"
                      disabled={scheduleLocked}
                      value={edit.date ?? f.date ?? ""}
                      onChange={(e) => setFixtureEdits({ ...fixtureEdits, [f.id]: { ...edit, date: e.target.value } })}
                    />
                    <input
                      type="time"
                      className="input-field text-xs py-1.5"
                      title="Kickoff time"
                      disabled={scheduleLocked}
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
                  <label className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                    <Clock size={13} className="shrink-0" />
                    <span className="shrink-0">Voting opens</span>
                    <input
                      type="datetime-local"
                      className="input-field text-xs py-1.5 flex-1 min-w-0"
                      disabled={scheduleLocked || !(edit.date ?? f.date)}
                      value={edit.voting_opens_at ?? f.voting_opens_at ?? ""}
                      onChange={(e) => setFixtureEdits({ ...fixtureEdits, [f.id]: { ...edit, voting_opens_at: e.target.value } })}
                    />
                  </label>
                  <p className="text-[11px] text-gray-400 mt-1">
                    {scheduleLocked
                      ? "An auction already exists for this match, so its date and time are locked."
                      : "Voting closes at kickoff. Leave “Voting opens” blank to open right away."}
                  </p>
                  <div className="flex items-center gap-2 flex-wrap mt-2">
                    <button
                      type="button"
                      onClick={() => handleSaveFixture(f.id)}
                      disabled={!dirty || savingFixture === f.id}
                      className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40"
                    >
                      {savingFixture === f.id ? "Saving…" : "Save"}
                    </button>
                    {f.match_slot_id && f.window_status && f.window_status !== "cancelled" && (
                      <>
                        <Link to="/manage/matches/windows" className="text-xs font-semibold text-pitch-600 hover:text-pitch-700 flex items-center gap-1 min-h-[32px]">
                          <Vote size={13} /> Voting window
                        </Link>
                        {f.auction_id ? (
                          <Link to={`/auction/${f.auction_id}`} className="text-xs font-semibold text-pitch-600 hover:text-pitch-700 flex items-center gap-1 min-h-[32px]">
                            <Gavel size={13} /> Open auction
                          </Link>
                        ) : f.window_status === "closed" ? (
                          <Link to="/manage/auction/run" className="text-xs font-semibold text-pitch-600 hover:text-pitch-700 flex items-center gap-1 min-h-[32px]">
                            <Gavel size={13} /> Set up auction
                          </Link>
                        ) : null}
                      </>
                    )}
                  </div>
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
            <label className="flex items-center gap-2 text-xs text-gray-500 sm:col-span-2">
              <Clock size={13} className="shrink-0" />
              <span className="shrink-0">Voting opens</span>
              <input
                type="datetime-local"
                className="input-field text-sm py-2 flex-1 min-w-0"
                disabled={!newFixture.date}
                value={newFixture.voting_opens_at}
                onChange={(e) => setNewFixture({ ...newFixture, voting_opens_at: e.target.value })}
              />
            </label>
            <p className="text-[11px] text-gray-400 sm:col-span-2 -mt-1">
              Pick a match date and time to schedule it. Voting closes at kickoff; leave “Voting opens” blank to open right away.
            </p>
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
