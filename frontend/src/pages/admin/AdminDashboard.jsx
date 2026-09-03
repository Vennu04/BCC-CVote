import { useState, useEffect, useCallback, useMemo } from "react";
import { Link } from "react-router-dom";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import PageBackgroundPhoto from "../../components/PageBackgroundPhoto";
import AvailabilityGrid from "../../components/AvailabilityGrid";
import YetToVotePanel from "../../components/YetToVotePanel";
import { LoadingState } from "../../components/LoadingState";
import adminPhoto from "../../assets/dashboard-backgrounds/admin.webp";
import { STATUS_STYLES } from "../../utils/windowStatus";
import { Download, RefreshCw, Users, BarChart2, Settings, ClipboardList, CalendarDays } from "lucide-react";

// Live vote counts matter most on this page (the Thu-Fri voting window is
// actively running), so it polls in the background — same pattern as
// useAuction.js's bidding loop and VotingWindow's turnout poll, just a
// slower interval since a full captain×slot matrix is a bigger payload.
// Silent (no toast) so it doesn't spam every 10s — the toast is reserved
// for the explicit manual Refresh click below.
const POLL_INTERVAL_MS = 10000;

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // Separate from `data` — insights query heavier aggregates (attendance
  // trend, auction spend, participation history) that don't need to move
  // every 10s like the live vote matrix does, so this fetches once on mount
  // rather than joining the polling loop below.
  const [insights, setInsights] = useState(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await api.get("/admin/dashboard");
      setData(res.data);
    } catch {
      toast.error("Failed to load dashboard");
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
    api.get("/admin/dashboard/insights")
      .then((res) => setInsights(res.data))
      .catch(() => {}); // Non-critical — the rest of the dashboard works fine without it.
  }, []);

  // fetchData alone gave no feedback on click — it silently refetches, so if
  // nothing on screen happens to change, admin has no way to tell the button
  // did anything at all. Wrapping it with a spinner + toast makes the refresh
  // visibly happen every time, whether or not the underlying numbers moved.
  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    toast.success("Dashboard refreshed");
    setRefreshing(false);
  };

  const downloadFile = async (endpoint, filenamePrefix, ext) => {
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

  const handleExport = (format = "excel") => {
    const endpoint = format === "excel" ? "/admin/export/excel" : "/admin/export/csv";
    downloadFile(endpoint, "BCC-Availability", format === "excel" ? "xlsx" : "csv");
  };

  const handleExportAvailablePlayers = () => {
    downloadFile("/admin/export/available-players", "BCC-Available-Players", "xlsx");
  };

  const matrix = useMemo(() => data?.vote_matrix || [], [data]);

  // Every active match slot shows here, not just ones with an open window —
  // admin also wants to see closed/completed matches (e.g. to check turnout
  // after an offline auction) and not-yet-open upcoming ones side by side,
  // not just the ones still accepting votes right now.
  const visibleSlots = useMemo(() => data?.slots || [], [data]);
  const visibleSlotIds = useMemo(() => new Set(visibleSlots.map((s) => s.slot_id)), [visibleSlots]);

  // Row filtering alone would misalign AvailabilityGrid's header columns
  // against each row's cells (they're matched by slot_id, not position), so
  // both the matrix's per-row votes and the derived header slots are built
  // from the same filtered set.
  const filteredMatrix = useMemo(
    () => matrix.map((row) => ({ ...row, votes: row.votes.filter((v) => visibleSlotIds.has(v.slot_id)) })),
    [matrix, visibleSlotIds]
  );
  const slots = useMemo(
    () => filteredMatrix[0]?.votes?.map((v) => ({ slot_number: parseInt(v.slot_label.replace("Slot ", "")), day: v.day, time_of_day: v.time_of_day })) || [],
    [filteredMatrix]
  );

  if (loading) return (
    <div className="min-h-screen"><Navbar />
      <div className="flex items-center justify-center h-64"><LoadingState /></div>
    </div>
  );

  return (
    <div className="min-h-screen bg-cricket-cream isolate">
      <PageBackgroundPhoto src={adminPhoto} />
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8">

        {/* Title */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Admin Dashboard</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              🟢 {data?.open_count ?? 0} of {data?.total_slots ?? 0} voting windows open
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button onClick={handleRefresh} disabled={refreshing} className="btn-secondary flex items-center gap-1.5 text-sm py-2 px-4 disabled:opacity-50">
              <RefreshCw size={15} className={refreshing ? "animate-spin" : ""} /> {refreshing ? "Refreshing…" : "Refresh"}
            </button>
            <Link to="/admin/window" className="btn-secondary flex items-center gap-1.5 text-sm py-2 px-4">
              <Settings size={15} /> Manage Windows
            </Link>
            <button onClick={handleExportAvailablePlayers} className="btn-primary flex items-center gap-1.5 text-sm py-2 px-4">
              <ClipboardList size={15} /> Available Players
            </button>
            <button onClick={() => handleExport("excel")} className="btn-secondary flex items-center gap-1.5 text-sm py-2 px-4">
              <Download size={15} /> Export Excel
            </button>
            <button onClick={() => handleExport("csv")} className="btn-secondary flex items-center gap-1.5 text-sm py-2 px-4">
              <Download size={15} /> Export CSV
            </button>
          </div>
        </div>

        {/* Stats row — every active match slot */}
        {visibleSlots.length === 0 ? (
          <div className="card text-center py-8 mb-8 text-gray-500 text-sm">
            No match slots to show.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            {visibleSlots.map((slot) => (
              <div key={slot.slot_id} className="card text-center relative overflow-hidden">
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-pitch-400 to-pitch-600" />
                <CalendarDays size={16} className="mx-auto text-gray-400 mb-1" />
                <p className="text-xs font-medium text-gray-500 uppercase">{slot.day} {slot.time_of_day}</p>
                <span className={`inline-block text-[10px] font-semibold rounded-full px-2.5 py-1 mt-1.5 border border-black/5 ${STATUS_STYLES[slot.window?.status]?.className || "bg-gray-100 text-gray-600"}`}>
                  {STATUS_STYLES[slot.window?.status]?.label || slot.window?.status || "UNKNOWN"}
                </span>
                {/* Compact weather glance — full forecast card lives on the
                    voting page and Voting Windows page; this dashboard's cards
                    are too small for the 4-line version, so just temp + rain%. */}
                {slot.weather?.status === "ok" && (
                  <p className="text-[11px] text-gray-500 mt-1">
                    {Math.round(slot.weather.temp_c)}°C 🌧️{slot.weather.rain_chance_pct}%
                  </p>
                )}
                <p className="text-3xl font-bold text-pitch-600 mt-1">{slot.available}</p>
                <p className="text-xs text-gray-400">Available</p>
                <div className="flex justify-center gap-2 mt-2 text-xs text-gray-500">
                  <span className="text-yellow-600">🤔 {slot.maybe}</span>
                  <span className="text-red-600">❌ {slot.not_available}</span>
                  <YetToVotePanel
                    matrix={matrix}
                    slotId={slot.slot_id}
                    noResponseCount={slot.no_response}
                    onVoteSet={fetchData}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Voted count */}
        <div className="flex items-center gap-2 text-sm text-gray-600 mb-4 bg-white/60 rounded-xl px-4 py-2.5 w-fit">
          <Users size={16} className="text-pitch-600" />
          <span><strong>{data?.captains_voted}</strong> of <strong>{data?.captains_total}</strong> voters have voted</span>
        </div>

        {/* Full matrix */}
        <div className="card overflow-hidden p-0">
          <div className="flex items-center gap-2 px-6 py-4 border-b bg-gradient-to-r from-gray-50 to-white">
            <BarChart2 size={18} className="text-pitch-600" />
            <h2 className="font-semibold text-gray-800">Captain × Slot Availability</h2>
          </div>
          <div className="p-4">
            <AvailabilityGrid matrix={filteredMatrix} slots={slots} />
          </div>
        </div>

        {/* Broader insights — attendance trend, auction spend, participation
            history. Plain-divs bar charts (no charting library in this app's
            dependencies) to stay consistent with everything else here. */}
        {insights && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mt-8">
            <InsightBarCard
              title="Attendance Trend"
              icon={<Users size={16} className="text-pitch-600" />}
              items={insights.attendance_trend.map((m) => ({ label: m.label, value: m.attendee_count }))}
              emptyLabel="No league matches recorded yet"
              valueSuffix=" present"
            />
            <InsightBarCard
              title="Auction Spend by Category"
              icon={<BarChart2 size={16} className="text-pitch-600" />}
              items={Object.entries(insights.auction_spend_by_category).map(([label, value]) => ({ label, value }))}
              emptyLabel="No auctioned players sold yet"
              valuePrefix="₹"
            />
            <InsightBarCard
              title="Voting Participation %"
              icon={<CalendarDays size={16} className="text-pitch-600" />}
              items={insights.participation_trend.map((w) => ({
                label: w.opens_at ? w.opens_at.split(",")[0] : w.window_id.slice(-6),
                value: w.participation_pct,
              }))}
              emptyLabel="No voting windows yet"
              valueSuffix="%"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Small horizontal bar chart — each item as a labeled row scaled to the max
// value in the set. Deliberately not a new dependency; this app has no
// charting library and these three cards don't need one.
function InsightBarCard({ title, icon, items, emptyLabel, valuePrefix = "", valueSuffix = "" }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        {icon}
        <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4">{emptyLabel}</p>
      ) : (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={`${item.label}-${i}`} className="text-xs">
              <div className="flex justify-between text-gray-600 mb-0.5">
                <span className="truncate pr-2">{item.label}</span>
                <span className="font-medium text-gray-800 shrink-0">{valuePrefix}{item.value}{valueSuffix}</span>
              </div>
              <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-pitch-500 rounded-full"
                  style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
