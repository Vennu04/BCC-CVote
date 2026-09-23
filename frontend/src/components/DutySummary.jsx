import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../utils/api";
import { useAuth } from "../context/AuthContext";
import { canDoDestructive } from "../utils/roles";
import { COVERAGE, nameOf, nextWeekendEvening, shortDay, slotLabelOf, todayIst } from "../utils/duty";
import { CalendarClock } from "lucide-react";

// One-line "who's on auction duty" strip. variant="dark" (the default) sits
// on the Control Centre (next weekend evening); variant="tonight" sits on the admin
// Auction page and only renders on an evening that actually has a rostered
// auction. Full admins only — the endpoint 403s for organizers, so they
// never see it. Non-critical: any failure just renders nothing.
export default function DutySummary({ variant = "dark" }) {
  const { user } = useAuth();
  const allowed = canDoDestructive(user);
  const [data, setData] = useState(null);

  useEffect(() => {
    if (!allowed) return;
    api.get("/admin/duty").then((res) => setData(res.data)).catch(() => {});
  }, [allowed]);

  if (!allowed || !data) return null;
  const today = todayIst();
  const evening = nextWeekendEvening(data.evenings, today);
  if (!evening) return null;
  if (variant === "tonight" && evening.auction_date !== today) return null;

  const coverage = COVERAGE[evening.coverage] || COVERAGE.nobody;
  const who = evening.lead_id
    ? `Lead ${nameOf(data.admins, evening.lead_id)} · Backup ${evening.backup_id ? nameOf(data.admins, evening.backup_id) : "still needed"} · starts ${slotLabelOf(data.slots, evening.start_slot)}`
    : "Lead and Backup not confirmed yet";

  if (variant === "tonight") {
    return (
      <div className="card flex items-start gap-3 border-l-4 border-l-pitch-500">
        <CalendarClock size={20} className="text-pitch-600 mt-0.5 shrink-0" />
        <div className="text-sm">
          <p className="font-semibold text-gray-900">Tonight&apos;s auction duty — {evening.match_label}</p>
          <p className="text-gray-700">{who}</p>
          <p className="text-xs text-gray-500 mt-1">Voting stays open until kick-off by default — press <b>Close Early</b> on the Window page before you create the auction.</p>
        </div>
      </div>
    );
  }

  return (
    <Link to="/manage/auction/duty" className="bg-white rounded-2xl shadow-soft p-4 flex items-center justify-between gap-3 flex-wrap hover:bg-gray-50 transition-colors duration-150">
      <div className="flex items-start gap-3">
        <CalendarClock size={20} className="text-amber-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-[11px] font-bold tracking-wider text-gray-500 uppercase">Next auction duty · {shortDay(evening.auction_date)}</p>
          <p className="text-sm font-bold text-gray-900">{evening.match_label}</p>
          <p className="text-xs text-gray-600">{who}</p>
        </div>
      </div>
      <span className={`text-xs font-semibold rounded-full border px-2.5 py-1 ${coverage.className}`}>{coverage.label}</span>
    </Link>
  );
}
