import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import api from "../utils/api";
import Navbar from "../components/Navbar";
import PageHeader from "../components/PageHeader";
import { useMyAuction } from "../hooks/useMyAuction";
import { Gavel } from "lucide-react";

// The rules auction.py enforces — the numbers are admin-editable (All tools ›
// Settings) and read live from /settings/auction-rules; these defaults only
// show until that answers.
const DEFAULT_RULES = { points_budget: 17, starting_price: 8.5, session_minutes: 25, release_timeout_seconds: 30, min_pool_size: 20, max_per_side: 14 };
const rulesText = (r) => [
  ["Purse", `${r.points_budget} points per captain. Only the amount above the base price comes out of it.`],
  ["Base price", `${r.starting_price} for every player. The opening bid can be the base itself.`],
  ["Raises", "At least 0.5 above the current bid."],
  ["Clock", `${r.session_minutes} minutes from the start. Anyone left at the end is shared out equally, free.`],
  ["Idle player", `No bid or drop for ${r.release_timeout_seconds} seconds → passed, and offered again at the end of its category.`],
  ["Order", "Extra Power All-rounders → Extra Power Batsmen → Power → Classic, in a fixed stats-based order."],
  ["Fair split", "Each captain gets half of every category. Once your half is full, the rest go to the other side free."],
  ["Free pick", "If a captain's points run out, the other can take any remaining player free — up to their own half."],
  ["Pool", `At least ${r.min_pool_size} players, at most ${r.max_per_side} per side. Captains are never in the pool.`],
];

// Auction tab when no auction is live — jumps straight into a live one.
export default function AuctionHome() {
  const liveAuctionId = useMyAuction();
  const [rules, setRules] = useState(DEFAULT_RULES);
  useEffect(() => { api.get("/settings/auction-rules").then((r) => setRules(r.data.rules)).catch(() => {}); }, []);
  if (liveAuctionId) return <Navigate to={`/auction/${liveAuctionId}`} replace />;

  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <PageHeader title="Auction" subtitle="Live bidding for each match's teams" />
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        <div className="bg-white rounded-2xl shadow-soft p-5 text-center">
          <Gavel className="mx-auto text-gray-300 mb-2" size={36} />
          <p className="font-bold text-gray-900">No live auction right now</p>
          <p className="text-sm text-gray-500 mt-1">When an auction you're part of goes live, this tab shows a red dot and opens it straight away.</p>
        </div>
        <div className="bg-white rounded-2xl shadow-soft p-4">
          <h2 className="font-black text-gray-900 mb-2">How the auction works</h2>
          <dl className="divide-y divide-gray-100">
            {rulesText(rules).map(([k, v]) => (
              <div key={k} className="py-2 grid grid-cols-[6.5rem_1fr] gap-3 text-sm">
                <dt className="font-bold text-gray-700">{k}</dt>
                <dd className="text-gray-600">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
}
