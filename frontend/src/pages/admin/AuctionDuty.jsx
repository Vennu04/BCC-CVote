import { useState, useEffect, useCallback, useRef } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import ManageHeader from "../../components/ManageHeader";
import { LoadingState, EmptyState } from "../../components/LoadingState";
import { CalendarClock, Copy, RefreshCw, Check, X, Crown, UserCheck, ShieldCheck } from "lucide-react";
import { COVERAGE, availableIn, buildRosterMessage, nameOf, shortDay, slotLabelOf } from "../../utils/duty";

// Every match's live auction runs the evening before the match, 7:30–10:30 PM
// IST. Weekend matches are rostered here (admins tick their own slots, one
// admin confirms a Lead + Backup); weekday matches are listed for information
// only — the Organiser runs those. See backend routes/duty.py.
export default function AuctionDuty() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get("/admin/duty");
      setData(res.data);
    } catch (err) {
      if (err.response?.status === 403) setForbidden(true);
      else toast.error("Couldn't load the auction duty roster");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(buildRosterMessage(data));
      toast.success("Roster copied — paste it into the admin WhatsApp group");
    } catch {
      toast.error("Couldn't copy — your browser may be blocking clipboard access");
    }
  };

  return (
    <div className="min-h-screen bg-brand-ground isolate">
      <Navbar />
      <ManageHeader hub="auction" sub="duty"
        subtitle="Each auction runs the evening before its match, 7:30 – 10:30 PM. Weekend matches: tick the slots you can cover, then confirm a Lead and a Backup." />
      <div className="max-w-4xl mx-auto px-4 py-4 space-y-5">
        <div className="flex items-start justify-end flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button onClick={() => { setLoading(true); fetchData(); }} className="btn-secondary flex items-center gap-1.5 text-sm">
              <RefreshCw size={14} /> Refresh
            </button>
            {data && (
              <button onClick={handleCopy} className="btn-primary flex items-center gap-1.5 text-sm">
                <Copy size={14} /> Copy roster for WhatsApp
              </button>
            )}
          </div>
        </div>

        {loading && !data ? (
          <LoadingState />
        ) : forbidden ? (
          <div className="card text-sm text-gray-600">Auction Duty is only for accounts with full admin rights.</div>
        ) : !data || data.evenings.length === 0 ? (
          <EmptyState message="No upcoming matches in the next 3 weeks. Schedule one in Manage Tournament and it appears here." />
        ) : (
          data.evenings.map((evening) => (
            <EveningCard key={`${evening.slot_id}-${evening.auction_date}`} evening={evening} data={data} onChanged={fetchData} />
          ))
        )}
      </div>
    </div>
  );
}

export function EveningCard({ evening, data, onChanged }) {
  const coverage = COVERAGE[evening.coverage] || COVERAGE.nobody;
  return (
    <section className="card space-y-4" aria-label={`Auction for ${evening.match_label}`}>
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Auction evening · {shortDay(evening.auction_date)} · 7:30 – 10:30 PM
          </p>
          <h2 className="font-bold text-gray-900 text-lg leading-tight">Auction for {evening.match_label}</h2>
          <p className="text-xs text-gray-500">
            {evening.group ? `Group ${evening.group} · ` : ""}Match {shortDay(evening.match_date)}
            {evening.kickoff ? ` · ${evening.kickoff}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {evening.auction_status === "completed" && (
            <span className="text-xs font-semibold rounded-full border px-2.5 py-1 bg-gray-100 text-gray-600 border-gray-300">Auction done</span>
          )}
          <span className={`text-xs font-semibold rounded-full border px-2.5 py-1 ${coverage.className}`}>{coverage.label}</span>
        </div>
      </header>

      {!evening.is_weekend ? (
        <p className="text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
          Weekday match — the Organiser runs this auction. Nothing to tick.
        </p>
      ) : (
        <>
          <MyAvailability evening={evening} data={data} onChanged={onChanged} />
          <AvailabilityGrid evening={evening} data={data} />
          <Assignment evening={evening} data={data} onChanged={onChanged} />
        </>
      )}
    </section>
  );
}

function MyAvailability({ evening, data, onChanged }) {
  const saved = evening.responses[data.me] || { slots: [], captain: false };
  const [slots, setSlots] = useState(saved.slots);
  const [captain, setCaptain] = useState(saved.captain);
  const [saving, setSaving] = useState(false);
  const queued = useRef(null);

  useEffect(() => { setSlots(saved.slots); setCaptain(saved.captain); }, [saved.slots.join(","), saved.captain]);

  // One save at a time per evening; a tap while saving is queued and sent
  // with the latest state once the previous save lands.
  const save = async (next) => {
    if (saving) { queued.current = next; return; }
    setSaving(true);
    try {
      let body = next;
      for (;;) {
        const res = await api.put(`/admin/duty/${evening.slot_id}/me`, body);
        if (res.data.removed_from) toast(`You're no longer ${res.data.removed_from} for this auction — someone needs to confirm a replacement`, { icon: "⚠️" });
        if (!queued.current) break;
        body = queued.current;
        queued.current = null;
      }
      await onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't save your availability");
      setSlots(saved.slots); setCaptain(saved.captain);
    } finally {
      setSaving(false);
    }
  };

  const toggleSlot = (code) => {
    const next = slots.includes(code) ? slots.filter((s) => s !== code) : [...slots, code];
    setSlots(next);
    save({ slots: next, captain });
  };
  const toggleCaptain = () => {
    const next = !captain;
    setCaptain(next);
    if (next) setSlots([]);
    save({ slots: next ? [] : slots, captain: next });
  };

  return (
    <div className="rounded-lg bg-pitch-50/60 border border-pitch-100 px-3 py-3">
      <p className="text-xs font-semibold text-gray-700 mb-2">Your availability</p>
      <div className="flex flex-wrap items-center gap-2">
        {data.slots.map((s) => {
          const on = slots.includes(s.code);
          return (
            <button
              key={s.code}
              type="button"
              aria-pressed={on}
              disabled={captain}
              onClick={() => toggleSlot(s.code)}
              className={`min-h-[40px] text-sm rounded-lg border px-3 py-1.5 flex items-center gap-1.5 transition-colors duration-150 disabled:opacity-40 ${
                on ? "bg-pitch-600 border-pitch-600 text-white" : "bg-white border-gray-300 text-gray-700 hover:border-pitch-400"
              }`}
            >
              {on ? <Check size={14} /> : null} {s.label}
            </button>
          );
        })}
        <label className="flex items-center gap-2 text-sm text-gray-700 ml-1 min-h-[40px] cursor-pointer">
          <input id={`captain-${evening.slot_id}`} type="checkbox" checked={captain} onChange={toggleCaptain} className="h-4 w-4 accent-amber-600" />
          I&apos;m a captain in this match
        </label>
        {saving && <span className="text-xs text-gray-400">Saving…</span>}
      </div>
    </div>
  );
}

function AvailabilityGrid({ evening, data }) {
  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500">
            <th className="font-medium py-1.5 px-1">Admin</th>
            {data.slots.map((s) => <th key={s.code} className="font-medium py-1.5 px-1 text-center whitespace-nowrap">{s.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.admins.map((admin) => {
            const r = evening.responses[admin.id];
            const role = admin.id === evening.lead_id ? "Lead" : admin.id === evening.backup_id ? "Backup" : null;
            return (
              <tr key={admin.id} className="border-t border-gray-100">
                <td className="py-1.5 px-1 whitespace-nowrap">
                  <span className="font-medium text-gray-900">{admin.name}</span>
                  {admin.id === data.me && <span className="text-xs text-gray-400"> (you)</span>}
                  {role && (
                    <span className={`ml-2 text-[11px] font-bold rounded-full px-2 py-0.5 ${role === "Lead" ? "bg-pitch-600 text-white" : "bg-sky-100 text-sky-800"}`}>{role}</span>
                  )}
                </td>
                {!r ? (
                  <td colSpan={data.slots.length} className="py-1.5 px-1 text-center text-xs text-gray-400 italic">no reply yet</td>
                ) : r.captain ? (
                  <td colSpan={data.slots.length} className="py-1.5 px-1 text-center text-xs text-amber-700">
                    <Crown size={12} className="inline -mt-0.5" /> Captain in this match — can&apos;t run it
                  </td>
                ) : (
                  data.slots.map((s) => (
                    <td key={s.code} className="py-1.5 px-1 text-center">
                      {r.slots.includes(s.code)
                        ? <Check size={16} className="inline text-pitch-600" aria-label="available" />
                        : <X size={16} className="inline text-gray-300" aria-label="not available" />}
                    </td>
                  ))
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Assignment({ evening, data, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const initial = evening.lead_id
    ? { start_slot: evening.start_slot, lead_id: evening.lead_id, backup_id: evening.backup_id || "" }
    : { start_slot: evening.suggestion?.start_slot || "", lead_id: evening.suggestion?.lead_id || "", backup_id: evening.suggestion?.backup_id || "" };
  const [form, setForm] = useState(initial);

  const submit = async (body) => {
    setSaving(true);
    try {
      await api.put(`/admin/duty/${evening.slot_id}/assignment`, body);
      toast.success(body.lead_id ? "Roster confirmed" : "Roster cleared");
      setEditing(false);
      await onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || "Couldn't update the roster");
    } finally {
      setSaving(false);
    }
  };

  const free = form.start_slot ? availableIn(evening, form.start_slot) : [];
  const options = data.admins.filter((a) => free.includes(a.id));

  if (editing) {
    return (
      <div className="rounded-lg border border-gray-200 px-3 py-3 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Field label="Auction starts" id={`start-${evening.slot_id}`}>
            <select id={`start-${evening.slot_id}`} className="input-field py-1.5 text-sm" value={form.start_slot}
              onChange={(e) => setForm({ start_slot: e.target.value, lead_id: "", backup_id: "" })}>
              <option value="">Pick a slot…</option>
              {data.slots.map((s) => <option key={s.code} value={s.code}>{s.label} ({availableIn(evening, s.code).length} free)</option>)}
            </select>
          </Field>
          <Field label="Lead" id={`lead-${evening.slot_id}`}>
            <select id={`lead-${evening.slot_id}`} className="input-field py-1.5 text-sm" value={form.lead_id} disabled={!form.start_slot}
              onChange={(e) => setForm((f) => ({ ...f, lead_id: e.target.value, backup_id: f.backup_id === e.target.value ? "" : f.backup_id }))}>
              <option value="">Pick the Lead…</option>
              {options.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.recent_duties} recent</option>)}
            </select>
          </Field>
          <Field label="Backup" id={`backup-${evening.slot_id}`}>
            <select id={`backup-${evening.slot_id}`} className="input-field py-1.5 text-sm" value={form.backup_id} disabled={!form.lead_id}
              onChange={(e) => setForm((f) => ({ ...f, backup_id: e.target.value }))}>
              <option value="">No Backup yet</option>
              {options.filter((a) => a.id !== form.lead_id).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.recent_duties} recent</option>)}
            </select>
          </Field>
        </div>
        {form.start_slot && options.length === 0 && (
          <p className="text-xs text-amber-700">Nobody has ticked this slot yet — admins need to mark themselves available first.</p>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary text-sm" disabled={saving || !form.lead_id}
            onClick={() => submit({ start_slot: form.start_slot, lead_id: form.lead_id, backup_id: form.backup_id || null })}>
            {saving ? "Saving…" : "Confirm roster"}
          </button>
          <button className="btn-secondary text-sm" disabled={saving} onClick={() => { setForm(initial); setEditing(false); }}>Cancel</button>
          {evening.lead_id && (
            <button className="btn-ghost text-sm text-red-600" disabled={saving} onClick={() => submit({ lead_id: null })}>Clear roster</button>
          )}
        </div>
      </div>
    );
  }

  if (evening.lead_id) {
    return (
      <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg bg-pitch-50 border border-pitch-200 px-3 py-2.5">
        <p className="text-sm text-gray-800 flex items-center gap-2 flex-wrap">
          <ShieldCheck size={16} className="text-pitch-600" />
          <span>Starts <b>{slotLabelOf(data.slots, evening.start_slot)}</b></span>
          <span>· Lead <b>{nameOf(data.admins, evening.lead_id)}</b></span>
          <span>· Backup {evening.backup_id ? <b>{nameOf(data.admins, evening.backup_id)}</b> : <span className="text-amber-700 font-medium">still needed</span>}</span>
          {evening.assigned_by && <span className="text-xs text-gray-400">(confirmed by {evening.assigned_by})</span>}
        </p>
        <button className="btn-secondary text-sm" onClick={() => { setForm(initial); setEditing(true); }}>Change</button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between flex-wrap gap-2 rounded-lg bg-sky-50 border border-sky-200 px-3 py-2.5">
      {evening.suggestion ? (
        <p className="text-sm text-gray-800 flex items-center gap-2 flex-wrap">
          <UserCheck size={16} className="text-sky-700" />
          <span>Suggested: starts <b>{slotLabelOf(data.slots, evening.suggestion.start_slot)}</b></span>
          <span>· Lead <b>{nameOf(data.admins, evening.suggestion.lead_id)}</b></span>
          <span>· Backup {evening.suggestion.backup_id ? <b>{nameOf(data.admins, evening.suggestion.backup_id)}</b> : <span className="text-amber-700 font-medium">nobody else free yet</span>}</span>
        </p>
      ) : (
        <p className="text-sm text-gray-600">Nobody has marked themselves available yet.</p>
      )}
      <div className="flex gap-2">
        {evening.suggestion && (
          <button className="btn-primary text-sm" disabled={saving}
            onClick={() => submit({ ...evening.suggestion })}>
            {saving ? "Saving…" : "Confirm suggestion"}
          </button>
        )}
        <button className="btn-secondary text-sm" onClick={() => { setForm(initial); setEditing(true); }}>Choose manually</button>
      </div>
    </div>
  );
}

function Field({ label, id, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-gray-700 mb-1">{label}</label>
      {children}
    </div>
  );
}
