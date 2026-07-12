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
    <span className={`text-xs font-semibold rounded-full px-3 py-1 flex items-center gap-1 ${
      expired ? "bg-gray-100 text-gray-600" : "bg-amber-100 text-amber-700"
    }`}>
      <Clock size={12} />
      {expired ? "Time's up" : `${mm}:${ss} left`}
    </span>
  );
}
