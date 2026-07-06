import { useState, useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import Navbar from "../components/Navbar";
import { useAuth } from "../context/AuthContext";
import { useAuction } from "../hooks/useAuction";
import { Gavel, ThumbsDown, Clock, Trophy } from "lucide-react";

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

function CaptainCard({ summary, isYou }) {
  if (!summary) return null;
  return (
    <div className={`card ${isYou ? "border-2 border-pitch-400" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-gray-900">{summary.name}{isYou && " (You)"}</h3>
        <span className="text-sm font-semibold text-pitch-700">{summary.points_remaining} pts left</span>
      </div>
      <p className="text-xs text-gray-500 mb-2">{summary.roster_count} players picked</p>
      <div className="space-y-1">
        {Object.entries(summary.group_counts || {}).map(([group, count]) => (
          <div key={group} className="flex items-center justify-between text-xs text-gray-600">
            <span>{GROUP_LABELS[group] || group}</span>
            <span className="font-medium">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Auction() {
  const { id } = useParams();
  const { user } = useAuth();
  const { auction, loading, bidding, dropping, placeBid, dropCurrentPlayer } = useAuction(id);
  const [amount, setAmount] = useState("");

  const isParticipant = useMemo(() => {
    if (!auction || !user) return false;
    return [auction.captain_a?.captain_id, auction.captain_b?.captain_id].includes(user.id);
  }, [auction, user]);

  useEffect(() => {
    if (auction?.current_player) {
      const floor = auction.current_player.current_high_bid;
      setAmount(String(floor + 0.5));
    }
  }, [auction?.current_player?.id, auction?.current_player?.current_high_bid]);

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
          <CaptainCard summary={auction.captain_a} isYou={auction.captain_a?.captain_id === user?.id} />
          <CaptainCard summary={auction.captain_b} isYou={auction.captain_b?.captain_id === user?.id} />
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
                  Current bid: <strong>{auction.current_player.current_high_bid}</strong> pts
                  {auction.current_player.current_high_bidder && ` — ${auction.current_player.current_high_bidder}`}
                </p>

                {canBid ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <input
                      type="number"
                      step="0.5"
                      className="input-field w-32"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
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
                <span className="text-gray-400 text-xs ml-2">{b.created_at}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
