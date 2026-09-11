import { useState, useEffect } from "react";
import api from "../utils/api";
import Navbar from "../components/Navbar";
import { LoadingState } from "../components/LoadingState";
import { Trophy, Users, Calendar, MapPin, AlertTriangle, RefreshCw } from "lucide-react";
import { TOURNAMENT_NAME } from "../config/appMeta";

const GROUPS = ["A", "B", "C"];

export default function Tournament() {
  const [teams, setTeams] = useState([]);
  const [fixtures, setFixtures] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [activeGroup, setActiveGroup] = useState("A");

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

  if (loading) {
    return (
      <div className="min-h-screen">
        <Navbar />
        <div className="flex items-center justify-center h-64"><LoadingState label="Loading tournament…" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-cricket-cream">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="card text-center py-12">
            <AlertTriangle className="mx-auto text-amber-500 mb-3" size={40} />
            <p className="text-gray-700 font-medium">Couldn't load tournament data</p>
            <p className="text-gray-400 text-sm mt-1 mb-4">Check your connection and try again</p>
            <button onClick={fetchData} className="btn-secondary inline-flex items-center gap-1.5">
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const groupTeams = teams.filter((t) => t.group === activeGroup);
  const groupFixtures = fixtures.filter((f) => f.group === activeGroup);

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6">
          <Trophy className="text-pitch-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{TOURNAMENT_NAME}</h1>
            <p className="text-sm text-gray-500">27 Teams · 3 Groups · 20 Overs · Hard Tennis Ball</p>
          </div>
        </div>

        {teams.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500">Tournament data hasn't been set up yet — check back soon.</p>
          </div>
        ) : (
          <>
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
                  Group {g}
                </button>
              ))}
            </div>

            <div className="card mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Users size={18} className="text-pitch-600" />
                <h2 className="font-bold text-gray-900">Group {activeGroup} Teams</h2>
                <span className="text-xs text-gray-400 ml-auto">{groupTeams.length} teams</span>
              </div>
              {groupTeams.length === 0 ? (
                <p className="text-sm text-gray-400">No teams in this group yet.</p>
              ) : (
                <ol className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
                  {groupTeams.map((t, i) => (
                    <li key={t.id} className="text-gray-700">
                      <span className="text-gray-400 w-5 inline-block">{i + 1}.</span> {t.name}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="card">
              <div className="flex items-center gap-2 mb-3">
                <Calendar size={18} className="text-pitch-600" />
                <h2 className="font-bold text-gray-900">Group {activeGroup} Fixtures</h2>
                <span className="text-xs text-gray-400 ml-auto">{groupFixtures.length} matches</span>
              </div>
              {groupFixtures.length === 0 ? (
                <p className="text-sm text-gray-400">No fixtures in this group yet.</p>
              ) : (
                <div className="space-y-2">
                  {groupFixtures.map((f) => (
                    <div key={f.id} className="border border-gray-100 rounded-xl px-4 py-3">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-xs font-semibold text-gray-400 w-16 shrink-0">Match {f.match_number}</span>
                          <span className="font-medium text-gray-900">{f.team1_name}</span>
                          <span className="text-gray-400">vs</span>
                          <span className="font-medium text-gray-900">{f.team2_name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap">
                          {f.date ? (
                            <span className="flex items-center gap-1">
                              <Calendar size={12} /> {f.date}{f.time ? ` · ${f.time}` : ""}
                            </span>
                          ) : (
                            <span className="text-amber-700 bg-amber-50 rounded-full px-2 py-0.5 font-medium">TBD</span>
                          )}
                          {f.venue && (
                            <span className="flex items-center gap-1"><MapPin size={12} /> {f.venue}</span>
                          )}
                        </div>
                      </div>
                      {f.result && <p className="text-xs text-pitch-700 font-medium mt-2">{f.result}</p>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
