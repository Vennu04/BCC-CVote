import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Users, ChevronDown, ChevronUp } from "lucide-react";

// Same fixed order/labels as the auction pool view (Auction.jsx, admin/Auction.jsx)
// — kept in sync deliberately so a category reads the same everywhere in the app.
const GROUP_LABELS = {
  extra_power_allrounder: "Extra Power — All-Rounders",
  extra_power_batsman: "Extra Power — Batsmen",
  power: "Power",
  classic: "Classic",
};
const CATEGORY_ORDER = ["extra_power_allrounder", "extra_power_batsman", "power", "classic"];

// Pure computation, exported so callers that need just the numbers (e.g. a
// compact multi-slot comparison strip) don't have to render the full panel.
// excludeIds lets the auction setup screen preview what create_auction will
// actually see once two captains are picked (they're excluded from their own
// auction's pool the same way the backend excludes them).
//
// Captains are grouped by auction_category exactly like players — create_auction
// (backend) counts every available voter by category regardless of role, and
// only excludes the two captains actually running that draft (via excludeIds).
// A captain-role person sitting in a separate "Captains" bucket here used to
// make the per-category odd/even counts (and the ⚠️ odd warning) diverge from
// what the backend would actually see, silently hiding imbalance until
// create_auction rejected it.
export function confirmedForSlot(voteMatrix, slotId, excludeIds) {
  const categories = {};
  CATEGORY_ORDER.forEach((cat) => { categories[cat] = { confirmed: [], pending: [] }; });
  let uncategorizedConfirmed = 0;

  voteMatrix.forEach((row) => {
    const person = row.captain; // vote_matrix's row key — captain or player, both use _user_to_dict
    if (excludeIds?.has(person.id)) return;

    const vote = row.votes.find((v) => v.slot_id === slotId);
    const isConfirmed = vote?.availability === "available";

    const cat = person.auction_category;
    if (cat && categories[cat]) {
      (isConfirmed ? categories[cat].confirmed : categories[cat].pending).push(person);
    } else if (isConfirmed) {
      uncategorizedConfirmed += 1;
    }
  });

  const totalConfirmed =
    CATEGORY_ORDER.reduce((sum, cat) => sum + categories[cat].confirmed.length, 0) +
    uncategorizedConfirmed;

  return { categories, uncategorizedConfirmed, totalConfirmed };
}

function NameChips({ people, tone }) {
  if (people.length === 0) return <p className="text-xs text-gray-400 italic">None yet</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {people.map((p) => (
        <span
          key={p.id}
          className={`text-xs rounded-full px-2.5 py-1 ${
            tone === "pending" ? "bg-gray-50 text-gray-400 border border-gray-200" : "bg-gray-100 text-gray-700"
          }`}
        >
          {p.name}{p.role === "captain" ? " (C)" : ""}{p.team_name ? ` — ${p.team_name}` : ""}
        </span>
      ))}
    </div>
  );
}

// Renders live turnout for one slot, grouped exactly like the auction pool
// view: the 4 auction categories in a fixed order, captains and players mixed
// in together by category (a category with zero confirmed still shows up, so
// admin gets a stable layout to compare against). Odd/missing-category flags
// mirror the same wording admin/Auction.jsx already uses for create_auction's
// quota check.
export default function ConfirmedPlayersPanel({ voteMatrix, slotId, excludeIds, compact }) {
  const [showPending, setShowPending] = useState(false);
  const data = useMemo(() => confirmedForSlot(voteMatrix, slotId, excludeIds), [voteMatrix, slotId, excludeIds]);

  const pendingTotal = CATEGORY_ORDER.reduce((sum, cat) => sum + data.categories[cat].pending.length, 0);

  return (
    <div className={compact ? "" : "rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5"}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
          <Users size={13} /> Confirmed ({data.totalConfirmed})
        </p>
        {/* Names (and so the pending toggle) aren't shown in compact mode at all —
            it's counts-only for glancing across multiple slots — so skip rendering
            a button here entirely rather than one that would do nothing, or worse,
            nest inside a slot-card that's itself a <button> (VotingWindow's compare
            strip) and break click handling. */}
        {!compact && pendingTotal > 0 && (
          <button
            type="button"
            onClick={() => setShowPending((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            {pendingTotal} yet to vote {showPending ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        )}
      </div>

      <div className={compact ? "grid grid-cols-2 gap-2" : "space-y-2.5"}>
        {CATEGORY_ORDER.map((cat) => {
          const { confirmed, pending } = data.categories[cat];
          const odd = confirmed.length % 2 !== 0;
          return (
            <div key={cat}>
              <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${odd ? "text-red-600" : "text-gray-500"}`}>
                {GROUP_LABELS[cat]}{" "}
                <span className={odd ? "normal-case font-semibold" : "text-gray-400 normal-case font-normal"}>
                  ({confirmed.length}{odd && " ⚠️ odd"})
                </span>
              </p>
              {!compact && <NameChips people={confirmed} />}
              {!compact && showPending && pending.length > 0 && (
                <div className="mt-1"><NameChips people={pending} tone="pending" /></div>
              )}
            </div>
          );
        })}
      </div>

      {!compact && data.uncategorizedConfirmed > 0 && (
        <p className="text-xs text-red-600 mt-2">
          ⚠️ {data.uncategorizedConfirmed} confirmed player(s) have no category set.{" "}
          <Link to="/admin/people" className="underline">Manage People</Link>
        </p>
      )}
    </div>
  );
}
