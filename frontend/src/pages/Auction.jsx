import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";
import { useAuction } from "../hooks/useAuction";
import { Gavel, ThumbsDown, Clock, Trophy, Gift } from "lucide-react";

const GROUP_LABELS = {
  extra_power_allrounder: "Extra Power — All-Rounders",
  extra_power_batsman: "Extra Power — Batsmen",
  power: "Power",
  classic: "Classic",
};

function CountdownBadge({ endsAtIso }) {
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

function CaptainCard({ summary, isYou, startingPrice }) {
  if (!summary) return null;
  return (
    <div className={`card ${isYou ? "border-2 border-pitch-400" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-gray-900">{summary.name}{isYou && " (You)"}</h3>
        <span className="text-sm font-semibold text-pitch-700">{summary.points_remaining} pts left</span>
      </div>
      <p className="text-xs text-gray-500 mb-2">{summary.roster_count} players picked</p>
      <div className="space-y-1 mb-3">
        {Object.entries(summary.group_counts || {}).map(([group, count]) => (
          <div key={group} className="flex items-center justify-between text-xs text-gray-600">
            <span>{GROUP_LABELS[group] || group}</span>
            <span className="font-medium">{count}</span>
          </div>
        ))}
      </div>
      {summary.roster?.length > 0 && (
        <div className="border-t pt-2 space-y-1">
          {summary.roster.map((p) => (
            <div key={p.user_id} className="flex items-center justify-between text-xs">
              <span className="text-gray-800">{p.name}</span>
              <span className="text-gray-400">
                {p.assigned_via === "leftover_free" || p.assigned_via === "free_pick"
                  ? "free"
                  // p.price is the full sold price (base + extra) — only the extra
                  // actually comes out of the 17-pt budget, so showing just "X pts"
                  // here reads as a budget overspend when it isn't one.
                  : `${p.price} (${(p.price - startingPrice).toFixed(1)} pts used)`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Auction() {
  const { id } = useParams();
  const { user } = useAuth();
  const { auction, loading, bidding, dropping, freePicking, placeBid, dropCurrentPlayer, freePick } = useAuction(id);
  const [amount, setAmount] = useState("");

  const isParticipant = useMemo(() => {
    if (!auction || !user) return false;
    return [auction.captain_a?.captain_id, auction.captain_b?.captain_id].includes(user.id);
  }, [auction, user]);

  // Once the OTHER captain's purse is fully drained, Power/Classic players can be
  // claimed for free instead of going through the normal bid/drop cycle — they
  // literally can't contest anything anymore below the 8.5 starting price.
  const otherCaptainDrained = useMemo(() => {
    if (!auction || !user) return false;
    const other = auction.captain_a?.captain_id === user.id ? auction.captain_b : auction.captain_a;
    return !!other?.is_drained;
  }, [auction, user]);

  const freePickable = useMemo(() => {
    if (!isParticipant || !otherCaptainDrained) return [];
    return (auction.available_players || []).filter((p) => p.category === "power" || p.category === "classic");
  }, [auction, isParticipant, otherCaptainDrained]);

  const myRemaining = useMemo(() => {
    if (!auction || !user) return null;
    const mine = auction.captain_a?.captain_id === user.id ? auction.captain_a : auction.captain_b;
    return mine?.points_remaining ?? null;
  }, [auction, user]);

  // The 17-point purse only ever pays for the extra amount above the 8.5
  // base — the base itself is never drawn from it — so the highest TOTAL
  // bid a captain can actually afford is base + however much extra they
  // have left, not just their remaining extra-points figure on its own.
  const myMaxBid = useMemo(() => {
    if (!auction || myRemaining == null) return null;
    return auction.starting_price + myRemaining;
  }, [auction, myRemaining]);

  useEffect(() => {
    if (auction?.current_player) {
      const floor = auction.current_player.current_high_bid;
      const suggested = myMaxBid != null ? Math.min(floor + 0.5, myMaxBid) : floor + 0.5;
      setAmount(String(suggested));
    }
  }, [auction?.current_player?.id, auction?.current_player?.current_high_bid, myMaxBid]);

  // Notify both captains of the updated points balance after every bid/
  // free-pick/leftover-award — not just the silently-refreshing numbers on
  // the cards above, so nobody has to go looking for it mid-auction. A mere
  // "drop" (declining a player) doesn't change anyone's points or roster, so
  // it's deliberately silent — no confirmation, no notification, just an
  // instant no-friction click.
  const feedBaselineRef = useRef(null);
  useEffect(() => {
    const feed = auction?.bid_feed;
    if (!feed || !isParticipant) return;
    if (feedBaselineRef.current === null) {
      feedBaselineRef.current = feed.length;
      return;
    }
    if (feed.length > feedBaselineRef.current) {
      const newEntries = feed.slice(feedBaselineRef.current).filter((b) => b.action !== "drop");
      newEntries.forEach((b) => {
        const verb = b.action === "bid" ? `bid ${b.amount} on`
          : b.action === "free_pick" ? "free-picked"
          : "got free (quota leftover) —";
        toast(`${b.captain_name} ${verb} ${b.player_name}`, { duration: 3000 });
      });
      if (newEntries.length > 0) {
        toast(
          `Points left — ${auction.captain_a?.name}: ${auction.captain_a?.points_remaining} · ${auction.captain_b?.name}: ${auction.captain_b?.points_remaining}`,
          { icon: "💰", duration: 4000 }
        );
      }
      feedBaselineRef.current = feed.length;
    }
  }, [auction?.bid_feed, isParticipant]);

  if (loading) {
    return (
      <div className="min-h-screen bg-cricket-cream">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-8 text-gray-500 text-sm">Loading auction…</div>
      </div>
    );
  }

  if (!auction) {
    return (
      <div className="min-h-screen bg-cricket-cream">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-8 text-gray-500 text-sm">Auction not found.</div>
      </div>
    );
  }

  const canBid = isParticipant && auction.status === "active" && auction.current_player;

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Gavel className="text-pitch-600" size={24} />
            <h1 className="text-2xl font-bold text-gray-900">Player Auction</h1>
          </div>
          <CountdownBadge endsAtIso={auction.status === "active" ? auction.ends_at : null} />
        </div>

        {auction.status === "pending" && (
          <div className="card text-center py-8 text-gray-600">Waiting for the admin to start the auction…</div>
        )}

        {auction.status === "completed" && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm font-medium">
            <Trophy size={18} /> Auction complete — final rosters below.
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CaptainCard summary={auction.captain_a} isYou={auction.captain_a?.captain_id === user?.id} startingPrice={auction.starting_price} />
          <CaptainCard summary={auction.captain_b} isYou={auction.captain_b?.captain_id === user?.id} startingPrice={auction.starting_price} />
        </div>

        {auction.status === "active" && (
          <div className="card">
            {auction.current_player ? (
              <>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {GROUP_LABELS[auction.current_player.category] || auction.current_player.category}
                </p>
                <h2 className="text-xl font-bold text-gray-900 mb-2">{auction.current_player.name}</h2>
                <p className="text-sm text-gray-600 mb-4">
                  {/* current_high_bid is the full price (base + extra) — only the extra
                      counts against anyone's 17-pt budget, so it's spelled out here too. */}
                  Current bid: <strong>{auction.current_player.current_high_bid}</strong>
                  {" "}({(auction.current_player.current_high_bid - auction.starting_price).toFixed(1)} extra)
                  {auction.current_player.current_high_bidder && ` — ${auction.current_player.current_high_bidder}`}
                </p>

                {canBid ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="number"
                      step="0.5"
                      min="0.5"
                      max={myMaxBid ?? undefined}
                      className="input-field w-32"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    {myMaxBid != null && (
                      <span className="text-xs text-gray-400">(max {myMaxBid}, {myRemaining} extra left)</span>
                    )}
                    <button
                      className="btn-primary text-sm py-2 px-4"
                      disabled={bidding || !amount}
                      onClick={() => placeBid(parseFloat(amount))}
                    >
                      {bidding ? "Bidding…" : "Place Bid"}
                    </button>
                    <button
                      className="flex items-center gap-2 text-sm py-2 px-4 rounded-lg border-2 border-red-300 text-red-700 bg-white hover:bg-red-50 font-medium"
                      disabled={dropping}
                      onClick={dropCurrentPlayer}
                    >
                      <ThumbsDown size={14} /> {dropping ? "…" : "Drop"}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">
                    {isParticipant ? "Waiting…" : "Only the two assigned captains can bid."}
                  </p>
                )}
              </>
            ) : (
              <p className="text-gray-500 text-sm text-center py-4">Waiting for the admin to release the next player…</p>
            )}
          </div>
        )}

        {freePickable.length > 0 && (
          <div className="card border-2 border-amber-300 bg-amber-50">
            <div className="flex items-center gap-2 mb-2">
              <Gift size={18} className="text-amber-700" />
              <h3 className="font-bold text-amber-900">Free Pick Available</h3>
            </div>
            <p className="text-xs text-amber-700 mb-3">
              The other captain's points are drained — claim any remaining Power/Classic player for free.
            </p>
            <div className="flex flex-wrap gap-2">
              {freePickable.map((p) => (
                <button
                  key={p.id}
                  onClick={() => freePick(p.id)}
                  disabled={freePicking === p.id}
                  className="text-sm py-1.5 px-3 rounded-lg border border-amber-400 text-amber-800 bg-white hover:bg-amber-100 disabled:opacity-50"
                >
                  {freePicking === p.id ? "Picking…" : p.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <h3 className="font-bold text-gray-900 mb-3 text-sm">Live Feed</h3>
          <div className="space-y-2 max-h-96 overflow-y-auto">
            {(auction.bid_feed || []).length === 0 && (
              <p className="text-xs text-gray-400">No bids yet.</p>
            )}
            {(auction.bid_feed || []).map((b, i) => (
              <div key={i} className="text-sm bg-gray-50 rounded-lg px-3 py-2">
                <span className="font-semibold">{b.captain_name}</span>{" "}
                {b.action === "bid" && <>bid <strong>{b.amount}</strong> on {b.player_name}</>}
                {b.action === "drop" && <>👎🏾 dropped {b.player_name}</>}
                {b.action === "leftover_free" && <>received {b.player_name} free (quota leftover)</>}
                {b.action === "free_pick" && <>free-picked {b.player_name} (opponent's purse drained)</>}
                <span className="text-gray-400 text-xs ml-2">{b.created_at}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
