import { CheckCircle2, XCircle, Shield } from "lucide-react";
import { CATEGORY_LABELS as GROUP_LABELS } from "../utils/categories";


function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-brand-muted uppercase tracking-wide">{label}</p>
      <p className="font-display font-bold text-xl leading-tight text-brand-ink">{value ?? "—"}</p>
    </div>
  );
}

// Auto-populates from data that already exists elsewhere (Manage Players'
// stats, the same next-match vote data the Players dashboard tag uses) --
// nothing here is manually entered per release. Fails closed (renders
// nothing) rather than a half-built card if insights/release_order are
// ever missing from the response, e.g. an older cached poll result.
export default function PlayerInsightsCard({ player }) {
  if (!player?.insights || !player?.release_order) return null;
  const { insights, release_order: ro } = player;

  return (
    <div className="card !p-4">
      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Shield size={15} className="text-cricket-navy" />
          <h3 className="font-extrabold text-brand-ink">Player insights</h3>
        </div>
        <span className="text-xs font-medium text-brand-muted bg-gray-100 rounded-full px-2.5 py-1 capitalize">
          {insights.role || "player"}
        </span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <Stat label="Bat Avg" value={insights.batting_average} />
        <Stat label="Strike Rate" value={insights.strike_rate} />
        <Stat label="Bowl Avg" value={insights.bowling_average} />
        <Stat label="Economy" value={insights.economy} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-3 text-xs">
        {insights.attendance_percentage != null && (
          <span className="text-brand-muted">
            Attendance: <strong className="text-gray-800">{insights.attendance_percentage}%</strong>
            {" "}({insights.matches_present ?? 0}/{insights.total_matches ?? 0})
          </span>
        )}
        {insights.team_name && (
          <span className="text-brand-muted">Team: <strong className="text-gray-800">{insights.team_name}</strong></span>
        )}
        <span className={`flex items-center gap-1 font-medium rounded-full px-2 py-0.5 ${
          insights.next_match_available ? "bg-green-100 text-green-700" : "bg-red-50 text-red-600"
        }`}>
          {insights.next_match_available ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {insights.next_match_available ? "Available" : "Not Available"}
          {insights.next_match_label && <span className="opacity-70">— {insights.next_match_label}</span>}
        </span>
      </div>

      <div className="border-t pt-2.5 text-xs text-brand-muted">
        <p>
          <strong className="text-gray-700">Release order:</strong>{" "}
          {ro.index} of {ro.of_total} overall · {ro.category_index} of {ro.category_of_total} in {GROUP_LABELS[ro.category] || ro.category}
        </p>
        {ro.why && (
          <p className="mt-1">
            <strong className="text-gray-700">Why here:</strong> {ro.why}
          </p>
        )}
      </div>
    </div>
  );
}
