import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import PageBackgroundIcon from "../../components/PageBackgroundIcon";
import AvailabilityGrid from "../../components/AvailabilityGrid";
import adminIcon from "../../assets/dashboard-icons/bcc-icon-admin.png";
import { Download, RefreshCw, Users, BarChart2, Settings, ClipboardList } from "lucide-react";

export default function AdminDashboard() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const res = await api.get("/admin/dashboard");
      setData(res.data);
    } catch {
      toast.error("Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

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

  if (loading) return (
    <div className="min-h-screen"><Navbar />
      <div className="flex items-center justify-center h-64"><p className="text-gray-500">Loading…</p></div>
    </div>
  );

  const matrix = data?.vote_matrix || [];
  const slots = matrix[0]?.votes?.map((v) => ({ slot_number: parseInt(v.slot_label.replace("Slot ", "")), day: v.day, time_of_day: v.time_of_day })) || [];

  return (
    <div className="min-h-screen bg-cricket-cream isolate">
      <PageBackgroundIcon src={adminIcon} alt="" />
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
            <button onClick={fetchData} className="btn-secondary flex items-center gap-1.5 text-sm py-2 px-4">
              <RefreshCw size={15} /> Refresh
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

        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          {data?.slots?.map((slot) => (
            <div key={slot.slot_id} className="card text-center">
              <p className="text-xs font-medium text-gray-500 uppercase">{slot.day} {slot.time_of_day}</p>
              <span className={`inline-block text-[10px] font-semibold rounded-full px-2 py-0.5 mt-1 ${
                slot.window?.is_open ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"
              }`}>
                {slot.window?.is_open ? "OPEN" : "CLOSED"}
              </span>
              <p className="text-3xl font-bold text-pitch-600 mt-1">{slot.available}</p>
              <p className="text-xs text-gray-400">Available</p>
              <div className="flex justify-center gap-2 mt-2 text-xs text-gray-500">
                <span className="text-yellow-600">🤔 {slot.maybe}</span>
                <span className="text-red-600">❌ {slot.not_available}</span>
                <span className="text-gray-400">— {slot.no_response}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Voted count */}
        <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
          <Users size={16} />
          <span><strong>{data?.captains_voted}</strong> of <strong>{data?.captains_total}</strong> voters have voted</span>
        </div>

        {/* Full matrix */}
        <div className="card overflow-hidden p-0">
          <div className="flex items-center gap-2 px-6 py-4 border-b bg-gray-50">
            <BarChart2 size={18} className="text-pitch-600" />
            <h2 className="font-semibold text-gray-800">Captain × Slot Availability</h2>
          </div>
          <div className="p-4">
            <AvailabilityGrid matrix={matrix} slots={slots} />
          </div>
        </div>

        {/* Quick links */}
        <div className="flex gap-3 mt-6 flex-wrap">
          <Link to="/admin/captains" className="btn-secondary text-sm py-2 px-4">Manage Captains</Link>
          <Link to="/admin/players" className="btn-secondary text-sm py-2 px-4">Manage Players</Link>
          <Link to="/admin/window" className="btn-secondary text-sm py-2 px-4">Voting Windows</Link>
        </div>
      </div>
    </div>
  );
}
