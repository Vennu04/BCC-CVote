import { ListOrdered } from "lucide-react";
import { statLine, groupUpcoming, stillNeeded } from "../utils/upcoming";
import CategoryTag from "./CategoryTag";


// Small strip under the player on the block: the next few names in release
// order, plus a way into the full list.
export function NextUpStrip({ upcoming, onSeeAll, count = 3 }) {
  if (!upcoming?.length) return null;
  return (
    <div className="card py-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wide text-brand-muted flex items-center gap-1.5"><ListOrdered size={14} /> Next up</p>
        {onSeeAll && (
          <button type="button" onClick={onSeeAll} className="text-sm font-bold text-brand-navy underline underline-offset-2 min-h-[44px] px-1">
            See all ({upcoming.length}) ›
          </button>
        )}
      </div>
      <ol className="mt-1 space-y-1">
        {upcoming.slice(0, count).map((p) => (
          <li key={p.id} className="flex items-center gap-2 text-[15px] min-h-[32px]">
            <span className="w-5 shrink-0 text-right font-black text-brand-muted tabular-nums">{p.position}</span>
            <span className="font-bold text-brand-ink">{p.name}</span>
            <CategoryTag category={p.category} className="ml-auto" />
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
      <h3 className="font-extrabold text-brand-ink">Coming up — in release order</h3>
      <p className="text-xs text-brand-muted mt-0.5 mb-3">
        {pending ? "This is the order players will come up once the auction starts." : "Players come up in this order."}{" "}
        If both captains pass on someone, they move to the end of their group.
      </p>
      {groups.length === 0 && <p className="text-sm text-brand-muted italic">Nobody left to come up.</p>}
      <div className="space-y-4">
        {groups.map((g, gi) => {
          const need = stillNeeded(me, quotas, g.category);
          return (
            <div key={`${g.category}-${gi}`}>
              <div className="flex items-center justify-between gap-2 mb-1.5 border-b border-brand-line pb-1.5">
                <p className="flex items-center gap-2">
                  <CategoryTag category={g.category} full /> <span className="text-xs text-brand-muted font-semibold">({g.players.length})</span>
                </p>
                {need != null && (
                  <span className={`text-xs font-bold ${need > 0 ? "text-pitch-700" : "text-brand-muted"}`}>
                    {need > 0 ? `You need ${need} more` : "Your group is full"}
                  </span>
                )}
              </div>
              <ol className="space-y-1.5">
                {g.players.map((p) => {
                  const stats = statLine(p);
                  return (
                    <li key={p.id} className="flex items-start gap-2">
                      <span className="w-6 shrink-0 text-right text-sm font-black text-brand-muted tabular-nums">{p.position}</span>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-brand-ink">
                          {p.name}
                          {p.deprioritized && <span className="ml-1.5 text-[11px] font-bold text-[#7a4f00] bg-[#fff3d1] rounded-full px-1.5 py-0.5">passed once</span>}
                        </p>
                        {stats && <p className="text-xs text-brand-muted">{stats}</p>}
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
