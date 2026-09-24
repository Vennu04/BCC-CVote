import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../../utils/api";
import Navbar from "../../components/Navbar";
import { LoadingState } from "../../components/LoadingState";
import { TeamsVs } from "../../components/TeamCrest";
import { EveningCard } from "./AuctionDuty";
import { shortDay } from "../../utils/duty";
import { formatDateDisplay } from "../../utils/formatDate";
import { buildWhatsAppSummary, ACTIVE_AUCTION_KEY } from "../../utils/auctionShare";
import {
  STEP_KEYS, STEP_TITLES, computeSteps, groupName, getSitOuts, setSitOut, clearSitOut, wasShared, markShared,
} from "../../utils/week";
import { Check, ChevronLeft, X, Copy, Calendar, Clock, MapPin, Users } from "lucide-react";

// One guided screen per "This week" step: a single big question, plain
// numbers, one green button, and a safe way back. Everything here calls the
// same endpoints the full admin pages use — nothing new on the server.

const CATS = ["extra_power_allrounder", "extra_power_batsman", "power", "classic"];

// ---------- shared pieces ----------
function Shell({ stepKey, match, children }) {
  const n = STEP_KEYS.indexOf(stepKey) + 1;
  const steps = match ? computeSteps(match, { sitOuts: getSitOuts(match.slot_id), shared: wasShared(match.slot_id) }) : [];
  const back = match ? `/manage?slot=${match.slot_id}` : "/manage";
  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <div className="bg-brand-navy text-white">
        <div className="max-w-xl mx-auto px-4 pt-3 pb-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-white/70">Step {n} of 8{match ? ` · ${match.label}` : ""}</span>
            <Link to={back} className="flex items-center gap-1 text-sm font-bold text-white/80 min-h-[44px] px-2 -mr-2"><X size={18} /> Close</Link>
          </div>
          <h1 className="text-2xl font-black">{STEP_TITLES[stepKey]}</h1>
          {steps.length > 0 && (
            <div className="flex gap-1 mt-3" aria-hidden="true">
              {steps.map((s) => (
                <span key={s.key} className={`flex-1 h-1.5 rounded-full ${s.done ? "bg-pitch-400" : s.key === stepKey ? "bg-brand-gold" : "bg-white/20"}`} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="max-w-xl mx-auto px-4 py-5">{children}</div>
    </div>
  );
}

const Question = ({ children, hint }) => (
  <>
    <h2 className="text-2xl font-black text-gray-900 leading-tight text-balance">{children}</h2>
    {hint && <p className="text-gray-600 mt-1.5 mb-4">{hint}</p>}
    {!hint && <div className="h-4" />}
  </>
);

function Pick({ selected, onClick, children, note }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={!!selected}
      className={`w-full flex items-center gap-3 text-left rounded-2xl border-2 px-4 min-h-[56px] py-2.5 mb-2 font-bold text-gray-900 transition-colors duration-150 ${
        selected ? "border-pitch-600 bg-pitch-50" : "border-gray-200 bg-white hover:border-gray-300"}`}>
      <span className="flex-1">{children}{note && <span className="block text-sm font-semibold text-gray-500">{note}</span>}</span>
      {selected && <Check size={20} className="text-pitch-700" strokeWidth={3} />}
    </button>
  );
}

function Big({ kind = "green", children, ...rest }) {
  const cls = {
    green: "bg-pitch-700 text-white border-pitch-700",
    white: "bg-white text-brand-navy border-gray-300",
    red: "bg-white text-red-700 border-red-200",
  }[kind];
  return (
    <button type="button" {...rest}
      className={`w-full min-h-[56px] rounded-2xl border-2 font-black text-lg mt-3 flex items-center justify-center gap-2 px-4 transition-transform duration-150 active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100 ${cls}`}>
      {children}
    </button>
  );
}

function BigLink({ to, kind = "green", children }) {
  const cls = kind === "green" ? "bg-pitch-700 text-white border-pitch-700" : "bg-white text-brand-navy border-gray-300";
  return (
    <Link to={to} className={`w-full min-h-[56px] rounded-2xl border-2 font-black text-lg mt-3 flex items-center justify-center gap-2 px-4 ${cls}`}>
      {children}
    </Link>
  );
}

const Card = ({ children, className = "" }) => <div className={`bg-white rounded-2xl shadow-soft p-4 mb-3 ${className}`}>{children}</div>;

function Count3({ a, b, c }) {
  return (
    <div className="grid grid-cols-3 gap-2 mb-3">
      {[[a, "✅ Playing"], [b, "❌ Not"], [c, "❔ No answer"]].map(([v, l]) => (
        <div key={l} className="bg-white rounded-2xl shadow-soft py-3 text-center">
          <span className="block text-3xl font-black text-brand-navy tabular-nums">{v ?? "—"}</span>
          <span className="block text-xs font-bold text-gray-600">{l}</span>
        </div>
      ))}
    </div>
  );
}

const nextDate = (weekday) => {
  // weekday: 6 = Saturday, 0 = Sunday — the next one from today, in India time.
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const d = new Date(today);
  d.setDate(today.getDate() + (((weekday - today.getDay()) + 7) % 7 || 7));
  return d.toLocaleDateString("en-CA");
};
const time12 = (hhmm) => {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};

// ---------- step 1: set up a match ----------
function SetupStep() {
  const navigate = useNavigate();
  const [fixtures, setFixtures] = useState(null);
  const [group, setGroup] = useState("A");
  const [page, setPage] = useState(0);
  const [f, setF] = useState(null);
  const [form, setForm] = useState({ date: "", time: "06:15", venue: "", opens: "now", opensAt: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get("/tournament/fixtures").then((r) => setFixtures(r.data.fixtures || [])).catch(() => setFixtures([]));
  }, []);

  const choose = (fx) => {
    setF(fx);
    setForm({ date: fx.date || "", time: fx.time || "06:15", venue: fx.venue || "", opens: "now", opensAt: "" });
    setPage(1);
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = { date: form.date, time: form.time, venue: form.venue };
      if (form.opens === "later" && form.opensAt) body.voting_opens_at = form.opensAt;
      const res = await api.put(`/admin/tournament/fixtures/${f.id}`, body);
      toast.success(form.opens === "later" ? "Match saved — voting opens at the time you picked" : "Match saved — voting is open");
      const slot = res.data?.match_slot_id || res.data?.fixture?.match_slot_id;
      navigate(slot ? `/manage?slot=${slot}` : "/manage");
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't save the match");
    } finally {
      setSaving(false);
    }
  };

  if (!fixtures) return <Shell stepKey="setup"><LoadingState /></Shell>;
  const list = fixtures.filter((x) => x.group === group && !x.result)
    .sort((a, b) => (!!a.date - !!b.date) || a.match_number - b.match_number);

  return (
    <Shell stepKey="setup">
      {page === 0 && (
        <>
          <Question hint="Pick the fixture you want to schedule (or move).">Which match?</Question>
          <div className="flex gap-2 mb-3">
            {["A", "B", "C"].map((g) => (
              <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g}
                className={`flex-1 min-h-[48px] rounded-2xl font-black ${group === g ? "bg-brand-navy text-white" : "bg-white text-gray-700 shadow-soft"}`}>Group {g}</button>
            ))}
          </div>
          {list.length === 0 && <p className="text-gray-600">No open fixtures in Group {group}.</p>}
          {list.map((fx) => (
            <Pick key={fx.id} onClick={() => choose(fx)}
              note={fx.date ? `Now ${formatDateDisplay(fx.date)}${fx.time ? ` · ${time12(fx.time)}` : ""} — tap to move it` : "Not scheduled yet"}>
              {fx.team1_name} vs {fx.team2_name}
            </Pick>
          ))}
        </>
      )}
      {page === 1 && (
        <>
          <Question hint={`${f.team1_name} vs ${f.team2_name}`}>Which day?</Question>
          {[["Saturday", nextDate(6)], ["Sunday", nextDate(0)]].map(([label, d]) => (
            <Pick key={d} selected={form.date === d} onClick={() => setForm({ ...form, date: d })}>
              <span className="inline-flex items-center gap-2"><Calendar size={18} /> {label} {formatDateDisplay(d)}</span>
            </Pick>
          ))}
          <label className="block text-sm font-bold text-gray-700 mt-3 mb-1" htmlFor="setup-date">Another day</label>
          <input id="setup-date" type="date" className="input-field" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          <Big onClick={() => setPage(2)} disabled={!form.date}>Next</Big>
          <Big kind="white" onClick={() => setPage(0)}><ChevronLeft size={20} /> Back</Big>
        </>
      )}
      {page === 2 && (
        <>
          <Question hint="India time.">What time does it start?</Question>
          {["06:15", "07:00", "15:30"].map((t) => (
            <Pick key={t} selected={form.time === t} onClick={() => setForm({ ...form, time: t })}>
              <span className="inline-flex items-center gap-2"><Clock size={18} /> {time12(t)}</span>
            </Pick>
          ))}
          <label className="block text-sm font-bold text-gray-700 mt-3 mb-1" htmlFor="setup-time">Another time</label>
          <input id="setup-time" type="time" className="input-field" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
          <Big onClick={() => setPage(3)} disabled={!form.time}>Next</Big>
          <Big kind="white" onClick={() => setPage(1)}><ChevronLeft size={20} /> Back</Big>
        </>
      )}
      {page === 3 && (
        <>
          <Question hint="You can skip this.">Which ground?</Question>
          {["Ground A", "Ground B"].map((v) => (
            <Pick key={v} selected={form.venue === v} onClick={() => setForm({ ...form, venue: v })}>
              <span className="inline-flex items-center gap-2"><MapPin size={18} /> {v}</span>
            </Pick>
          ))}
          <label className="block text-sm font-bold text-gray-700 mt-3 mb-1" htmlFor="setup-venue">Another place</label>
          <input id="setup-venue" className="input-field" placeholder="Type a ground name" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
          <Big onClick={() => setPage(4)}>Next</Big>
          <Big kind="white" onClick={() => setPage(2)}><ChevronLeft size={20} /> Back</Big>
        </>
      )}
      {page === 4 && (
        <>
          <Question hint="Voting always closes when the match starts.">When should voting open?</Question>
          <Pick selected={form.opens === "now"} onClick={() => setForm({ ...form, opens: "now" })}>🟢 Right now</Pick>
          <Pick selected={form.opens === "later"} onClick={() => setForm({ ...form, opens: "later" })}>⏰ Later — I'll pick a time</Pick>
          {form.opens === "later" && (
            <>
              <label className="block text-sm font-bold text-gray-700 mt-2 mb-1" htmlFor="setup-opens">Voting opens at</label>
              <input id="setup-opens" type="datetime-local" className="input-field" value={form.opensAt} onChange={(e) => setForm({ ...form, opensAt: e.target.value })} />
            </>
          )}
          <Big onClick={() => setPage(5)} disabled={form.opens === "later" && !form.opensAt}>Next</Big>
          <Big kind="white" onClick={() => setPage(3)}><ChevronLeft size={20} /> Back</Big>
        </>
      )}
      {page === 5 && (
        <>
          <Question>Check and save</Question>
          <Card>
            <TeamsVs a={f.team1_name} b={f.team2_name} />
            <dl className="divide-y divide-gray-100 text-base">
              {[["📅 Day", formatDateDisplay(form.date)], ["🕕 Starts", time12(form.time)], ["📍 Ground", form.venue || "—"],
                ["🗳 Voting opens", form.opens === "now" ? "Right now" : form.opensAt.replace("T", " at ")]].map(([k, v]) => (
                <div key={k} className="flex justify-between py-2.5"><dt className="text-gray-600">{k}</dt><dd className="font-bold text-gray-900">{v}</dd></div>
              ))}
            </dl>
          </Card>
          <Big onClick={save} disabled={saving}><Check size={20} /> {saving ? "Saving…" : "Save match"}</Big>
          <Big kind="white" onClick={() => setPage(4)}><ChevronLeft size={20} /> Back</Big>
        </>
      )}
    </Shell>
  );
}

// ---------- step 2: watch the votes ----------
function VotesStep({ match, reload }) {
  const [dash, setDash] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => api.get("/admin/dashboard").then((r) => setDash(r.data)).catch(() => {}), []);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);

  const summary = dash?.slots?.find((s) => s.slot_id === match.slot_id);
  const pending = (dash?.vote_matrix || [])
    .filter((row) => !row.votes.find((v) => v.slot_id === match.slot_id)?.availability)
    .map((row) => row.captain).sort((a, b) => a.name.localeCompare(b.name));

  const mark = async (person, availability) => {
    setBusy(person.id);
    try {
      await api.post("/admin/votes", { user_id: person.id, slot_id: match.slot_id, availability });
      toast.success(`${person.name}: ${availability === "available" ? "playing" : "not playing"}`);
      await load(); reload();
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't save that answer");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Shell stepKey="votes" match={match}>
      <Question hint="This updates by itself every few seconds.">Who's playing?</Question>
      <Count3 a={summary?.available} b={summary?.not_available} c={summary?.no_response} />
      {summary?.maybe > 0 && <p className="text-sm text-gray-600 -mt-1 mb-3">🤔 {summary.maybe} marked “maybe” by an admin.</p>}
      <Card>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-black text-gray-900">Haven't answered</h3>
          <span className="text-xs text-gray-500">answer for them</span>
        </div>
        {!dash ? <LoadingState /> : pending.length === 0 ? (
          <p className="text-gray-600 py-2">Everyone has answered 🎉</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <span className="flex-1 font-semibold text-gray-900">{p.name}</span>
                <button type="button" disabled={busy === p.id} onClick={() => mark(p, "available")}
                  className="min-h-[44px] px-3 rounded-xl bg-pitch-50 text-pitch-800 font-black disabled:opacity-50">✓ In</button>
                <button type="button" disabled={busy === p.id} onClick={() => mark(p, "not_available")}
                  className="min-h-[44px] px-3 rounded-xl bg-red-50 text-red-700 font-black disabled:opacity-50">✕ Out</button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <BigLink to={`/manage?slot=${match.slot_id}`}>Done</BigLink>
    </Shell>
  );
}

// ---------- step 3: close voting ----------
function CloseStep({ match, reload }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const c = match.counts || {};
  const closed = match.voting?.state === "closed" || !!match.auction;

  const close = async () => {
    setBusy(true);
    try {
      await api.post("/admin/window/close", { slot_id: match.slot_id });
      toast.success("Voting closed");
      await reload();
      navigate(`/manage?slot=${match.slot_id}`);
    } catch (err) {
      toast.error(err.response?.status === 403 ? "Only full admins can close voting" : err.response?.data?.error || "Couldn't close voting");
    } finally {
      setBusy(false);
    }
  };

  if (closed) {
    return (
      <Shell stepKey="close" match={match}>
        <Question hint={`${c.available} players are in the pool.`}>Voting is closed ✓</Question>
        <BigLink to={`/manage?slot=${match.slot_id}`}>Back to This week</BigLink>
      </Shell>
    );
  }
  return (
    <Shell stepKey="close" match={match}>
      <Question hint={c.yet_to_vote ? `${c.yet_to_vote} haven't answered — once you close, they can't join this match.` : "Everyone has answered."}>
        Close voting for {match.label}?
      </Question>
      <Count3 a={c.available} b={c.not_available} c={c.yet_to_vote} />
      <Big onClick={close} disabled={busy}>{busy ? "Closing…" : "Yes, close voting"}</Big>
      <BigLink to={`/manage?slot=${match.slot_id}`} kind="white">Not yet</BigLink>
    </Shell>
  );
}

// ---------- step 4: credit attendance ----------
function AttendStep({ match, reload }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get("/admin/attendance/suggest", { params: { slot_id: match.slot_id } }).then((r) => setData(r.data)).catch(() => setData({ candidates: [], eligible_count: 0 })), [match.slot_id]);
  useEffect(() => { load(); }, [load]);

  const credit = async () => {
    setBusy(true);
    try {
      const res = await api.post("/admin/attendance/suggest/apply", { slot_id: match.slot_id });
      toast.success(res.data?.message || "Attendance credited");
      await load(); reload();
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't credit attendance");
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Shell stepKey="attend" match={match}><LoadingState /></Shell>;
  const todo = data.candidates.filter((c) => !c.already_credited);
  if (todo.length === 0) {
    return (
      <Shell stepKey="attend" match={match}>
        <Question hint="A match can't be counted twice.">Done — everyone playing got +1 ✓</Question>
        <BigLink to={`/manage?slot=${match.slot_id}`}>Back to This week</BigLink>
      </Shell>
    );
  }
  return (
    <Shell stepKey="attend" match={match}>
      <Question hint="Each gets +1 “present” and +1 “total”.">Give +1 attendance to these {todo.length} players?</Question>
      <Card><p className="leading-8 text-gray-800">{todo.map((c) => c.name).join(" · ")}</p></Card>
      <Big onClick={credit} disabled={busy}><Check size={20} /> {busy ? "Saving…" : `Give ${todo.length} players +1`}</Big>
      <BigLink to={`/manage?slot=${match.slot_id}`} kind="white">Not yet</BigLink>
    </Shell>
  );
}

// ---------- step 5: fix odd numbers ----------
function CategoryPicker({ person, onDone, onCancel }) {
  const [busy, setBusy] = useState(false);
  const save = async (cat) => {
    setBusy(true);
    try {
      try {
        await api.put(`/admin/players/${person.user_id}`, { auction_category: cat });
      } catch (err) {
        if (err.response?.status !== 404) throw err;
        await api.put(`/admin/captains/${person.user_id}`, { auction_category: cat });
      }
      toast.success(`${person.name} moved to ${groupName(cat)}`);
      onDone();
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't change the group");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onCancel}>
      <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-5" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Choose a group for ${person.name}`}>
        <h3 className="text-xl font-black text-gray-900">Which group is {person.name} in?</h3>
        <p className="text-sm text-gray-600 mb-3">This changes their group for every auction from now on.</p>
        <div className="grid grid-cols-2 gap-2">
          {CATS.map((c) => (
            <button key={c} type="button" disabled={busy} onClick={() => save(c)}
              className={`min-h-[56px] rounded-2xl border-2 font-bold ${person.category === c ? "border-pitch-600 bg-pitch-50" : "border-gray-200"}`}>{groupName(c)}</button>
          ))}
        </div>
        <Big kind="white" onClick={onCancel}>Cancel</Big>
      </div>
    </div>
  );
}

function OddStep({ match, reload }) {
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [sitOuts, setSitOuts] = useState(() => getSitOuts(match.slot_id));
  const [moving, setMoving] = useState(null);
  const load = useCallback(() => api.get("/admin/auction/preview", { params: { slot_id: match.slot_id } })
    .then((r) => setPreview(r.data)).catch((err) => setPreview({ error: err.response?.data?.error || "Couldn't load the players" })), [match.slot_id]);
  useEffect(() => { load(); }, [load]);

  const choose = (g, uid) => { setSitOut(match.slot_id, g, uid); setSitOuts(getSitOuts(match.slot_id)); };
  const undo = (g) => { clearSitOut(match.slot_id, g); setSitOuts(getSitOuts(match.slot_id)); };

  if (!preview) return <Shell stepKey="odd" match={match}><LoadingState /></Shell>;
  if (preview.error) return <Shell stepKey="odd" match={match}><Card>{preview.error}</Card></Shell>;

  const groups = preview.groups || [];
  const odd = groups.filter((g) => !g.is_balanced);
  const unresolved = odd.filter((g) => !sitOuts[g.category] || !g.players.some((p) => p.user_id === sitOuts[g.category]));
  const missing = preview.missing_category || [];
  const nameOf = (g, uid) => g.players.find((p) => p.user_id === uid)?.name;

  return (
    <Shell stepKey="odd" match={match}>
      <Question hint="Each team gets half of every group, so every group needs an even number.">Are the groups even?</Question>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {groups.map((g) => {
          const out = sitOuts[g.category] && !g.is_balanced ? 1 : 0;
          const n = g.count - out;
          return (
            <div key={g.category} className={`bg-white rounded-2xl shadow-soft py-3 text-center ${n % 2 ? "ring-2 ring-red-500" : ""}`}>
              <span className="block text-3xl font-black tabular-nums text-brand-navy">{n}</span>
              <span className="block text-sm font-bold text-gray-600">{groupName(g.category)}{n % 2 ? " · odd" : ""}</span>
            </div>
          );
        })}
      </div>

      {odd.map((g) => {
        const chosen = sitOuts[g.category] && nameOf(g, sitOuts[g.category]);
        return (
          <Card key={g.category} className={chosen ? "" : "ring-2 ring-red-200"}>
            <h3 className="font-black text-gray-900 text-lg">{groupName(g.category)} has {g.count} players</h3>
            {chosen ? (
              <div className="flex items-center justify-between gap-2 mt-2">
                <p className="text-gray-800"><b>{chosen}</b> sits out this auction only.</p>
                <button type="button" onClick={() => undo(g.category)} className="min-h-[44px] px-3 rounded-xl border-2 border-gray-200 font-bold">Change</button>
              </div>
            ) : (
              <>
                <p className="text-gray-600 mb-2">Easiest: pick one player to sit out this week. Their profile doesn't change.</p>
                {[...g.players].sort((a, b) => (b.user_id === g.suggested_holdout_id) - (a.user_id === g.suggested_holdout_id)).map((p) => (
                  <Pick key={p.user_id} onClick={() => choose(g.category, p.user_id)} note={p.user_id === g.suggested_holdout_id ? "Suggested — would be released last anyway" : null}>
                    {p.name}
                  </Pick>
                ))}
                <p className="text-gray-600 mt-3 mb-1">Or move someone into another group:</p>
                <div className="flex flex-wrap gap-2">
                  {g.players.map((p) => (
                    <button key={p.user_id} type="button" onClick={() => setMoving({ ...p, category: g.category })}
                      className="min-h-[44px] px-3 rounded-xl bg-gray-100 font-semibold text-gray-800">{p.name}</button>
                  ))}
                </div>
              </>
            )}
          </Card>
        );
      })}

      {missing.length > 0 && (
        <Card className="ring-2 ring-amber-200">
          <h3 className="font-black text-gray-900">No group yet</h3>
          <p className="text-gray-600 mb-2">These people are playing but have no group. (The two captains don't need one.)</p>
          <div className="flex flex-wrap gap-2">
            {missing.map((p) => (
              <button key={p.user_id} type="button" onClick={() => setMoving(p)} className="min-h-[44px] px-3 rounded-xl bg-amber-50 text-amber-900 font-bold">{p.name} — give a group</button>
            ))}
          </div>
        </Card>
      )}

      {unresolved.length === 0 && odd.length + missing.length === 0 && <Card className="ring-2 ring-pitch-200"><b className="text-pitch-800">All four groups are even ✓</b></Card>}
      <Big disabled={unresolved.length > 0} onClick={() => navigate(`/manage?slot=${match.slot_id}`)}>{unresolved.length ? "Pick who sits out first" : "Done"}</Big>
      {moving && <CategoryPicker person={moving} onCancel={() => setMoving(null)} onDone={() => { setMoving(null); load(); reload(); }} />}
    </Shell>
  );
}

// ---------- step 6: who runs it ----------
function DutyStep({ match }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(() => api.get("/admin/duty").then((r) => setData(r.data)).catch((err) => setError(err.response?.status === 403 ? "Only full admins can use the duty roster." : "Couldn't load the duty roster")), []);
  useEffect(() => { load(); }, [load]);

  if (!match.is_weekend) {
    return (
      <Shell stepKey="duty" match={match}>
        <Question hint="The Organiser runs auctions for weekday matches.">Nothing to do for this match ✓</Question>
        <BigLink to={`/manage?slot=${match.slot_id}`}>Back to This week</BigLink>
      </Shell>
    );
  }
  const evening = data?.evenings?.find((e) => e.slot_id === match.slot_id);
  return (
    <Shell stepKey="duty" match={match}>
      <Question hint={`${shortDay(match.auction_date)} · the evening before the match, 7:30 – 10:30 PM`}>Who will run the auction?</Question>
      {error ? <Card>{error}</Card> : !data ? <LoadingState /> : evening ? <EveningCard evening={evening} data={data} onChanged={load} /> : <Card>This match isn't on the roster yet.</Card>}
      <BigLink to={`/manage?slot=${match.slot_id}`} kind="white">Back to This week</BigLink>
    </Shell>
  );
}

// ---------- step 7: start the auction ----------
function StartStep({ match }) {
  const navigate = useNavigate();
  const [captains, setCaptains] = useState(null);
  const [page, setPage] = useState(0);
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const [preview, setPreview] = useState(null);
  const [sitOuts, setSitOutsState] = useState(() => getSitOuts(match.slot_id));
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.get("/admin/captains").then((r) => setCaptains(r.data || [])).catch(() => setCaptains([])); }, []);
  useEffect(() => {
    if (page !== 2) return;
    api.get("/admin/auction/preview", { params: { slot_id: match.slot_id, captain_a_id: a.id, captain_b_id: b.id } })
      .then((r) => setPreview(r.data)).catch((err) => setPreview({ error: err.response?.data?.error || "Couldn't check the players" }));
  }, [page, a, b, match.slot_id]);

  const openRun = (id) => { try { localStorage.setItem(ACTIVE_AUCTION_KEY, id); } catch { /* ignore */ } navigate("/manage/auction/run"); };

  if (match.auction) {
    const st = match.auction.status;
    return (
      <Shell stepKey="start" match={match}>
        <Question hint={st === "pending" ? "Tell both captains to open the app — they'll see a red LIVE button." : st === "active" ? "Pause, bid for a captain and finish from the auction screen." : "Next: share the teams."}>
          {st === "pending" ? "The auction is waiting for the captains" : st === "active" ? "The auction is live" : "The auction is finished ✓"}
        </Question>
        {st === "completed"
          ? <BigLink to={`/manage/step/share?slot=${match.slot_id}`}>Next: share the teams</BigLink>
          : <Big onClick={() => openRun(match.auction.id)}>Open the auction</Big>}
      </Shell>
    );
  }

  const groups = preview?.groups || [];
  const odd = groups.filter((g) => !g.is_balanced);
  const excluded = odd.map((g) => sitOuts[g.category]).filter((uid, i) => uid && odd[i].players.some((p) => p.user_id === uid));
  const stillOdd = odd.filter((g) => !g.players.some((p) => p.user_id === sitOuts[g.category]));
  const missing = preview?.missing_category || [];

  const create = async () => {
    setBusy(true);
    try {
      const res = await api.post("/admin/auction", { slot_id: match.slot_id, captain_a_id: a.id, captain_b_id: b.id, exclude_voter_ids: excluded });
      toast.success("Auction created — tell both captains to open the app");
      openRun(res.data.auction_id);
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't create the auction");
    } finally {
      setBusy(false);
    }
  };

  if (!captains) return <Shell stepKey="start" match={match}><LoadingState /></Shell>;
  const pickList = (current, set, other) => captains.filter((c) => c.id !== other?.id).map((c) => (
    <Pick key={c.id} selected={current?.id === c.id} onClick={() => set(c)} note={c.team_name || null}>🧢 {c.name}</Pick>
  ));

  return (
    <Shell stepKey="start" match={match}>
      {page === 0 && (<>
        <Question hint="They run the draft; they're never auctioned themselves.">Who is Captain A?</Question>
        {pickList(a, setA, b)}
        <Big onClick={() => setPage(1)} disabled={!a}>Next</Big>
      </>)}
      {page === 1 && (<>
        <Question>Who is Captain B?</Question>
        {pickList(b, setB, a)}
        <Big onClick={() => { setPreview(null); setPage(2); }} disabled={!b}>Next</Big>
        <Big kind="white" onClick={() => setPage(0)}><ChevronLeft size={20} /> Back</Big>
      </>)}
      {page === 2 && (<>
        <Question hint={`${a.name} vs ${b.name}`}>Ready to create the auction?</Question>
        {!preview ? <LoadingState /> : preview.error ? <Card>{preview.error}</Card> : (
          <>
            <Card>
              <p className="font-bold text-gray-900 mb-1 flex items-center gap-2"><Users size={18} /> {groups.reduce((n, g) => n + g.count, 0) - excluded.length} players in the pool</p>
              <p className="text-gray-600">{groups.map((g) => `${g.count - (excluded.some((uid) => g.players.some((p) => p.user_id === uid)) ? 1 : 0)} ${groupName(g.category)}`).join(" · ")}</p>
            </Card>
            {stillOdd.map((g) => (
              <Card key={g.category} className="ring-2 ring-red-200">
                <p className="font-black text-gray-900 mb-2">{groupName(g.category)} is odd ({g.count}) — who sits out?</p>
                {[...g.players].sort((x, y) => (y.user_id === g.suggested_holdout_id) - (x.user_id === g.suggested_holdout_id)).slice(0, 4).map((p) => (
                  <Pick key={p.user_id} onClick={() => { setSitOut(match.slot_id, g.category, p.user_id); setSitOutsState(getSitOuts(match.slot_id)); }}
                    note={p.user_id === g.suggested_holdout_id ? "Suggested" : null}>{p.name}</Pick>
                ))}
              </Card>
            ))}
            {missing.length > 0 && (
              <Card className="ring-2 ring-amber-200">
                <p className="font-bold text-gray-900">{missing.map((p) => p.name).join(", ")} {missing.length > 1 ? "have" : "has"} no group yet.</p>
                <Link to={`/manage/step/odd?slot=${match.slot_id}`} className="text-pitch-700 font-bold">Give them a group in step 5 ›</Link>
              </Card>
            )}
          </>
        )}
        <Big onClick={create} disabled={busy || !preview || !!preview?.error || stillOdd.length > 0 || missing.length > 0}>{busy ? "Creating…" : "Create auction"}</Big>
        <Big kind="white" onClick={() => setPage(1)}><ChevronLeft size={20} /> Back</Big>
      </>)}
    </Shell>
  );
}

// ---------- step 8: share the teams ----------
function ShareStep({ match }) {
  const [auction, setAuction] = useState(null);
  const [shared, setShared] = useState(() => wasShared(match.slot_id));
  useEffect(() => {
    if (match.auction?.status === "completed") api.get(`/auction/${match.auction.id}`).then((r) => setAuction(r.data)).catch(() => {});
  }, [match.auction]);
  const text = useMemo(() => (auction ? buildWhatsAppSummary(auction) : ""), [auction]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      markShared(match.slot_id); setShared(true);
      toast.success("Copied — paste it into the WhatsApp group");
    } catch {
      toast.error("Couldn't copy — press and hold the text below to copy it");
    }
  };

  if (match.auction?.status !== "completed") {
    return (
      <Shell stepKey="share" match={match}>
        <Question hint="Finish the auction first (step 7).">Nothing to share yet</Question>
        <BigLink to={`/manage?slot=${match.slot_id}`} kind="white">Back to This week</BigLink>
      </Shell>
    );
  }
  return (
    <Shell stepKey="share" match={match}>
      <Question hint="Only names are shared — prices stay private.">Share the teams</Question>
      {!auction ? <LoadingState /> : <Card><pre className="whitespace-pre-wrap text-sm text-gray-800 font-sans">{text}</pre></Card>}
      <Big onClick={copy} disabled={!auction}><Copy size={20} /> Copy for WhatsApp</Big>
      {shared && (
        <>
          <Card className="ring-2 ring-pitch-200 mt-3"><b className="text-pitch-800">All 8 steps done for this match 🎉</b></Card>
          <BigLink to={`/manage?slot=${match.slot_id}`} kind="white">Back to This week</BigLink>
        </>
      )}
    </Shell>
  );
}

// ---------- router ----------
const STEPS = { votes: VotesStep, close: CloseStep, attend: AttendStep, odd: OddStep, duty: DutyStep, start: StartStep, share: ShareStep };

export default function GuidedStep() {
  const { step } = useParams();
  const [params] = useSearchParams();
  const slotId = params.get("slot");
  const [overview, setOverview] = useState(null);
  const reload = useCallback(() => api.get("/admin/overview").then((r) => setOverview(r.data)).catch(() => setOverview({ matches: [] })), []);
  useEffect(() => { if (step !== "setup") reload(); }, [reload, step]);

  if (step === "setup") return <SetupStep />;
  const Step = STEPS[step];
  if (!Step) return <Shell stepKey="setup"><Card>Unknown step.</Card></Shell>;
  if (!overview) return <Shell stepKey={step}><LoadingState /></Shell>;
  const match = overview.matches.find((m) => m.slot_id === slotId);
  if (!match) {
    return (
      <Shell stepKey={step}>
        <Card>This match isn't coming up any more (it may have been played or cancelled).</Card>
        <BigLink to="/manage" kind="white">Back to This week</BigLink>
      </Shell>
    );
  }
  return <Step match={match} reload={reload} />;
}

