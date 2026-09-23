import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import ManageHeader from "../../components/ManageHeader";
import AvailabilityGrid from "../../components/AvailabilityGrid";
import YetToVotePanel from "../../components/YetToVotePanel";
import DutySummary from "../../components/DutySummary";
import { TeamsVs } from "../../components/TeamCrest";
import { LoadingState } from "../../components/LoadingState";
import { STATUS_STYLES } from "../../utils/windowStatus";
import { matchWhen } from "../../utils/matchLabel";
import { Download, RefreshCw, Users, BarChart2, ClipboardList, CalendarDays, ChevronDown, ChevronUp, ChevronRight, CheckCircle2 } from "lucide-react";

// Live vote counts matter most here while a voting window is running, so it
// polls silently in the background; the Refresh button is the loud version.
const POLL_INTERVAL_MS = 10000;

const STEP_LABELS = { voting: "Voting", attendance: "Attendance", categories: "Categories", auction: "Auction" };
const TODO_DOT = { red: "bg-red-600", gold: "bg-amber-500", blue: "bg-sky-600", info: "bg-gray-400" };

// Control Centre — formerly the Admin Dashboard. A to-do list worked out by
// the server (/admin/overview), each match's progress through voting →
// attendance → categories → auction, live turnout with "set a vote for
// someone", the full votes table, insights and exports.
export default function ControlCentre() {
  const [data, setData] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [insights, setInsights] = useState(null);
  const [showGrid, setShowGrid] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef(null);

  const fetchData = useCallback(async () => {
    try {
      const [dash, ov] = await Promise.all([api.get("/admin/dashboard"), api.get("/admin/overview")]);
      setData(dash.data);
      setOverview(ov.data);
    } catch {
      toast.error("Failed to load the Control Centre");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const interval = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchData]);
  useEffect(() => {
    api.get("/admin/dashboard/insights").then((res) => setInsights(res.data)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!exportOpen) return;
    const close = (e) => { if (!exportRef.current?.contains(e.target)) setExportOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [exportOpen]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    toast.success("Refreshed");
    setRefreshing(false);
  };

  const downloadFile = async (endpoint, filenamePrefix, ext) => {
    setExportOpen(false);
    try {
      const res = await api.get(endpoint, { responseType: "blob" });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      toast.success(`${ext.toUpperCase()} downloaded`);
    } catch {
      toast.error("Export failed");
    }
  };

  const matrix = useMemo(() => data?.vote_matrix || [], [data]);
  const visibleSlots = useMemo(() => data?.slots || [], [data]);
  const visibleSlotIds = useMemo(() => new Set(visibleSlots.map((s) => s.slot_id)), [visibleSlots]);
  const filteredMatrix = useMemo(
    () => matrix.map((row) => ({ ...row, votes: row.votes.filter((v) => visibleSlotIds.has(v.slot_id)) })),
    [matrix, visibleSlotIds]
  );
  const gridSlots = useMemo(
    () => filteredMatrix[0]?.votes?.map((v) => ({ ...v, slot_number: parseInt(v.slot_label.replace("Slot ", "")) })) || [],
    [filteredMatrix]
  );
  const stepsBySlot = useMemo(() => Object.fromEntries((overview?.matches || []).map((m) => [m.slot_id, m])), [overview]);

  const actions = (
    <>
      <button onClick={handleRefresh} disabled={refreshing}
        className="flex items-center gap-1.5 text-sm px-3 min-h-[40px] rounded-xl bg-white/10 hover:bg-white/15 disabled:opacity-50">
        <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh"}
      </button>
      <div className="relative" ref={exportRef}>
        <button onClick={() => setExportOpen((o) => !o)} aria-expanded={exportOpen}
          className="flex items-center gap-1.5 text-sm font-bold px-3 min-h-[40px] rounded-xl bg-brand-gold text-brand-navy">
          <Download size={15} /> Export <ChevronDown size={14} />
        </button>
        {exportOpen && (
          <div className="absolute right-0 mt-1 w-56 bg-white text-gray-800 rounded-xl shadow-soft-lg border border-gray-100 py-1 z-50">
            <MenuItem icon={ClipboardList} onClick={() => downloadFile("/admin/export/available-players", "BCC-Available-Players", "xlsx")}>Available Players (Excel)</MenuItem>
            <MenuItem icon={Download} onClick={() => downloadFile("/admin/export/excel", "BCC-Availability", "xlsx")}>All votes (Excel)</MenuItem>
            <MenuItem icon={Download} onClick={() => downloadFile("/admin/export/csv", "BCC-Availability", "csv")}>All votes (CSV)</MenuItem>
          </div>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <ManageHeader hub="control" sub={null} actions={actions}
        subtitle={data ? `${data.open_count ?? 0} of ${data.total_slots ?? 0} voting windows open · ${data.captains_voted ?? 0} of ${data.captains_total ?? 0} voters have voted` : "Loading…"} />

      <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {loading ? <LoadingState /> : (
          <>
            {/* To do */}
            <section className="bg-white rounded-2xl shadow-soft p-4">
              <h2 className="font-black text-gray-900 mb-1">To do</h2>
              {(overview?.todos || []).length === 0 ? (
                <p className="flex items-center gap-2 text-sm text-pitch-700 font-semibold py-1"><CheckCircle2 size={16} /> Nothing needs you right now.</p>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {overview.todos.map((t, i) => (
                    <li key={i}>
                      <Link to={t.link} className="flex items-start gap-3 py-2.5 hover:bg-gray-50 -mx-2 px-2 rounded-lg">
                        <span className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${TODO_DOT[t.level]}`} />
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm font-bold text-gray-900">{t.title}</span>
                          <span className="block text-xs text-gray-500">{t.detail}</span>
                        </span>
                        <ChevronRight size={16} className="text-gray-400 mt-1" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <DutySummary variant="dark" />

            {/* Matches */}
            <section>
              <h2 className="text-xs font-black uppercase tracking-wider text-gray-500 mb-2">Matches</h2>
              {visibleSlots.length === 0 ? (
                <p className="bg-white rounded-2xl shadow-soft px-4 py-6 text-center text-sm text-gray-500">No match slots to show.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {visibleSlots.map((slot) => (
                    <MatchProgressCard key={slot.slot_id} slot={slot} ov={stepsBySlot[slot.slot_id]} matrix={matrix} onVoteSet={fetchData} />
                  ))}
                </div>
              )}
            </section>

            {/* Full votes table */}
            <section className="rounded-2xl overflow-hidden bg-royal-600 shadow-soft">
              <button onClick={() => setShowGrid((v) => !v)} aria-expanded={showGrid}
                className="w-full flex items-center gap-2 px-4 min-h-[52px] text-white bg-royal-800">
                <BarChart2 size={18} className="text-sky-400" />
                <span className="font-semibold flex-1 text-left">Votes table — every voter × every match</span>
                {showGrid ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {showGrid && <div className="p-3"><AvailabilityGrid matrix={filteredMatrix} slots={gridSlots} /></div>}
            </section>

            {/* Insights */}
            {insights && (
              <section>
                <h2 className="text-xs font-black uppercase tracking-wider text-gray-500 mb-2">Insights</h2>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <InsightBarCard title="Attendance Trend" icon={<Users size={16} className="text-brand-navy" />}
                    items={insights.attendance_trend.map((m) => ({ label: m.label, value: m.attendee_count }))}
                    emptyLabel="No league matches recorded yet" valueSuffix=" present" />
                  <InsightBarCard title="Auction Spend by Category (pts)" icon={<BarChart2 size={16} className="text-brand-navy" />}
                    items={Object.entries(insights.auction_spend_by_category).map(([label, value]) => ({ label, value }))}
                    emptyLabel="No auctioned players sold yet" valueSuffix=" pts" />
                  <InsightBarCard title="Voting Participation %" icon={<CalendarDays size={16} className="text-brand-navy" />}
                    items={insights.participation_trend.map((w) => ({
                      label: w.opens_at ? w.opens_at.split(",")[0] : w.window_id.slice(-6),
                      value: w.participation_pct,
                    }))}
                    emptyLabel="No voting windows yet" valueSuffix="%" />
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function MenuItem({ icon: Icon, onClick, children }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 px-3 min-h-[42px] text-sm text-left hover:bg-gray-50">
      <Icon size={15} className="text-gray-500" /> {children}
    </button>
  );
}

function MatchProgressCard({ slot, ov, matrix, onVoteSet }) {
  const status = STATUS_STYLES[slot.window?.status];
  return (
    <div className="bg-white rounded-2xl shadow-soft overflow-hidden">
      <div className="p-4 pb-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-gray-500">{slot.group ? `Group ${slot.group} · ` : ""}{matchWhen(slot)}</span>
          <span className={`text-[10px] font-bold rounded-full px-2.5 py-1 border border-black/5 shrink-0 ${status?.className || "bg-gray-100 text-gray-600"}`}>
            {status?.label || slot.window?.status || "NO WINDOW"}
          </span>
        </div>
        {slot.team_a_name && slot.team_b_name
          ? <TeamsVs a={slot.team_a_name} b={slot.team_b_name} />
          : <p className="font-extrabold text-gray-900 my-2">{slot.day} {slot.time_of_day}</p>}
        {ov && (
          <>
            <div className="flex gap-1 mt-1" aria-label="Progress">
              {ov.steps.map((s) => (
                <span key={s.key} title={`${STEP_LABELS[s.key]}: ${s.state}`}
                  className={`flex-1 h-1.5 rounded-full ${s.state === "done" ? "bg-pitch-600" : s.state === "current" ? "bg-brand-gold" : "bg-gray-200"}`} />
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-1">
              {ov.steps.map((s) => (
                <span key={s.key} className={s.state === "current" ? "font-bold text-gray-800" : ""}>
                  {STEP_LABELS[s.key]}{s.key !== "auction" ? " ▸ " : ""}
                </span>
              ))}
            </p>
            {ov.odd_groups.length > 0 && (
              <p className="text-[11px] font-bold text-red-700 mt-1">Odd: {ov.odd_groups.map((g) => `${g.replaceAll("_", " ")} (${ov.counts.by_group[g]})`).join(", ")}</p>
            )}
          </>
        )}
        {slot.weather?.status === "ok" && (
          <p className="text-[11px] text-gray-500 mt-1">☀ {Math.round(slot.weather.temp_c)}°C · 🌧 {slot.weather.rain_chance_pct}% rain</p>
        )}
      </div>
      {/* Scoreboard strip */}
      <div className="bg-brand-navy text-white px-4 py-2.5 flex items-center gap-4">
        <span className="text-center">
          <span className="block text-2xl font-black leading-none tabular-nums">{slot.available}</span>
          <span className="block text-[10px] font-bold uppercase tracking-wider text-white/55">Available</span>
        </span>
        <span className="text-xs text-white/70 flex-1 flex gap-3 flex-wrap">
          <span>🤔 {slot.maybe} maybe</span>
          <span>❌ {slot.not_available} out</span>
        </span>
      </div>
      <div className="px-4 py-2 text-xs">
        <YetToVotePanel matrix={matrix} slotId={slot.slot_id} noResponseCount={slot.no_response} onVoteSet={onVoteSet} />
      </div>
    </div>
  );
}

// Small horizontal bar chart — plain divs, no charting library in this app.
function InsightBarCard({ title, icon, items, emptyLabel, valuePrefix = "", valueSuffix = "" }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="bg-white rounded-2xl shadow-soft p-4">
      <div className="flex items-center gap-2 mb-3">
        {icon}
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-500 text-center py-4">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={`${item.label}-${i}`} className="text-xs">
              <div className="flex justify-between text-gray-600 mb-0.5">
                <span className="truncate pr-2">{item.label}</span>
                <span className="font-bold text-gray-900 shrink-0">{valuePrefix}{item.value}{valueSuffix}</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-brand-navy rounded-full" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
