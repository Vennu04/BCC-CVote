import { ListOrdered } from "lucide-react";
import { statLine, groupUpcoming, stillNeeded } from "../utils/upcoming";

const GROUP_LABELS = {
  extra_power_allrounder: "Extra Power — All-Rounders",
  extra_power_batsman: "Extra Power — Batsmen",
  power: "Power",
  classic: "Classic",
};

// Small strip under the player on the block: the next few names in release
// order, plus a way into the full list.
export function NextUpStrip({ upcoming, onSeeAll, count = 3 }) {
  if (!upcoming?.length) return null;
  return (
    <div className="card py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wide text-gray-500 flex items-center gap-1.5"><ListOrdered size={14} /> Next up</p>
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="text-sm font-bold text-pitch-700 min-h-[36px] px-1">
            See all ({upcoming.length}) ›
          </button>
        )}
      </div>
      <ol className="mt-1 space-y-1">
        {upcoming.slice(0, count).map((p) => (
          <li key={p.id} className="flex items-baseline gap-2 text-sm">
            <span className="w-5 shrink-0 text-right font-black text-gray-400 tabular-nums">{p.position}</span>
            <span className="font-bold text-gray-900">{p.name}</span>
            <span className="text-xs text-gray-500 truncate">{GROUP_LABELS[p.category] || p.category}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Full queue grouped by category, in the order players will come up.
// `me` (the viewing captain's summary) adds "you need N more" per group.
export default function UpcomingPlayers({ upcoming, me, quotas, pending }) {
  const groups = groupUpcoming(upcoming);
  return (
    <div className="card">
      <h3 className="font-bold text-gray-900 text-sm">Coming up — in release order</h3>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">
        {pending ? "This is the order players will come up once the auction starts." : "Players come up in this order."}{" "}
        If both captains pass on someone, they move to the end of their group.
      </p>
      {groups.length === 0 && <p className="text-sm text-gray-400 italic">Nobody left to come up.</p>}
      <div className="space-y-4">
        {groups.map((g, gi) => {
          const need = stillNeeded(me, quotas, g.category);
          return (
            <div key={`${g.category}-${gi}`}>
              <div className="flex items-baseline justify-between gap-2 mb-1.5 border-b border-gray-100 pb-1">
                <p className="text-xs font-black uppercase tracking-wide text-brand-navy">
                  {GROUP_LABELS[g.category] || g.category} <span className="text-gray-400 normal-case font-semibold">({g.players.length})</span>
                </p>
                {need != null && (
                  <span className={`text-xs font-bold ${need > 0 ? "text-pitch-700" : "text-gray-400"}`}>
                    {need > 0 ? `You need ${need} more` : "Your group is full"}
                  </span>
                )}
              </div>
              <ol className="space-y-1.5">
                {g.players.map((p) => {
                  const stats = statLine(p);
                  return (
                    <li key={p.id} className="flex items-start gap-2">
                      <span className="w-6 shrink-0 text-right text-sm font-black text-gray-400 tabular-nums">{p.position}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-gray-900">
                          {p.name}
                          {p.deprioritized && <span className="ml-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 rounded-full px-1.5 py-0.5">passed once</span>}
                        </p>
                        {stats && <p className="text-xs text-gray-500">{stats}</p>}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          );
        })}
      </div>
    </div>
  );
}
