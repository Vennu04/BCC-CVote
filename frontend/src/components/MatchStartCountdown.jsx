import { useState, useEffect } from "react";
import { Timer } from "lucide-react";

// Sibling to CountdownBadge, not a reuse of it — that one ticks every second
// for live-auction bidding urgency; a "time until match start" countdown has
// no split-second stakes, so this ticks once a minute and shows day/hour
// granularity instead of MM:SS. Must be fed a timezone-aware ISO string
// (match_starts_at_iso from GET /admin/window), same caveat as CountdownBadge.
export default function MatchStartCountdown({ startsAtIso }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);
  if (!startsAtIso) return null;

  const remainingMs = new Date(startsAtIso).getTime() - now;
  // The backend already drops a slot from the response once its match has
  // started — this only covers the narrow gap before the next poll catches
  // up, so it reads as "starting now" rather than a negative countdown.
  if (remainingMs <= 0) {
    return (
      <span className="text-xs font-semibold rounded-full px-3 py-1 flex items-center gap-1 bg-amber-100 text-amber-700">
        <Timer size={12} /> Match starting now
      </span>
    );
  }

  const totalMinutes = Math.floor(remainingMs / 60000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const label = days > 0
    ? `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`
    : `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;

  return (
    <span className="text-xs font-semibold rounded-full px-3 py-1 flex items-center gap-1 bg-blue-100 text-blue-700">
      <Timer size={12} /> Starts in {label}
    </span>
  );
}
