import { Link } from "react-router-dom";
import toast from "react-hot-toast";
import api from "../../utils/api";
import Navbar from "../../components/Navbar";
import ManageHeader from "../../components/ManageHeader";
import { useAuth } from "../../context/AuthContext";
import { canDoDestructive } from "../../utils/roles";
import { CalendarDays, Vote, PlusCircle, Users, ClipboardCheck, Gavel, FlaskConical, CalendarClock, BarChart3, Download, ChevronRight } from "lucide-react";

// Manage › All tools — every admin page from before the guided checklist,
// kept for anything unusual. Nothing was removed; This week just means you
// rarely need to come here.
const TOOLS = [
  { to: "/manage/matches/fixtures", icon: CalendarDays, title: "Fixtures & teams", text: "Dates, results, add or rename teams" },
  { to: "/manage/matches/windows", icon: Vote, title: "Voting times", text: "Open, close early or cancel a match" },
  { to: "/manage/matches/windows#extra", icon: PlusCircle, title: "Extra match", text: "A match on any date — rain day, holiday" },
  { to: "/manage/players/people", icon: Users, title: "People", text: "Groups, passwords, stats, add or remove" },
  { to: "/manage/players/attendance", icon: ClipboardCheck, title: "Attendance", text: "Ranking and the knockout list" },
  { to: "/manage/auction/run", icon: Gavel, title: "Run an auction", text: "Set up, start, reopen or finish" },
  { to: "/manage/auction/run#practice", icon: FlaskConical, title: "Practice auction", text: "Rehearse with anyone" },
  { to: "/manage/auction/duty", icon: CalendarClock, title: "Duty roster", text: "Everyone's evening slots", fullAdminOnly: true },
  { to: "/manage/tools/votes", icon: BarChart3, title: "Votes & insights", text: "Every voter × match, trends" },
];

const EXPORTS = [
  ["/admin/export/available-players", "BCC-Available-Players", "xlsx", "Available players (Excel)"],
  ["/admin/export/excel", "BCC-Availability", "xlsx", "All votes (Excel)"],
  ["/admin/export/csv", "BCC-Availability", "csv", "All votes (CSV)"],
];

async function download(endpoint, prefix, ext) {
  try {
    const res = await api.get(endpoint, { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
    toast.success(`${ext.toUpperCase()} downloaded`);
  } catch {
    toast.error("Download failed");
  }
}

export default function AllTools() {
  const { user } = useAuth();
  const tools = TOOLS.filter((t) => !t.fullAdminOnly || canDoDestructive(user));
  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <ManageHeader hub="tools" subtitle="Everything you can do in the app. For the usual weekly jobs, use This week." />
      <div className="max-w-3xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {tools.map(({ to, icon: Icon, title, text }) => (
            <Link key={to} to={to} className="flex items-center gap-3 bg-white rounded-2xl shadow-soft px-4 min-h-[76px] py-3 hover:bg-gray-50">
              <span className="w-11 h-11 shrink-0 rounded-2xl bg-brand-navy text-white grid place-items-center"><Icon size={20} /></span>
              <span className="flex-1 min-w-0">
                <span className="block font-black text-gray-900">{title}</span>
                <span className="block text-sm text-gray-600">{text}</span>
              </span>
              <ChevronRight size={18} className="text-gray-400" />
            </Link>
          ))}
        </div>
        <h2 className="text-xs font-black uppercase tracking-wider text-gray-500 mt-6 mb-2">Download</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {EXPORTS.map(([endpoint, prefix, ext, label]) => (
            <button key={label} type="button" onClick={() => download(endpoint, prefix, ext)}
              className="flex items-center gap-2 bg-white rounded-2xl shadow-soft px-4 min-h-[56px] font-bold text-gray-800 hover:bg-gray-50">
              <Download size={18} className="text-brand-navy" /> {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
