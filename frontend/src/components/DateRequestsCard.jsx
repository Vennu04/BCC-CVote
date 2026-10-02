import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../utils/api";
import { CalendarCheck, ChevronRight } from "lucide-react";

// Home / This week: one tappable strip when match-date requests need you
// (captains), or are waiting on captains (admins). Hidden when there's
// nothing to do. Opens /schedule.
export default function DateRequestsCard({ admin = false }) {
  const [data, setData] = useState(null);
  useEffect(() => {
    Promise.all([api.get("/schedule/proposals"), api.get("/schedule/fixtures")])
      .then(([p, f]) => setData({ proposals: p.data.proposals || [], fixtures: f.data.fixtures || [] }))
      .catch(() => setData(null));
  }, []);
  if (!data) return null;

  const needMe = data.proposals.filter((p) => p.my_turn && p.my_ticks == null);
  const open = data.proposals.length;
  const canSuggest = data.fixtures.filter((f) => !f.date && !f.open_proposal_id).length;

  let title;
  let text;
  if (needMe.length) {
    title = `📅 ${needMe.length} match date${needMe.length > 1 ? "s" : ""} need your answer`;
    text = needMe.map((p) => p.label).join(" · ");
  } else if (admin && open) {
    title = `📅 ${open} date request${open > 1 ? "s" : ""} waiting for captains`;
    text = "See who has answered, or fix a date yourself";
  } else if (!admin && canSuggest) {
    title = "📅 Fix your match date";
    text = "Suggest up to 3 dates — once both captains agree, the match is set";
  } else {
    return null;
  }
  return (
    <Link to="/schedule" className="flex items-center gap-3 bg-white rounded-2xl shadow-soft px-4 py-3 min-h-[64px] ring-2 ring-brand-gold">
      <CalendarCheck size={22} className="text-brand-navy shrink-0" />
      <span className="flex-1 min-w-0">
        <span className="block font-black text-gray-900">{title}</span>
        <span className="block text-sm text-gray-600 truncate">{text}</span>
      </span>
      <ChevronRight size={20} className="text-gray-400 shrink-0" />
    </Link>
  );
}
