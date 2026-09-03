import { useState, useEffect } from "react";
import api from "../utils/api";
import Navbar from "../components/Navbar";
import { BarChart2, Lock, ChevronDown, ChevronUp, Users, AlertTriangle, RefreshCw, Trophy } from "lucide-react";
import { LoadingState } from "../components/LoadingState";

const AVAILABILITY_COLOR = {
  available:     "bg-green-500",
  not_available: "bg-red-500",
  maybe:         "bg-yellow-400",
  no_response:   "bg-gray-200",
};

const AVAILABILITY_LABEL = {
  available:     "Available",
  not_available: "Not Available",
  maybe:         "Maybe",
  no_response:   "No Response",
};

const AVAILABILITY_ORDER = ["available", "maybe", "not_available", "no_response"];

function AttendanceList({ attendance }) {
  const groups = AVAILABILITY_ORDER.map((status) => ({
    status,
    names: attendance.filter((a) => (a.availability || "no_response") === status).map((a) => a.name),
  })).filter((g) => g.names.length > 0);

  return (
    <div className="mt-2 space-y-2">
      {groups.map((g) => (
        <div key={g.status} className="text-xs">
          <span className="flex items-center gap-1 font-medium text-gray-600 mb-1">
            <span className={`w-2 h-2 rounded-full inline-block ${AVAILABILITY_COLOR[g.status]}`} />
            {AVAILABILITY_LABEL[g.status]} ({g.names.length})
          </span>
          <p className="text-gray-500 pl-3">{g.names.join(", ")}</p>
        </div>
      ))}
    </div>
  );
}

// Attendance leaderboard — same data admin's Attendance page shows, but a
// read-only ranked subset any authenticated account can see (including the
// viewer role, which has no admin-console access at all). Fetched once, not
// polled — attendance changes only after admin records a completed match.
function AttendanceLeaderboard() {
  const [board, setBoard] = useState(null);

  useEffect(() => {
    api.get("/attendance/leaderboard").then((res) => setBoard(res.data)).catch(() => {});
  }, []);

  if (!board || board.leaderboard.length === 0) return null;

  return (
    <div className="card mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Trophy className="text-pitch-600" size={18} />
        <h2 className="font-semibold text-gray-800">Attendance Leaderboard</h2>
        <span className="text-xs text-gray-400 ml-auto">{board.total_matches_organized} matches recorded</span>
      </div>
      <ol className="space-y-1.5 text-sm">
        {board.leaderboard.slice(0, 15).map((entry, i) => (
          <li key={entry.name} className="flex items-center justify-between">
            <span className="text-gray-700">
              <span className="text-gray-400 w-5 inline-block">{i + 1}.</span> {entry.name}
              {entry.knockout_eligible && <span className="ml-1.5 text-[10px] bg-pitch-100 text-pitch-700 rounded-full px-1.5 py-0.5">Eligible</span>}
            </span>
            <span className="font-medium text-gray-900">{entry.attendance_count}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function Results() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState({});

  const toggleExpanded = (slotId) => setExpanded((prev) => ({ ...prev, [slotId]: !prev[slotId] }));

  const fetchResults = () => {
    setLoading(true);
    api.get("/votes/summary")
      .then((res) => { setData(res.data); setError(false); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  };

  useEffect(fetchResults, []);

  if (loading) return (
    <div className="min-h-screen"><Navbar />
      <div className="flex items-center justify-center h-64"><LoadingState label="Loading results…" /></div>
    </div>
  );

  // Distinguish "the fetch failed" from "there's genuinely nothing to show
  // yet" -- same fix VotingSlots.jsx already has, applied here since both
  // used to render the identical "No results yet" empty state, which
  // misleadingly read as "voting hasn't started" even on a real network/
  // server error with a one-click fix (retry).
  if (error && !data) {
    return (
      <div className="min-h-screen bg-cricket-cream">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="card text-center py-12">
            <AlertTriangle className="mx-auto text-amber-500 mb-3" size={40} />
            <p className="text-gray-700 font-medium">Couldn't load results</p>
            <p className="text-gray-400 text-sm mt-1 mb-4">Check your connection and try again</p>
            <button onClick={fetchResults} className="btn-secondary inline-flex items-center gap-1.5">
              <RefreshCw size={14} /> Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  const summary = data?.summary || [];

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6">
          <BarChart2 className="text-pitch-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Availability Results</h1>
            <p className="text-sm text-gray-500">Each match has its own voting window</p>
          </div>
        </div>

        <AttendanceLeaderboard />

        {summary.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500">No results yet. Voting hasn't started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {summary.map((item) => {
              const { slot, counts, total_captains, total_voted, window, you_voted, attendance } = item;
              const pct = (v) => total_captains > 0 ? Math.round((v / total_captains) * 100) : 0;

              return (
                <div key={slot.id} className="card">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{slot.day}</p>
                      <p className="font-bold text-gray-900">{slot.time_of_day}</p>
                    </div>
                    <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-3 py-1 border border-gray-200">
                      {total_voted}/{total_captains} voted
                    </span>
                  </div>

                  {window && (
                    <p className={`text-xs mb-3 ${window.is_open ? "text-green-600" : "text-gray-400"}`}>
                      {window.is_open ? `🟢 Open — closes ${window.closes_at}` : window.closes_at ? `🔴 Closed — was ${window.opens_at} to ${window.closes_at}` : "No window set"}
                    </p>
                  )}

                  {/* Stacked bar */}
                  <div className="flex h-3 rounded-full overflow-hidden mb-3 bg-gray-100">
                    {counts.available > 0 && (
                      <div className="bg-green-500 transition-all" style={{ width: `${pct(counts.available)}%` }} />
                    )}
                    {counts.maybe > 0 && (
                      <div className="bg-yellow-400 transition-all" style={{ width: `${pct(counts.maybe)}%` }} />
                    )}
                    {counts.not_available > 0 && (
                      <div className="bg-red-500 transition-all" style={{ width: `${pct(counts.not_available)}%` }} />
                    )}
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />{counts.available} Available</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />{counts.maybe} Maybe</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />{counts.not_available} Not Available</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-200 inline-block" />{counts.no_response} No Response</span>
                  </div>

                  {you_voted ? (
                    attendance && (
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(slot.id)}
                          className="flex items-center gap-1 text-xs font-medium text-pitch-600 hover:text-pitch-700 active:text-pitch-800 min-h-[44px] -my-2 transition-colors duration-150"
                        >
                          <Users size={13} />
                          {expanded[slot.id] ? "Hide players" : "View players"}
                          {expanded[slot.id] ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                        </button>
                        {expanded[slot.id] && <AttendanceList attendance={attendance} />}
                      </div>
                    )
                  ) : window ? (
                    <p className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 flex items-center gap-1">
                      <Lock size={12} /> Vote for this match to see who else is available
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
