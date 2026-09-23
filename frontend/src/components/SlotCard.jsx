import { useState } from "react";
import WeatherForecast from "./WeatherForecast";
import { TeamsVs } from "./TeamCrest";
import { useCountdown } from "../hooks/useCountdown";
import { formatDateDisplay } from "../utils/formatDate";
import { Clock, Lock, AlertTriangle, Users, ChevronDown, ChevronUp, Check, X } from "lucide-react";

// One match on Home, Stumps-style: teams face-off on top, status chip,
// weather, then the two vote buttons. Same behaviour as before the redesign
// — only the look changed.

function WindowStatus({ windowInfo }) {
  const { hours, minutes, expired } = useCountdown(windowInfo?.seconds_remaining);

  if (windowInfo?.is_cancelled) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-red-700 bg-red-50 rounded-full px-2.5 py-1">
        <AlertTriangle size={11} />
        Match Cancelled{windowInfo.cancel_reason ? ` — ${windowInfo.cancel_reason}` : ""}
      </span>
    );
  }

  if (!windowInfo?.is_open) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-600 bg-gray-100 rounded-full px-2.5 py-1">
        <Lock size={11} />
        {windowInfo?.closes_at ? `Closed — was open till ${windowInfo.closes_at}` : "Voting not open"}
        {windowInfo?.can_revoke && windowInfo?.revoke_deadline ? ` · can withdraw until ${windowInfo.revoke_deadline}` : ""}
      </span>
    );
  }

  const urgency = !expired && hours === 0 && minutes < 30;
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-bold rounded-full px-2.5 py-1 ${
      urgency ? "bg-red-50 text-red-700" : "bg-pitch-50 text-pitch-700"}`}>
      <Clock size={11} />
      Closes in {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}
    </span>
  );
}

export default function SlotCard({ slot, currentVote, onVote, disabled, loading, windowInfo, onRevoke, revoking, availablePlayers }) {
  const [showAvailable, setShowAvailable] = useState(false);
  const showRevoke = currentVote && windowInfo?.can_revoke;
  const hasTeams = slot.team_a_name && slot.team_b_name;
  const when = [
    slot.day,
    slot.resolved_match_date ? formatDateDisplay(slot.resolved_match_date) : "",
    slot.match_time || slot.time_of_day,
  ].filter(Boolean).join(" · ");

  return (
    <div className="bg-white rounded-2xl shadow-soft p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-gray-500 pt-1">
          {slot.group ? `Group ${slot.group} · ` : ""}{when}
        </p>
        {windowInfo && <WindowStatus windowInfo={windowInfo} />}
      </div>

      {hasTeams ? (
        <TeamsVs a={slot.team_a_name} b={slot.team_b_name} />
      ) : (
        <p className="font-extrabold text-gray-900 text-lg my-2">{slot.description || `${slot.time_of_day} Match`}</p>
      )}

      {currentVote && (
        <p className={`text-xs font-bold mb-2 ${
          currentVote === "available" ? "text-pitch-700" : currentVote === "not_available" ? "text-red-700" : "text-amber-700"}`}>
          {currentVote === "available" ? "✅ You're in" : currentVote === "not_available" ? "❌ You can't play" : "🤔 Maybe"}
        </p>
      )}

      <div className="rounded-lg overflow-hidden">
        <WeatherForecast weather={slot.weather} />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onVote(slot.id, "available")}
          disabled={disabled || loading}
          aria-pressed={currentVote === "available"}
          className={`flex-1 min-h-[46px] rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 border-2 transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${
            currentVote === "available" ? "bg-pitch-700 border-pitch-700 text-white" : "bg-white border-pitch-200 text-pitch-700 hover:bg-pitch-50"}`}
        >
          <Check size={16} /> I'm in
        </button>
        <button
          type="button"
          onClick={() => onVote(slot.id, "not_available")}
          disabled={disabled || loading}
          aria-pressed={currentVote === "not_available"}
          className={`flex-1 min-h-[46px] rounded-xl font-bold text-sm flex items-center justify-center gap-1.5 border-2 transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${
            currentVote === "not_available" ? "bg-red-600 border-red-600 text-white" : "bg-white border-red-200 text-red-700 hover:bg-red-50"}`}
        >
          <X size={16} /> Can't play
        </button>
      </div>

      {/* Who's in — only revealed once you've cast your own vote */}
      {availablePlayers && (
        <div className="mt-3 pt-2 border-t border-gray-100">
          <button
            type="button"
            onClick={() => setShowAvailable((v) => !v)}
            className="flex items-center gap-1.5 text-xs font-bold text-brand-navy min-h-[44px] -my-1"
          >
            <Users size={14} />
            {availablePlayers.length} in
            {showAvailable ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {showAvailable && (
            <p className="text-xs text-gray-600">
              {availablePlayers.length ? availablePlayers.join(", ") : "No one yet — be the first!"}
            </p>
          )}
        </div>
      )}

      {/* Emergency revoke — withdraw an existing vote, even after the window closes */}
      {showRevoke && (
        <button
          onClick={() => onRevoke(slot.id)}
          disabled={revoking}
          title={windowInfo.revoke_deadline ? `Available until ${windowInfo.revoke_deadline}` : undefined}
          className="mt-2 w-full min-h-[44px] flex items-center justify-center gap-1.5 text-xs font-semibold text-amber-800 bg-amber-50 rounded-xl hover:bg-amber-100 active:scale-[0.98] disabled:opacity-50 transition-all duration-150"
        >
          <AlertTriangle size={12} />
          {revoking ? "Withdrawing…" : "Emergency — Remove My Name"}
        </button>
      )}
    </div>
  );
}
