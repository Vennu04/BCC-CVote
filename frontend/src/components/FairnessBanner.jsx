import { ShieldCheck } from "lucide-react";

export default function FairnessBanner() {
  return (
    <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
      <ShieldCheck size={14} className="text-pitch-600 shrink-0" />
      Players are released in a fixed, transparent order — no player is held back or prioritized manually. The full sequence is logged and viewable below.
    </div>
  );
}
