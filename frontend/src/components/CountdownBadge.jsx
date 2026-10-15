import { useState, useEffect } from "react";
import { Clock } from "lucide-react";

// Ticks once a second against a timezone-aware ISO deadline. Must be fed
// ends_at_iso, never the human-readable IST display string ("11 Jul 2026
// 11:47 PM IST") -- `new Date()` can't parse that and silently produces
// NaN:NaN, which is exactly the bug this component used to have back when
// it only lived inline in the captain-facing Auction page.
export default function CountdownBadge({ endsAtIso }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!endsAtIso) return null;
  const remainingMs = new Date(endsAtIso).getTime() - now;
  const expired = remainingMs <= 0;
  const totalSec = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
  const ss = String(totalSec % 60).padStart(2, "0");
  return (
    <span className={`rounded-xl px-3 py-1.5 flex items-center gap-1.5 font-display font-extrabold text-xl leading-none tabular-nums ${
      expired ? "bg-white/15 text-white" : remainingMs < 5 * 60 * 1000 ? "bg-[#c8102e] text-white" : "bg-white text-brand-navy"
    }`}>
      <Clock size={16} strokeWidth={2.4} aria-hidden="true" />
      {expired ? "Time's up" : `${mm}:${ss} left`}
    </span>
  );
}
