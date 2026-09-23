import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import api from "../utils/api";
import Navbar from "../components/Navbar";
import PageHeader from "../components/PageHeader";
import { LoadingState } from "../components/LoadingState";
import { AlertTriangle, RefreshCw } from "lucide-react";

const TABS = [
  { key: "attendance", label: "Attendance", to: "/stats" },
  { key: "knockout", label: "Knockout list", to: "/stats/knockout" },
];

const pct = (e) => (e.attendance_percentage != null ? `${Math.round(e.attendance_percentage)}%` : "—");

// Stats tab — the attendance leaderboard (formerly on Results), ranked by the
// same attendance % admins maintain, with your own rank pinned on top.
export default function Stats() {
  const { pathname } = useLocation();
  const active = pathname.endsWith("/knockout") ? "knockout" : "attendance";
  const [board, setBoard] = useState(null);
  const [error, setError] = useState(false);

  const load = () => {
    setError(false);
    api.get("/attendance/leaderboard").then((res) => setBoard(res.data.leaderboard || [])).catch(() => setError(true));
  };
  useEffect(load, []);

  const meIndex = board ? board.findIndex((e) => e.is_me) : -1;
  const me = meIndex >= 0 ? board[meIndex] : null;
  const eligible = board ? board.filter((e) => e.knockout_eligible) : [];
  const lastEligible = board ? board.reduce((last, e, i) => (e.knockout_eligible ? i : last), -1) : -1;

  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <PageHeader title="Stats" subtitle="Attendance counts toward the auction order and knockout places" tabs={TABS} active={active} />
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
        {error ? (
          <div className="bg-white rounded-2xl shadow-soft text-center py-10 px-4">
            <AlertTriangle className="mx-auto text-amber-500 mb-3" size={36} />
            <p className="text-gray-800 font-semibold">Couldn't load the leaderboard</p>
            <button onClick={load} className="btn-secondary inline-flex items-center gap-1.5 mt-3"><RefreshCw size={14} /> Retry</button>
          </div>
        ) : !board ? (
          <LoadingState />
        ) : active === "knockout" ? (
          <div className="bg-white rounded-2xl shadow-soft p-4">
            <h2 className="font-black text-gray-900 mb-1">Eligible for knockout matches</h2>
            {eligible.length === 0 ? (
              <p className="text-sm text-gray-500">The knockout list hasn't been published yet.</p>
            ) : (
              <ol className="divide-y divide-gray-100">
                {eligible.map((e, i) => (
                  <li key={e.name} className={`flex items-center gap-3 py-2 ${e.is_me ? "font-bold" : ""}`}>
                    <span className="w-6 text-right text-sm font-black text-gray-400 tabular-nums">{i + 1}</span>
                    <span className="flex-1">{e.name}{e.is_me ? " (you)" : ""}</span>
                    <span className="text-sm tabular-nums">{pct(e)}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <>
            {me && (
              <div className="rounded-2xl p-4 bg-brand-navy text-white shadow-soft">
                <p className="text-xs text-white/60">Your rank</p>
                <div className="flex items-end justify-between gap-2">
                  <span className="text-3xl font-black tabular-nums">#{meIndex + 1} <span className="text-base font-bold text-white/60">of {board.length}</span></span>
                  {me.knockout_eligible && <span className="text-[11px] font-bold bg-pitch-100 text-pitch-800 rounded-full px-2.5 py-1">Knockout eligible</span>}
                </div>
                <div className="h-2 rounded-full bg-white/15 mt-2 overflow-hidden">
                  <div className="h-full bg-brand-gold rounded-full" style={{ width: `${Math.min(100, me.attendance_percentage || 0)}%` }} />
                </div>
                <p className="text-xs text-white/60 mt-1.5">{me.matches_present} of {me.total_matches} matches · {pct(me)}</p>
              </div>
            )}
            <div className="bg-white rounded-2xl shadow-soft px-4 py-2">
              <div className="flex text-[11px] font-bold uppercase tracking-wider text-gray-400 py-2 border-b border-gray-100">
                <span className="w-8">#</span><span className="flex-1">Player</span><span className="w-16 text-right">Played</span><span className="w-14 text-right">%</span>
              </div>
              <ol>
                {board.map((e, i) => (
                  <li key={e.name}
                    className={`flex items-center py-2 text-sm border-b border-gray-50 ${e.is_me ? "bg-amber-50 -mx-4 px-4 font-bold" : ""} ${i === lastEligible ? "border-b-2 border-b-brand-gold" : ""}`}>
                    <span className="w-8 font-black text-gray-400 tabular-nums">{i + 1}</span>
                    <span className="flex-1 min-w-0 truncate">
                      {e.name}{e.is_me ? " (you)" : ""}
                      {e.knockout_eligible && <span className="ml-1.5 text-[10px] font-bold bg-pitch-100 text-pitch-700 rounded-full px-1.5 py-0.5">Eligible</span>}
                    </span>
                    <span className="w-16 text-right text-gray-500 tabular-nums">{e.matches_present}/{e.total_matches}</span>
                    <span className="w-14 text-right font-bold tabular-nums">{pct(e)}</span>
                  </li>
                ))}
              </ol>
              {lastEligible >= 0 && <p className="text-[11px] text-gray-500 py-2">Gold line = knockout cut-off</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
