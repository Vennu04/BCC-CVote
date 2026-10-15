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
      <span className="inline-flex items-center gap-1.5 text-xs font-extrabold rounded-full px-2.5 py-1 text-[#a1251b] bg-[#fce8e6]">
        <AlertTriangle size={12} />
        Match Cancelled{windowInfo.cancel_reason ? ` — ${windowInfo.cancel_reason}` : ""}
      </span>
    );
  }

  if (windowInfo?.not_yet_open) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-extrabold rounded-full px-2.5 py-1 text-[#334155] bg-[#e6e9ee]">
        <Clock size={12} />
        Voting opens {windowInfo.opens_at}
      </span>
    );
  }

  if (!windowInfo?.is_open) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-extrabold rounded-full px-2.5 py-1 text-[#334155] bg-[#e6e9ee]">
        <Lock size={12} />
        {windowInfo?.closes_at ? `Voting closed ${windowInfo.closes_at}` : "Voting not open"}
        {windowInfo?.can_revoke && windowInfo?.revoke_deadline ? ` · you can still pull out until ${windowInfo.revoke_deadline}` : ""}
      </span>
    );
  }

  const urgency = !expired && hours === 0 && minutes < 30;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-extrabold rounded-full px-2.5 py-1 ${
      urgency ? "bg-[#fce8e6] text-[#a1251b]" : "bg-[#fff3d1] text-[#7a4f00]"}`}>
      <Clock size={12} />
      Voting closes in {hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`}
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
    <div className="bg-white rounded-2xl shadow-soft p-4 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-brand-muted pt-1">
          {slot.group ? `Group ${slot.group} · ` : ""}{when}
        </p>
        {windowInfo && <WindowStatus windowInfo={windowInfo} />}
      </div>

      {hasTeams ? (
        <TeamsVs a={slot.team_a_name} b={slot.team_b_name} />
      ) : (
        <p className="font-extrabold text-brand-ink text-xl">{slot.description || `${slot.time_of_day} Match`}</p>
      )}

      {currentVote ? (
        <p className={`inline-flex items-center gap-1.5 text-sm font-extrabold ${
          currentVote === "available" ? "text-pitch-700" : currentVote === "not_available" ? "text-[#a1251b]" : "text-[#7a4f00]"}`}>
          {currentVote === "available" ? <><Check size={16} strokeWidth={3} /> You're in</> : currentVote === "not_available" ? <><X size={16} strokeWidth={3} /> You can't play</> : <><Clock size={16} /> Maybe</>}
        </p>
      ) : (
        !disabled && <p className="text-[15px] font-bold text-brand-ink">Are you playing?</p>
      )}

      <div className="rounded-lg overflow-hidden">
        <WeatherForecast weather={slot.weather} />
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button
          type="button"
          onClick={() => onVote(slot.id, "available")}
          disabled={disabled || loading}
          aria-pressed={currentVote === "available"}
          className={`min-h-[52px] rounded-2xl font-extrabold text-base flex items-center justify-center gap-1.5 border-2 transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${
            currentVote === "available" ? "bg-pitch-700 border-pitch-700 text-white" : "bg-white border-pitch-700 text-pitch-700 hover:bg-pitch-50"}`}
        >
          <Check size={18} strokeWidth={2.6} /> I'm in
        </button>
        <button
          type="button"
          onClick={() => onVote(slot.id, "not_available")}
          disabled={disabled || loading}
          aria-pressed={currentVote === "not_available"}
          className={`min-h-[52px] rounded-2xl font-extrabold text-base flex items-center justify-center gap-1.5 border-2 transition-all duration-150 active:scale-[0.97] disabled:opacity-50 disabled:active:scale-100 ${
            currentVote === "not_available" ? "bg-[#b42318] border-[#b42318] text-white" : "bg-white border-brand-line text-[#a1251b] hover:bg-[#fce8e6]"}`}
        >
          <X size={18} strokeWidth={2.6} /> Can't play
        </button>
      </div>

      {/* Who's in — only revealed once you've cast your own vote */}
      {availablePlayers && (
        <div className="mt-1 pt-1 border-t border-brand-line">
          <button
            type="button"
            onClick={() => setShowAvailable((v) => !v)}
            aria-expanded={showAvailable}
            className="w-full flex items-center justify-between gap-1.5 text-sm min-h-[44px]"
          >
            <span className="flex items-center gap-2">
              <Users size={16} className="text-brand-muted" />
              <span className="font-display font-extrabold text-2xl leading-none text-pitch-700">{availablePlayers.length}</span>
              <span className="text-brand-muted">in so far</span>
            </span>
            <span className="flex items-center gap-1 font-bold text-brand-navy">{showAvailable ? "Hide" : "See who"} {showAvailable ? <ChevronUp size={15} /> : <ChevronDown size={15} />}</span>
          </button>
          {showAvailable && (
            <p className="text-sm text-brand-ink leading-relaxed pb-1">
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
          className="w-full min-h-[48px] flex items-center justify-center gap-1.5 text-sm font-bold text-[#7a4f00] bg-[#fff3d1] rounded-xl hover:bg-[#ffeab0] active:scale-[0.98] disabled:opacity-50 transition-all duration-150"
        >
          <AlertTriangle size={15} />
          {revoking ? "Removing…" : "I can't come any more"}
        </button>
      )}
    </div>
  );
}
