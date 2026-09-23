import { useState, useEffect } from "react";
import api from "../utils/api";
import { LoadingState } from "../components/LoadingState";
import TeamCrest, { TeamsVs } from "../components/TeamCrest";
import { formatDateDisplay } from "../utils/formatDate";
import { MapPin, AlertTriangle, RefreshCw } from "lucide-react";
import { todayIst } from "../utils/duty";

const GROUPS = ["A", "B", "C"];

// Matches › Fixtures and Matches › Groups — the public tournament view
// (formerly the standalone Tournament page), rendered inside Matches.jsx.
export function TournamentView({ view }) {
  const [teams, setTeams] = useState([]);
  const [fixtures, setFixtures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [group, setGroup] = useState("all");

  const fetchData = () => {
    setLoading(true);
    Promise.all([api.get("/tournament/teams"), api.get("/tournament/fixtures")])
      .then(([teamsRes, fixturesRes]) => {
        setTeams(teamsRes.data.teams || []);
        setFixtures(fixturesRes.data.fixtures || []);
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(fetchData, []);

  if (loading) return <div className="flex items-center justify-center h-48"><LoadingState label="Loading tournament…" /></div>;

  if (error) {
    return (
      <div className="bg-white rounded-2xl shadow-soft text-center py-10 px-4">
        <AlertTriangle className="mx-auto text-amber-500 mb-3" size={36} />
        <p className="text-gray-800 font-semibold">Couldn't load tournament data</p>
        <p className="text-gray-500 text-sm mt-1 mb-4">Check your connection and try again</p>
        <button onClick={fetchData} className="btn-secondary inline-flex items-center gap-1.5"><RefreshCw size={14} /> Retry</button>
      </div>
    );
  }

  if (teams.length === 0) {
    return <div className="bg-white rounded-2xl shadow-soft text-center py-10 px-4 text-gray-500">Tournament data hasn't been set up yet — check back soon.</div>;
  }

  const chips = (
    <div className="flex gap-2 mb-4 overflow-x-auto scroll-touch -mx-1 px-1">
      {(view === "groups" ? GROUPS : ["all", ...GROUPS]).map((g) => {
        const on = view === "groups" ? g === (group === "all" ? "A" : group) : g === group;
        return (
          <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={on}
            className={`shrink-0 px-4 min-h-[40px] rounded-full text-sm font-bold transition-colors duration-150 ${
              on ? "bg-brand-navy text-white" : "bg-white text-gray-600 shadow-soft"}`}>
            {g === "all" ? "All groups" : `Group ${g}`}
          </button>
        );
      })}
    </div>
  );

  if (view === "groups") {
    const g = group === "all" ? "A" : group;
    const groupTeams = teams.filter((t) => t.group === g);
    const played = fixtures.filter((f) => f.group === g && f.result).length;
    const total = fixtures.filter((f) => f.group === g).length;
    return (
      <>
        {chips}
        <div className="bg-white rounded-2xl shadow-soft p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-black text-gray-900">Group {g}</h2>
            <span className="text-xs text-gray-500">{groupTeams.length} teams · {played}/{total} matches played</span>
          </div>
          {groupTeams.length === 0 ? (
            <p className="text-sm text-gray-500">No teams in this group yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {groupTeams.map((t) => (
                <li key={t.id} className="flex items-center gap-3 py-2.5">
                  <TeamCrest name={t.name} size={30} />
                  <span className="font-semibold text-gray-900">{t.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  const today = todayIst();
  const shown = fixtures.filter((f) => group === "all" || f.group === group);
  const upcoming = shown.filter((f) => f.date && !f.result && f.date >= today).sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));
  const results = shown.filter((f) => f.result || (f.date && f.date < today)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const tbd = shown.filter((f) => !f.date && !f.result);

  return (
    <>
      {chips}
      <FixtureSection title="Upcoming" items={upcoming} empty="No upcoming matches scheduled." />
      <FixtureSection title="Results" items={results} />
      <FixtureSection title="Not scheduled yet" items={tbd} />
    </>
  );
}

function FixtureSection({ title, items, empty }) {
  if (items.length === 0 && !empty) return null;
  return (
    <section className="mb-5">
      <h2 className="text-xs font-black uppercase tracking-wider text-gray-500 mb-2">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 bg-white rounded-2xl shadow-soft px-4 py-3">{empty}</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((f) => <FixtureCard key={f.id} f={f} />)}
        </div>
      )}
    </section>
  );
}

function FixtureCard({ f }) {
  const chip = f.result
    ? { label: "Result", cls: "bg-amber-50 text-amber-800" }
    : f.date
      ? { label: f.date < todayIst() ? "Played" : "Scheduled", cls: "bg-gray-100 text-gray-600" }
      : { label: "TBD", cls: "bg-amber-50 text-amber-800" };
  return (
    <div className="bg-white rounded-2xl shadow-soft p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-gray-500">
          Group {f.group} · Match {f.match_number}
          {f.date ? ` · ${formatDateDisplay(f.date)}${f.time ? ` · ${f.time}` : ""}` : ""}
        </span>
        <span className={`text-[11px] font-bold rounded-full px-2.5 py-0.5 ${chip.cls}`}>{chip.label}</span>
      </div>
      <TeamsVs a={f.team1_name} b={f.team2_name} />
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
        {f.venue && <span className="flex items-center gap-1"><MapPin size={12} /> {f.venue}</span>}
        {f.result && <span className="text-pitch-700 font-semibold">{f.result}</span>}
      </div>
    </div>
  );
}
