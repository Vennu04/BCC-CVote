import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../utils/api";
import Navbar from "../components/Navbar";
import PageHeader from "../components/PageHeader";
import { LoadingState } from "../components/LoadingState";
import { useAuth } from "../context/AuthContext";
import { isStaff } from "../utils/roles";
import { Check, Copy, Plus, Trash2 } from "lucide-react";

// Match dates — captains (or an admin) suggest up to 3 dates for a fixture;
// both captains tick the ones they can make; when both tick the same one the
// match is scheduled automatically and voting opens. See routes/scheduling.py.

const EMPTY_OPTION = { date: "", time: "06:15", end_time: "10:00" };

function whatsappText(p) {
  return [
    `📅 ${p.label} — pick a match date`,
    ...p.options.map((o, i) => `${i + 1}) ${o.text}`),
    "",
    "Captains: open the BCC app → Match dates and tick the ones you can play.",
  ].join("\n");
}

function RequestCard({ p, admin, onChanged }) {
  const [ticks, setTicks] = useState(p.my_ticks || []);
  const [busy, setBusy] = useState(false);
  const toggle = (i) => setTicks((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i].sort()));

  const run = async (fn) => {
    setBusy(true);
    try {
      const res = await fn();
      toast.success(res.data?.message || "Saved");
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't save");
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(whatsappText(p)); toast.success("Copied — paste it in WhatsApp"); }
    catch { toast.error("Couldn't copy"); }
  };

  return (
    <div className="bg-white rounded-2xl shadow-soft p-4">
      <p className="text-xs font-bold text-gray-500">Group {p.group} · Match {p.match_number} · suggested by {p.proposed_by}</p>
      <h3 className="text-lg font-black text-gray-900">{p.label}</h3>
      <ul className="mt-2 space-y-2">
        {p.options.map((o, i) => {
          const on = ticks.includes(i);
          const who = p.captains.filter((c) => (c.ticked || []).includes(i)).map((c) => c.name);
          return (
            <li key={i} className="flex items-center gap-2">
              {p.my_turn ? (
                <button type="button" onClick={() => toggle(i)} aria-pressed={on}
                  className={`flex-1 flex items-center gap-2 text-left rounded-2xl border-2 px-3 min-h-[52px] font-bold ${on ? "border-pitch-600 bg-pitch-50" : "border-gray-200"}`}>
                  <span className={`w-6 h-6 rounded-md grid place-items-center ${on ? "bg-pitch-600 text-white" : "bg-gray-100"}`}>{on && <Check size={16} strokeWidth={3} />}</span>
                  <span className="flex-1">{o.text}</span>
                </button>
              ) : (
                <span className="flex-1 rounded-2xl bg-gray-50 px-3 py-2.5 font-bold text-gray-900">{o.text}</span>
              )}
              {admin && (
                <button type="button" disabled={busy} onClick={() => run(() => api.post(`/schedule/proposals/${p.id}/pick`, { option: i }))}
                  className="text-xs font-bold min-h-[44px] px-2 rounded-xl bg-brand-navy text-white disabled:opacity-50">Fix this</button>
              )}
              <span className="sr-only">{who.length ? `Ticked by ${who.join(", ")}` : "Nobody yet"}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-gray-600 mt-2">
        {p.captains.map((c) => `${c.name}: ${!c.answered ? "hasn't answered" : c.ticked?.length ? `can do ${c.ticked.map((i) => i + 1).join(", ")}` : "can't do any"}`).join(" · ")}
      </p>
      {p.my_turn && (
        <button type="button" disabled={busy} onClick={() => run(() => api.put(`/schedule/proposals/${p.id}/response`, { options: ticks }))}
          className="btn-primary w-full mt-3 min-h-[48px] disabled:opacity-50">
          {ticks.length ? `Save — I can play ${ticks.length === 1 ? "this date" : "these dates"}` : "Save — none of these work"}
        </button>
      )}
      <div className="flex gap-2 mt-2">
        <button type="button" onClick={copy} className="btn-secondary flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 text-sm"><Copy size={15} /> Copy for WhatsApp</button>
        {(admin || p.proposed_by_me) && (
          <button type="button" disabled={busy} onClick={() => run(() => api.delete(`/schedule/proposals/${p.id}`))}
            className="min-h-[44px] px-3 rounded-xl bg-red-50 text-red-700 font-bold text-sm disabled:opacity-50">Cancel</button>
        )}
      </div>
    </div>
  );
}

function SuggestForm({ fixtures, onSent }) {
  const [fixtureId, setFixtureId] = useState("");
  const [options, setOptions] = useState([{ ...EMPTY_OPTION }]);
  const [busy, setBusy] = useState(false);
  const chosen = fixtures.find((f) => f.id === fixtureId);
  const set = (i, k, v) => setOptions((os) => os.map((o, j) => (j === i ? { ...o, [k]: v } : o)));

  const send = async () => {
    setBusy(true);
    try {
      await api.post("/schedule/proposals", { fixture_id: fixtureId, options: options.filter((o) => o.date) });
      toast.success("Sent — the captains can now tick the dates they can play");
      setFixtureId(""); setOptions([{ ...EMPTY_OPTION }]);
      onSent();
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't send");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-soft p-4">
      <h2 className="font-black text-gray-900 mb-2">Suggest dates for a match</h2>
      <select className="input-field" value={fixtureId} onChange={(e) => setFixtureId(e.target.value)} aria-label="Match">
        <option value="">Choose a match…</option>
        {fixtures.map((f) => (
          <option key={f.id} value={f.id}>Group {f.group} · {f.label}{f.date ? ` (now ${f.date})` : ""}{f.open_proposal_id ? " — request open" : ""}</option>
        ))}
      </select>
      {chosen && !chosen.captains_ready && (
        <p className="text-sm text-amber-800 bg-amber-50 rounded-xl p-2 mt-2">Both teams need a captain first — an admin picks them on the Tournament page.</p>
      )}
      {chosen?.open_proposal_id && <p className="text-sm text-gray-600 mt-2">Sending new dates replaces the open request for this match.</p>}
      {chosen && chosen.captains_ready && (
        <>
          {options.map((o, i) => (
            <div key={i} className="grid grid-cols-[1fr_auto_auto_auto] gap-2 mt-3 items-end">
              <label className="text-xs font-bold text-gray-600">Option {i + 1}
                <input type="date" className="input-field mt-1" value={o.date} onChange={(e) => set(i, "date", e.target.value)} />
              </label>
              <label className="text-xs font-bold text-gray-600">Start
                <input type="time" className="input-field mt-1" value={o.time} onChange={(e) => set(i, "time", e.target.value)} />
              </label>
              <label className="text-xs font-bold text-gray-600">End
                <input type="time" className="input-field mt-1" value={o.end_time} onChange={(e) => set(i, "end_time", e.target.value)} />
              </label>
              <button type="button" aria-label="Remove option" disabled={options.length === 1}
                onClick={() => setOptions((os) => os.filter((_, j) => j !== i))} className="min-h-[44px] px-2 text-red-600 disabled:opacity-30"><Trash2 size={16} /></button>
            </div>
          ))}
          {options.length < 3 && (
            <button type="button" onClick={() => setOptions((os) => [...os, { ...EMPTY_OPTION }])}
              className="mt-3 inline-flex items-center gap-1 text-sm font-bold text-pitch-700 min-h-[44px]"><Plus size={16} /> Add another date</button>
          )}
          <button type="button" onClick={send} disabled={busy || !options.some((o) => o.date)}
            className="btn-primary w-full mt-3 min-h-[48px] disabled:opacity-50">{busy ? "Sending…" : "Send to both captains"}</button>
        </>
      )}
    </div>
  );
}

export default function Schedule() {
  const { user } = useAuth();
  const admin = isStaff(user);
  const [proposals, setProposals] = useState(null);
  const [fixtures, setFixtures] = useState([]);
  const load = useCallback(() => {
    api.get("/schedule/proposals").then((r) => setProposals(r.data.proposals || [])).catch(() => setProposals([]));
    api.get("/schedule/fixtures").then((r) => setFixtures(r.data.fixtures || [])).catch(() => setFixtures([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <PageHeader title="Match dates" subtitle="Both captains tick the dates they can play — when they agree, the match is set and voting opens" />
      <div className="max-w-xl mx-auto px-4 py-4 space-y-3">
        {proposals === null ? <LoadingState /> : (
          <>
            {proposals.map((p) => <RequestCard key={p.id} p={p} admin={admin} onChanged={load} />)}
            {proposals.length === 0 && <p className="text-center text-gray-500 py-2">No open date requests.</p>}
          </>
        )}
        {fixtures.length > 0 && <SuggestForm fixtures={fixtures} onSent={load} />}
        {fixtures.length === 0 && !admin && proposals?.length === 0 && (
          <p className="text-center text-sm text-gray-500">Only captains of a team (picked by an admin) can suggest match dates.</p>
        )}
      </div>
    </div>
  );
}
