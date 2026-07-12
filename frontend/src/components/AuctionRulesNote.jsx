import { useState } from "react";
import { Info, ChevronDown, ChevronUp } from "lucide-react";

const GROUP_LABELS = {
  extra_power_allrounder: "Extra Power — All-Rounders",
  extra_power_batsman: "Extra Power — Batsmen",
  power: "Power",
  classic: "Classic",
};

// Pulls every number from the live auction response (points_budget,
// starting_price, session_minutes, group_quotas) instead of hardcoding a
// second copy — this can't drift out of sync with what auction.py actually
// enforces.
export default function AuctionRulesNote({ auction }) {
  const [open, setOpen] = useState(false);
  if (!auction) return null;

  const quotas = Object.entries(auction.group_quotas || {}).filter(([, q]) => q > 0);

  return (
    <div className="card">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 font-semibold text-gray-900 text-sm">
          <Info size={16} className="text-pitch-600" /> Auction Rules
        </span>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t space-y-3 text-xs text-gray-600">
          <div>
            <p className="font-semibold text-gray-800 mb-1">Points &amp; Pricing</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Every player starts at a base price of <strong>{auction.starting_price} pts</strong> — the base itself is never drawn from anyone's purse.</li>
              <li>Each captain has a <strong>{auction.points_budget}-point</strong> purse that only pays for the <em>extra</em> amount bid above the base.</li>
              <li>Bids go up in increments of 0.5, starting at base + 0.5.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-gray-800 mb-1">Categories &amp; Quotas (this auction)</p>
            <ul className="list-disc list-inside space-y-0.5">
              {quotas.map(([group, quota]) => (
                <li key={group}>{GROUP_LABELS[group] || group}: <strong>{quota}</strong> per captain</li>
              ))}
              <li>Extra Power All-Rounders and Batsmen are two separate pools, not one combined group.</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold text-gray-800 mb-1">Procedure</p>
            <ul className="list-disc list-inside space-y-0.5">
              <li>Admin releases the <strong>first</strong> player of each category by hand — who comes up within it is picked automatically (by batting/bowling average), never hand-picked. Every player after that releases itself automatically once the previous one's bidding resolves, until the category runs out.</li>
              <li>If both captains decline a player at the base price, that player becomes the <strong>last option</strong> in their category — offered again only after everyone else in it is resolved.</li>
              <li>The moment a captain's roster fills a category's quota, every remaining player in that category goes to the <strong>other</strong> captain for free.</li>
              <li>If a captain's points hit 0, the opponent can claim any remaining Power/Classic player for free (<strong>Free Pick</strong>) without bidding against them.</li>
              <li>Each auction runs for <strong>{auction.session_minutes} minutes</strong>. Whatever's still unresolved when time's up is split free, alternating so both captains end up even in every category.</li>
              <li>Once the auction completes, prices paid are confidential — only the final team rosters (names) remain visible.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
