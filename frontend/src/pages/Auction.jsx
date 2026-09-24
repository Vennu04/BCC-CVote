import { useState, useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import Navbar from "../components/Navbar";
import AuctionRulesNote from "../components/AuctionRulesNote";
import CountdownBadge from "../components/CountdownBadge";
import PlayerInsightsCard from "../components/PlayerInsightsCard";
import FairnessBanner from "../components/FairnessBanner";
import ReleaseOrderLog from "../components/ReleaseOrderLog";
import AuctionChat from "../components/AuctionChat";
import { useAuth } from "../context/AuthContext";
import { useAuction } from "../hooks/useAuction";
import { Gavel, ThumbsDown, Trophy, Gift, FlaskConical, Bell, Zap, AlertTriangle } from "lucide-react";
import {
  playTurnAlertSound, vibrateTurnAlert, flashTabTitle,
  notificationsSupported, requestTurnNotificationPermission, showTurnNotification,
} from "../utils/turnAlert";

const GROUP_LABELS = {
  extra_power_allrounder: "Extra Power — All-Rounders",
  extra_power_batsman: "Extra Power — Batsmen",
  power: "Power",
  classic: "Classic",
};

// Fixed order/labels for every auction — not derived from the data, so a
// category with zero players left still shows up as "(0 left)" instead of
// disappearing, giving captains a stable 4-row layout to plan around.
const CATEGORY_ORDER = ["extra_power_allrounder", "extra_power_batsman", "power", "classic"];

function AvailablePlayersPool({ auction }) {
  const players = auction.available_players || [];
  const currentId = auction.current_player?.id;

  const byCategory = useMemo(() => {
    const map = { extra_power_allrounder: [], extra_power_batsman: [], power: [], classic: [] };
    for (const p of players) {
      if (map[p.category]) map[p.category].push(p);
    }
    return map;
  }, [players]);

  return (
    <div className="card">
      <h3 className="font-bold text-gray-900 mb-3 text-sm">Available Players</h3>
      <div className="space-y-4">
        {CATEGORY_ORDER.map((cat) => {
          const list = byCategory[cat];
          return (
            <div key={cat}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
                {GROUP_LABELS[cat]} <span className="text-gray-400 normal-case font-normal">({list.length} left)</span>
              </p>
              {list.length === 0 ? (
                <p className="text-xs text-gray-400 italic">None remaining</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {list.map((p) => {
                    const isCurrent = p.id === currentId;
                    return (
                      <span
                        key={p.id}
                        className={`text-xs rounded-full px-2.5 py-1 ${
                          isCurrent
                            ? "bg-amber-100 text-amber-800 border border-amber-300 font-semibold"
                            : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {isCurrent && "🔨 "}{p.name}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CaptainCard({ summary, isYou, startingPrice }) {
  if (!summary) return null;
  // Once the auction is complete, prices/points are wiped from the API
  // response entirely (confidential) — points_remaining comes back null, so
  // this just shows the final name-only roster instead of any numbers.
  const pricesHidden = summary.points_remaining == null;
  return (
    <div className={`card ${isYou ? "border-2 border-pitch-400" : ""}`}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-bold text-gray-900">{summary.name}{isYou && " (You)"}</h3>
        {!pricesHidden && <span className="text-sm font-semibold text-pitch-700">{summary.points_remaining} pts left</span>}
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
              {!pricesHidden && (
                <span className="text-gray-400">
                  {p.assigned_via === "leftover_free" || p.assigned_via === "free_pick"
                    ? "free"
                    // p.price is the full sold price (base + extra) — only the extra
                    // actually comes out of the 17-pt budget, so showing just "X pts"
                    // here reads as a budget overspend when it isn't one.
                    : `${p.price} (${(p.price - startingPrice).toFixed(1)} pts used)`}
                </span>
              )}
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
  const {
    auction, loading, error, bidding, dropping, freePicking, sendingChat,
    placeBid, dropCurrentPlayer, freePick, sendChatMessage, refetch,
  } = useAuction(id);
  const [amount, setAmount] = useState("");
  const [activePanel, setActivePanel] = useState("teams");

  const isParticipant = useMemo(() => {
    if (!auction || !user) return false;
    return [auction.captain_a?.captain_id, auction.captain_b?.captain_id].includes(user.id);
  }, [auction, user]);

  // Once the OTHER captain's purse is fully drained, every remaining player in
  // any category can be claimed for free instead of going through the normal
  // bid/drop cycle — a drained captain can't contest anything anymore, in any
  // category, since they can't even afford the 8.5 starting bid.
  const otherCaptainDrained = useMemo(() => {
    if (!auction || !user) return false;
    const other = auction.captain_a?.captain_id === user.id ? auction.captain_b : auction.captain_a;
    return !!other?.is_drained;
  }, [auction, user]);

  const freePickable = useMemo(() => {
    if (!isParticipant || !otherCaptainDrained || !user) return [];
    const mine = auction.captain_a?.captain_id === user.id ? auction.captain_a : auction.captain_b;
    const myGroupCounts = mine?.group_counts || {};
    const quotas = auction.group_quotas || {};
    // Still bounded by the picking captain's own quota per category — free
    // pick lets you claim anything left over, not exceed your own fair share.
    return (auction.available_players || []).filter(
      (p) => (myGroupCounts[p.category] ?? 0) < (quotas[p.category] ?? Infinity)
    );
  }, [auction, isParticipant, otherCaptainDrained, user]);

  const myRemaining = useMemo(() => {
    if (!auction || !user) return null;
    const mine = auction.captain_a?.captain_id === user.id ? auction.captain_a : auction.captain_b;
    return mine?.points_remaining ?? null;
  }, [auction, user]);

  // Real live-auction data: captains who currently hold the highest bid on a
  // player occasionally still clicked Drop anyway (reconsidering, or just
  // going for the wrong button under time pressure) and got rejected --
  // correct behavior server-side (conceding a bid you're winning isn't
  // allowed), but confusing without knowing why. Hiding Drop for whoever's
  // already leading heads that off before it happens, instead of just
  // explaining the rejection after the fact.
  const iAmCurrentLeader = useMemo(() => {
    if (!auction?.current_player || !user) return false;
    const mine = auction.captain_a?.captain_id === user.id ? auction.captain_a : auction.captain_b;
    return !!mine && auction.current_player.current_high_bidder === mine.name;
  }, [auction, user]);

  // The 17-point purse only ever pays for the extra amount above the 8.5
  // base — the base itself is never drawn from it — so the highest TOTAL
  // bid a captain can actually afford is base + however much extra they
  // have left, not just their remaining extra-points figure on its own.
  const myMaxBid = useMemo(() => {
    if (!auction || myRemaining == null) return null;
    return auction.starting_price + myRemaining;
  }, [auction, myRemaining]);

  const stepAmount = (delta) => {
    setAmount((prev) => {
      const current = parseFloat(prev) || 0;
      let next = Math.round((current + delta) * 2) / 2; // snap to 0.5 increments
      next = Math.max(next, 0.5);
      if (myMaxBid != null) next = Math.min(next, myMaxBid);
      return String(next);
    });
  };

  useEffect(() => {
    if (auction?.current_player) {
      const floor = auction.current_player.current_high_bid;
      // Nobody's bid on this player yet -- the floor itself (the base
      // price) is a valid opening bid, unlike raising an existing bid,
      // which must clear it by at least 0.5.
      const minValid = auction.current_player.current_high_bidder ? floor + 0.5 : floor;
      const suggested = myMaxBid != null ? Math.min(minValid, myMaxBid) : minValid;
      setAmount(String(suggested));
    }
  }, [auction?.current_player?.id, auction?.current_player?.current_high_bid, auction?.current_player?.current_high_bidder, myMaxBid]);

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
      // timeout_drop reaches the same silent end state a manual mutual drop
      // already does (see the "drop" exclusion above it) -- no points/roster
      // change, so no toast here either. It's still fully visible in the
      // static Live Feed list below for anyone who wants to see why a
      // player disappeared.
      const newEntries = feed.slice(feedBaselineRef.current).filter((b) => b.action !== "drop" && b.action !== "timeout_drop");
      newEntries.forEach((b) => {
        const verb = b.action === "bid" ? `bid ${b.amount} on`
          : b.action === "free_pick" ? "free-picked"
          : "got free (your half of that group was full) —";
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

  // "Your turn" alerting -- added after real live-auction data showed
  // captains going quiet for minutes at a time on a player they weren't
  // currently leading, even with the tab open, stalling the whole round for
  // the other captain. Fires once per distinct (player, leader) state, not
  // on every poll tick, so it doesn't nag on top of an already-seen alert.
  const [needsMyTurn, setNeedsMyTurn] = useState(false);
  const [notifPermission, setNotifPermission] = useState(
    notificationsSupported() ? Notification.permission : "unsupported"
  );
  const lastAlertedKeyRef = useRef(null);

  useEffect(() => {
    if (!isParticipant || auction?.status !== "active" || !auction?.current_player) {
      setNeedsMyTurn(false);
      return;
    }
    const key = auction.current_player.id + ":" + (auction.current_player.current_high_bidder || "none");
    if (iAmCurrentLeader) {
      setNeedsMyTurn(false);
      lastAlertedKeyRef.current = key;
      return;
    }
    setNeedsMyTurn(true);
    if (lastAlertedKeyRef.current !== key) {
      lastAlertedKeyRef.current = key;
      playTurnAlertSound();
      vibrateTurnAlert();
      showTurnNotification(
        auction.current_player.current_high_bidder
          ? `${auction.current_player.current_high_bidder} bid ${auction.current_player.current_high_bid} on ${auction.current_player.name} — your move.`
          : `${auction.current_player.name} is up — bid or drop.`
      );
    }
  }, [auction?.current_player?.id, auction?.current_player?.current_high_bidder, auction?.current_player?.current_high_bid, auction?.status, isParticipant, iAmCurrentLeader]);

  // Flashes the tab title only while actually waiting on you, so switching
  // away to check WhatsApp still shows it at a glance when you look back.
  useEffect(() => {
    if (!needsMyTurn) return;
    return flashTabTitle("⚡ YOUR TURN!");
  }, [needsMyTurn]);

  const handleEnableNotifications = async () => {
    const result = await requestTurnNotificationPermission();
    setNotifPermission(result);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-ground">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-8 text-gray-500 text-sm">Loading auction…</div>
      </div>
    );
  }

  if (!auction && error) {
    // Distinct from the genuine "no such auction" case below — this is a
    // failed fetch (network/server error), not a bad/stale auction link,
    // and deserves a retry action instead of a dead-end message.
    return (
      <div className="min-h-screen bg-brand-ground">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-8">
          <div className="card text-center py-12">
            <AlertTriangle className="mx-auto text-amber-500 mb-3" size={40} />
            <p className="text-gray-700 font-medium">Couldn't load this auction</p>
            <p className="text-gray-400 text-sm mt-1 mb-4">Check your connection and try again</p>
            <button onClick={refetch} className="btn-secondary">
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!auction) {
    return (
      <div className="min-h-screen bg-brand-ground">
        <Navbar />
        <div className="max-w-3xl mx-auto px-4 py-8 text-gray-500 text-sm">Auction not found.</div>
      </div>
    );
  }

  const canBid = isParticipant && auction.status === "active" && auction.current_player;

  const panels = [
    { key: "teams", label: "Teams" },
    ...(auction.status !== "completed" ? [{ key: "pool", label: "Pool" }, { key: "feed", label: "Feed" }] : []),
    { key: "chat", label: "Chat" },
    { key: "rules", label: "Rules" },
  ];
  const panel = panels.some((p) => p.key === activePanel) ? activePanel : "teams";

  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <div className="bg-brand-navy text-white">
        <div className="max-w-3xl mx-auto px-4 pt-3 pb-4 flex items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-black leading-tight">{auction.status === "completed" ? "Auction result" : "Live auction"}</h1>
            <p className="text-sm text-white/60">{auction.is_test ? "Practice auction" : auction.match_label || ""}</p>
          </div>
          <CountdownBadge endsAtIso={auction.status === "active" ? auction.ends_at_iso : null} />
        </div>
      </div>
      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {needsMyTurn && (
          <div className="flex items-center gap-2 bg-amber-400 border-2 border-amber-500 text-amber-950 rounded-lg px-4 py-3 text-sm font-bold animate-pulse">
            <Zap size={18} className="shrink-0" />
            {auction.current_player?.current_high_bidder
              ? `${auction.current_player.current_high_bidder} just bid ${auction.current_player.current_high_bid} on ${auction.current_player?.name} — your move!`
              : `${auction.current_player?.name} is up — bid or drop now!`}
          </div>
        )}
        {isParticipant && notifPermission === "default" && (
          <button
            type="button"
            onClick={handleEnableNotifications}
            className="flex items-center gap-2 text-xs font-medium text-pitch-700 border border-pitch-300 rounded-lg px-3 py-2 hover:bg-pitch-50 w-fit"
          >
            <Bell size={14} /> Enable turn alerts (notifies you even if you switch apps)
          </button>
        )}
        {auction.is_test && (
          <div className="flex items-center gap-2 bg-amber-100 border-2 border-amber-400 text-amber-900 rounded-lg px-4 py-2.5 text-sm font-semibold">
            <FlaskConical size={16} /> PRACTICE AUCTION — no real votes, budgets, or player stats are affected
          </div>
        )}
        {auction.status === "pending" && (
          <div className="card text-center py-8 text-gray-600">Waiting for the admin to start the auction…</div>
        )}
        {auction.status === "completed" && (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm font-medium">
            <Trophy size={18} /> Auction complete — final rosters below.
          </div>
        )}

        {auction.status === "active" && (
          <div className="rounded-2xl bg-brand-navy text-white p-4 shadow-soft">
            {auction.current_player ? (
              <>
                <p className="inline-block text-[11px] font-black uppercase tracking-wide bg-brand-gold text-brand-navy rounded-full px-2.5 py-0.5">
                  {GROUP_LABELS[auction.current_player.category] || auction.current_player.category}
                </p>
                <h2 className="text-2xl font-black mt-1.5 mb-1">{auction.current_player.name}</h2>
                <p className="text-sm text-white/70">
                  {/* current_high_bid is the full price (base + extra) — only the extra
                      counts against anyone's 17-pt budget, so it's spelled out here too. */}
                  Current bid: <strong>{auction.current_player.current_high_bid}</strong>
                  {" "}({(auction.current_player.current_high_bid - auction.starting_price).toFixed(1)} extra)
                  {auction.current_player.current_high_bidder && ` — ${auction.current_player.current_high_bidder}`}
                </p>

              </>
            ) : (
              <p className="text-white/70 text-sm text-center py-3">Waiting for the admin to release the next player…</p>
            )}
          </div>
        )}

        {auction.current_player && <PlayerInsightsCard player={auction.current_player} />}

        {freePickable.length > 0 && (
          <div className="card border-2 border-amber-300 bg-amber-50">
            <div className="flex items-center gap-2 mb-2">
              <Gift size={18} className="text-amber-700" />
              <h3 className="font-bold text-amber-900">Free Pick Available</h3>
            </div>
            <p className="text-xs text-amber-700 mb-3">
              The other captain has no points left — you can take any player still left, free, up to your half of each group.
            </p>
            <div className="flex flex-wrap gap-2">
              {freePickable.map((p) => (
                <button
                  key={p.id}
                  onClick={() => freePick(p.id)}
                  disabled={freePicking === p.id}
                  className="text-sm py-1.5 px-3 rounded-lg border border-amber-400 text-amber-800 bg-white hover:bg-amber-100 disabled:opacity-50"
                >
                  {freePicking === p.id ? "Picking…" : `${p.name} — ${GROUP_LABELS[p.category] || p.category}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {auction.status !== "completed" && <FairnessBanner />}

        <div className="flex gap-1 bg-white rounded-2xl shadow-soft p-1 overflow-x-auto scroll-touch" role="tablist">
          {panels.map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={panel === p.key} onClick={() => setActivePanel(p.key)}
              className={`flex-1 shrink-0 min-h-[40px] px-3 rounded-xl text-sm font-bold transition-colors duration-150 ${
                panel === p.key ? "bg-brand-navy text-white" : "text-gray-600 hover:bg-gray-50"}`}>
              {p.label}
            </button>
          ))}
        </div>

        {panel === "teams" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <CaptainCard summary={auction.captain_a} isYou={auction.captain_a?.captain_id === user?.id} startingPrice={auction.starting_price} />
          <CaptainCard summary={auction.captain_b} isYou={auction.captain_b?.captain_id === user?.id} startingPrice={auction.starting_price} />
          </div>
        )}
        {panel === "pool" && <AvailablePlayersPool auction={auction} />}
        {panel === "feed" && (
          <>
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
                  {b.action === "leftover_free" && <>got {b.player_name} free (the other half was full)</>}
                  {b.action === "free_pick" && <>free-picked {b.player_name} (opponent's purse drained)</>}
                  {b.action === "timeout_drop" && <>⏱️ {b.player_name} — no bid or drop within 30s, moved to the back of the category</>}
                  <span className="text-gray-400 text-xs ml-2">{b.created_at}</span>
                </div>
              ))}
            </div>
          </div>
            {auction.status !== "pending" && <ReleaseOrderLog auctionId={id} />}
          </>
        )}
        {panel === "chat" && <AuctionChat chatFeed={auction.chat_feed} currentUserId={user?.id} onSend={sendChatMessage} sending={sendingChat} />}
        {panel === "rules" && <AuctionRulesNote auction={auction} />}
        {panel !== "feed" && auction.status === "completed" && <ReleaseOrderLog auctionId={id} />}

        {auction.status === "active" && auction.current_player && (
          <div className="sticky bottom-[calc(64px+env(safe-area-inset-bottom,0px))] lg:bottom-4 z-30 bg-white rounded-2xl shadow-soft-lg border border-gray-200 p-3">
                {canBid ? (
                  <div className="space-y-2.5">
                    {/* Points in plain words: every player starts at the base price for
                        free, and the purse only pays for going higher. */}
                    {myRemaining != null && (
                      <div>
                        <div className="flex items-baseline justify-between text-sm">
                          <span className="font-bold text-gray-900">{myRemaining} of {auction.points_budget} points left</span>
                          <span className="text-gray-500">this bid uses {Math.max(0, (parseFloat(amount) || 0) - auction.starting_price).toFixed(1)}</span>
                        </div>
                        <div className="h-2.5 rounded-full bg-gray-100 overflow-hidden mt-1">
                          <div className="h-full rounded-full bg-brand-gold" style={{ width: `${Math.max(0, Math.min(100, (myRemaining / auction.points_budget) * 100))}%` }} />
                        </div>
                      </div>
                    )}
                    {/* Tap to raise instead of typing — native number spinners don't show on
                        most phones, and typing mid-auction is fiddly. */}
                    <div className="grid grid-cols-4 gap-2">
                      {[[-0.5, "−0.5"], [0.5, "+0.5"], [1, "+1"], [2, "+2"]].map(([d, label]) => (
                        <button key={label} type="button" onClick={() => stepAmount(d)}
                          className="min-h-[48px] rounded-xl border-2 border-gray-200 bg-white text-base font-black text-brand-navy active:bg-gray-100"
                          aria-label={d < 0 ? "Lower the bid by 0.5" : `Raise the bid by ${d}`}>
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button
                        className="flex-[2] min-h-[56px] rounded-2xl bg-pitch-700 text-white text-xl font-black disabled:opacity-50"
                        disabled={bidding || !amount}
                        onClick={() => placeBid(parseFloat(amount))}
                      >
                        {bidding ? "Bidding…" : `Bid ${parseFloat(amount || 0).toFixed(1)}`}
                      </button>
                      {iAmCurrentLeader ? (
                        <span className="flex-1 text-xs text-pitch-700 font-bold flex items-center">You're winning — you can't pass while you lead.</span>
                      ) : (
                        <button
                          className="flex-1 min-h-[56px] rounded-2xl border-2 border-red-200 text-red-700 bg-white text-lg font-black flex items-center justify-center gap-1.5 disabled:opacity-50"
                          disabled={dropping}
                          onClick={dropCurrentPlayer}
                        >
                          <ThumbsDown size={16} /> {dropping ? "…" : "Pass"}
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400">
                    {isParticipant ? "Waiting…" : "Only the two assigned captains can bid."}
                  </p>
                )}
          </div>
        )}
      </div>
    </div>
  );
}
