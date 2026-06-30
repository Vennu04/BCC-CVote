import { useCountdown } from "../hooks/useCountdown";
import { Clock } from "lucide-react";

export default function CountdownTimer({ secondsRemaining, closesAt }) {
  const { hours, minutes, secs, expired, formatted } = useCountdown(secondsRemaining);

  if (expired) {
    return (
      <div className="flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-2.5 text-sm font-medium">
        <Clock size={16} />
        <span>Voting window has closed</span>
      </div>
    );
  }

  const urgency = hours === 0 && minutes < 30;

  return (
    <div className={`flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm font-medium border
      ${urgency ? "bg-red-50 border-red-200 text-red-700" : "bg-green-50 border-green-200 text-green-700"}`}>
      <Clock size={16} className="flex-shrink-0" />
      <div>
        <span>Voting closes in </span>
        <span className="font-mono font-bold text-base tracking-widest">{formatted}</span>
        {closesAt && <span className="text-xs ml-2 opacity-75">({closesAt})</span>}
      </div>
    </div>
  );
}
