import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../../utils/api";
import Navbar from "../../components/Navbar";
import ManageHeader from "../../components/ManageHeader";
import { LoadingState } from "../../components/LoadingState";
import { shortDay } from "../../utils/duty";
import { computeSteps, defaultMatch, getSitOuts, wasShared } from "../../utils/week";
import { Check, ChevronRight, Lock, Plus, RefreshCw, Wrench } from "lucide-react";

const POLL_MS = 15000;
const extrasFor = (slotId) => ({ sitOuts: getSitOuts(slotId), shared: wasShared(slotId) });

// Manage › This week — the Control Centre as a checklist. Each match walks
// the same 8 steps; the next one lights up, finished ones turn green, and a
// step that can't be done yet says why. Every step opens a guided screen
// (GuidedSteps.jsx); every other admin page lives under All tools.
export default function ThisWeek() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/admin/overview");
      setOverview(res.data);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, POLL_MS); return () => clearInterval(t); }, [load]);

  const matches = overview?.matches || [];
  const selected = useMemo(() => {
    const wanted = params.get("slot");
    return matches.find((m) => m.slot_id === wanted) || defaultMatch(matches, extrasFor);
  }, [matches, params]);
  const steps = selected ? computeSteps(selected, extrasFor(selected.slot_id)) : [];
  const doneCount = steps.filter((s) => s.done).length;

  const openStep = (step) => {
    if (step.state === "locked") return toast(step.lock, { icon: "🔒" });
    navigate(`/manage/step/${step.key}?slot=${selected.slot_id}`);
  };

  const actions = (
    <>
      <button onClick={load} className="flex items-center gap-1.5 text-sm px-3 min-h-[44px] rounded-xl bg-white/10 hover:bg-white/15" aria-label="Refresh">
        <RefreshCw size={16} />
      </button>
      <Link to="/manage/step/setup" className="flex items-center gap-1.5 text-sm font-bold px-4 min-h-[44px] rounded-xl bg-brand-gold text-brand-navy">
        <Plus size={16} /> New match
      </Link>
    </>
  );

  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <ManageHeader hub="control" actions={actions}
        subtitle={selected ? `${selected.label} · ${shortDay(selected.match_date)}${selected.kickoff ? ` · ${selected.kickoff}` : ""}` : "Your jobs for this week's matches"} />

      <div className="max-w-2xl mx-auto px-4 py-4 space-y-3">
        {error && !overview ? (
          <div className="bg-white rounded-2xl shadow-soft p-6 text-center">
            <p className="font-bold text-gray-900">Couldn't load this week</p>
            <button onClick={load} className="btn-secondary mt-3">Try again</button>
          </div>
        ) : !overview ? (
          <LoadingState />
        ) : matches.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-soft p-6 text-center">
            <div className="text-5xl mb-2">🏏</div>
            <p className="text-lg font-black text-gray-900">No matches coming up</p>
            <p className="text-sm text-gray-600 mt-1">Start by giving a fixture a date and time.</p>
            <Link to="/manage/step/setup" className="btn-primary inline-flex items-center gap-2 mt-4"><Plus size={18} /> Set up a match</Link>
          </div>
        ) : (
          <>
            {matches.length > 1 && (
              <div className="flex gap-2 overflow-x-auto scroll-touch -mx-1 px-1 pb-1" role="group" aria-label="Choose a match">
                {matches.map((m) => {
                  const on = m.slot_id === selected?.slot_id;
                  const left = computeSteps(m, extrasFor(m.slot_id)).filter((s) => !s.done).length;
                  return (
                    <button key={m.slot_id} type="button" aria-pressed={on} onClick={() => setParams({ slot: m.slot_id })}
                      className={`shrink-0 rounded-2xl px-4 min-h-[48px] text-left text-sm font-bold shadow-soft ${on ? "bg-brand-navy text-white" : "bg-white text-gray-700"}`}>
                      <span className="block leading-tight">{m.label}</span>
                      <span className={`block text-xs font-semibold ${on ? "text-white/60" : "text-gray-500"}`}>
                        {shortDay(m.match_date)} · {left ? `${left} to do` : "all done ✓"}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="bg-white rounded-2xl shadow-soft px-4 py-3">
              <div className="flex items-center justify-between text-sm font-bold text-gray-700">
                <span>{doneCount} of 8 done</span>
                {doneCount === 8 && <span className="text-pitch-700">All done for this match 🎉</span>}
              </div>
              <div className="flex gap-1 mt-2" aria-hidden="true">
                {steps.map((s) => (
                  <span key={s.key} className={`flex-1 h-2 rounded-full ${s.state === "done" ? "bg-pitch-600" : s.state === "now" ? "bg-brand-gold" : "bg-gray-200"}`} />
                ))}
              </div>
            </div>

            <ol className="space-y-2.5">
              {steps.map((s) => (
                <li key={s.key}>
                  <button type="button" onClick={() => openStep(s)} aria-disabled={s.state === "locked"}
                    className={`w-full flex items-center gap-3 text-left bg-white rounded-2xl shadow-soft px-4 min-h-[68px] py-3 transition-transform duration-150 active:scale-[0.99] ${
                      s.state === "now" ? "ring-[3px] ring-brand-gold" : ""} ${s.state === "locked" ? "opacity-60" : ""}`}>
                    <span className={`w-10 h-10 shrink-0 rounded-full grid place-items-center text-base font-black ${
                      s.state === "done" ? "bg-pitch-600 text-white" : s.state === "now" ? "bg-brand-gold text-brand-navy" : "bg-gray-100 text-gray-500"}`}>
                      {s.state === "done" ? <Check size={20} strokeWidth={3} /> : s.state === "locked" ? <Lock size={16} /> : s.n}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block font-black text-gray-900 text-base leading-tight">{s.title}</span>
                      <span className="block text-sm text-gray-600">{s.state === "locked" ? s.lock : s.detail}</span>
                    </span>
                    {s.state === "now" && <span className="text-xs font-black bg-brand-gold text-brand-navy rounded-full px-2.5 py-1">Next</span>}
                    <ChevronRight size={20} className="text-gray-400 shrink-0" />
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}

        <Link to="/manage/tools" className="flex items-center gap-3 bg-white rounded-2xl shadow-soft px-4 min-h-[64px]">
          <span className="w-10 h-10 rounded-full bg-brand-navy text-white grid place-items-center"><Wrench size={18} /></span>
          <span className="flex-1">
            <span className="block font-black text-gray-900">All tools</span>
            <span className="block text-sm text-gray-600">Fixtures, people, practice, votes table, exports and more</span>
          </span>
          <ChevronRight size={20} className="text-gray-400" />
        </Link>
      </div>
    </div>
  );
}
