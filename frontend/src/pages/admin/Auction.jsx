import { useState, useEffect, useMemo } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import PageBackgroundPhoto from "../../components/PageBackgroundPhoto";
import auctionPhoto from "../../assets/dashboard-backgrounds/auction.jpg";
import AuctionRulesNote from "../../components/AuctionRulesNote";
import { useAuction } from "../../hooks/useAuction";
import { Gavel, PlayCircle, StopCircle, RefreshCw, Copy } from "lucide-react";

const STORAGE_KEY = "bcc_active_auction_id";

const GROUP_LABELS = {
  extra_power_allrounder: "Extra Power — All-Rounders",
  extra_power_batsman: "Extra Power — Batsmen",
  power: "Power",
  classic: "Classic",
};

// Plain-text summary for pasting into WhatsApp once an auction is done —
// prices are deliberately left out (they're confidential post-completion,
// same as the on-screen rosters), just team/captain/player names. Category
// (Power/Classic/etc.) is internal auction bookkeeping, not shown here.
function buildWhatsAppSummary(auction) {
  const teamBlock = (label, captain) => {
    const heading = captain.team_name ? `${label} — ${captain.team_name}` : label;
    const lines = [`*${heading}*`, `Captain: ${captain.name}`, ""];
    (captain.roster || []).forEach((p, i) => lines.push(`${i + 1}. ${p.name}`));
    return lines.join("\n").trim();
  };

  return [
    "🏏 *BCC-CVote Auction Results*",
    "",
    teamBlock("Team A", auction.captain_a),
    "",
    teamBlock("Team B", auction.captain_b),
  ].join("\n");
}

export default function AdminAuction() {
  const [slots, setSlots] = useState([]);
  const [voteMatrix, setVoteMatrix] = useState([]);
  const [captains, setCaptains] = useState([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [captainAId, setCaptainAId] = useState("");
  const [captainBId, setCaptainBId] = useState("");
  const [creating, setCreating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [releasing, setReleasing] = useState(null);

  const [auctionId, setAuctionId] = useState(() => localStorage.getItem(STORAGE_KEY) || null);
  const { auction, loading, refetch } = useAuction(auctionId);

  useEffect(() => {
    api.get("/admin/window").then((res) => setSlots(res.data.windows || [])).catch(() => toast.error("Failed to load slots"));
    api.get("/admin/dashboard").then((res) => setVoteMatrix(res.data.vote_matrix || [])).catch(() => toast.error("Failed to load votes"));
    api.get("/admin/captains").then((res) => setCaptains(res.data || [])).catch(() => toast.error("Failed to load captains"));
  }, []);

  // Informational only — Captain A/B can be any active captain (they're
  // running the draft, not required to be in the player pool themselves).
  const availableVoterCount = useMemo(() => {
    if (!selectedSlotId) return 0;
    return voteMatrix.filter((row) => row.votes.some((v) => v.slot_id === selectedSlotId && v.availability === "available")).length;
  }, [voteMatrix, selectedSlotId]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!selectedSlotId || !captainAId || !captainBId) return;
    if (captainAId === captainBId) { toast.error("Pick two different captains"); return; }
    setCreating(true);
    try {
      const res = await api.post("/admin/auction", {
        slot_id: selectedSlotId, captain_a_id: captainAId, captain_b_id: captainBId,
      });
      toast.success(`Auction created — ${JSON.stringify(res.data.group_counts)}`);
      localStorage.setItem(STORAGE_KEY, res.data.auction_id);
      setAuctionId(res.data.auction_id);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to create auction");
    } finally {
      setCreating(false);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      await api.post(`/admin/auction/${auctionId}/start`);
      toast.success("Auction started — 25 minute clock is running");
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to start auction");
    } finally {
      setStarting(false);
    }
  };

  // Admin only ever picks the CATEGORY — the backend decides which specific
  // player comes up next (by batting/bowling average), so there's no manual
  // player-name picker here for admin to play favorites with.
  const handleRelease = async (group) => {
    setReleasing(group);
    try {
      await api.post(`/admin/auction/${auctionId}/release`, { category: group });
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to release player");
    } finally {
      setReleasing(null);
    }
  };

  const handleClose = async () => {
    if (!confirm("Force-close this auction now?")) return;
    try {
      await api.post(`/admin/auction/${auctionId}/close`);
      toast.success("Auction closed");
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to close auction");
    }
  };

  const handleCancelPending = async () => {
    if (!confirm("Cancel this auction? It hasn't started — the two captains won't see \"Join Auction\" for it anymore.")) return;
    try {
      await api.post(`/admin/auction/${auctionId}/close`);
      toast.success("Auction cancelled");
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to cancel auction");
    }
  };

  const handleCopyTeams = async () => {
    try {
      await navigator.clipboard.writeText(buildWhatsAppSummary(auction));
      toast.success("Copied — paste it into WhatsApp");
    } catch {
      toast.error("Couldn't copy — your browser may be blocking clipboard access");
    }
  };

  const handleNewAuction = () => {
    localStorage.removeItem(STORAGE_KEY);
    setAuctionId(null);
    setSelectedSlotId("");
    setCaptainAId("");
    setCaptainBId("");
  };

  return (
    <div className="min-h-screen bg-cricket-cream isolate">
      <PageBackgroundPhoto src={auctionPhoto} />
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Gavel className="text-pitch-600" size={24} />
            <h1 className="text-2xl font-bold text-gray-900">Player Auction</h1>
          </div>
          {auctionId && (
            <button onClick={handleNewAuction} className="flex items-center gap-1 text-xs text-gray-500 hover:text-pitch-600">
              <RefreshCw size={13} /> Start a new auction
            </button>
          )}
        </div>

        {!auctionId && (
          <div className="card">
            <h2 className="font-bold text-gray-900 mb-3">Set Up Auction</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Match Slot</label>
                <select className="input-field" value={selectedSlotId} onChange={(e) => {
                  setSelectedSlotId(e.target.value); setCaptainAId(""); setCaptainBId("");
                }} required>
                  <option value="">Select a slot…</option>
                  {slots.map(({ slot }) => (
                    <option key={slot.id} value={slot.id}>{slot.day} {slot.match_time || slot.time_of_day}</option>
                  ))}
                </select>
              </div>

              {selectedSlotId && (
                <p className="text-xs text-gray-500">
                  {availableVoterCount} player(s) voted available for this slot — that's the pool that gets
                  auctioned. Captain A/B below can be any captain (they run the draft; they don't need to
                  have voted themselves).
                </p>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Captain A (Team)</label>
                  <select className="input-field" value={captainAId} onChange={(e) => setCaptainAId(e.target.value)} required>
                    <option value="">Select a team…</option>
                    {captains.map((c) => (
                      <option key={c.id} value={c.id} disabled={c.id === captainBId}>
                        {c.name}{c.team_name ? ` — ${c.team_name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Captain B (Team)</label>
                  <select className="input-field" value={captainBId} onChange={(e) => setCaptainBId(e.target.value)} required>
                    <option value="">Select a team…</option>
                    {captains.map((c) => (
                      <option key={c.id} value={c.id} disabled={c.id === captainAId}>
                        {c.name}{c.team_name ? ` — ${c.team_name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <button type="submit" disabled={creating} className="btn-primary text-sm py-2 px-4">
                {creating ? "Creating…" : "Create Auction"}
              </button>
            </form>
          </div>
        )}

        {auctionId && loading && <p className="text-gray-500 text-sm">Loading…</p>}

        {auctionId && auction && (
          <>
            <AuctionRulesNote auction={auction} />

            {auction.status === "pending" && (
              <div className="card text-center py-6">
                <p className="text-gray-600 mb-3">Auction created — not started yet.</p>
                <div className="flex items-center justify-center gap-3">
                  <button onClick={handleStart} disabled={starting} className="btn-primary flex items-center gap-2 text-sm py-2 px-4">
                    <PlayCircle size={16} /> {starting ? "Starting…" : "Start Auction (25 min clock)"}
                  </button>
                  <button onClick={handleCancelPending} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800">
                    <StopCircle size={13} /> Cancel
                  </button>
                </div>
              </div>
            )}

            {auction.status === "active" && (
              <div className="card">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold text-gray-900">Release a Player</h2>
                  <button onClick={handleClose} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800">
                    <StopCircle size={13} /> Force Close
                  </button>
                </div>
                {auction.current_player && (
                  <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                    Currently bidding: <strong>{auction.current_player.name}</strong>
                  </p>
                )}
                {Object.entries(GROUP_LABELS).map(([group, label]) => {
                  const count = (auction.available_players || []).filter((p) => p.category === group).length;
                  if (count === 0) return null;
                  return (
                    <div key={group} className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label} <span className="text-gray-400 normal-case font-normal">({count} left)</span></p>
                      <button
                        onClick={() => handleRelease(group)}
                        disabled={releasing === group || !!auction.current_player}
                        className="text-sm py-1.5 px-3 rounded-lg border border-pitch-300 text-pitch-700 bg-white hover:bg-pitch-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        {releasing === group ? "Releasing…" : "Release Next"}
                      </button>
                    </div>
                  );
                })}
                {(auction.available_players || []).length === 0 && (
                  <p className="text-sm text-gray-500">All players have been sold or assigned.</p>
                )}
              </div>
            )}

            {auction.status === "completed" && (
              <div className="card text-center py-6 text-green-700 font-medium space-y-3">
                <p>Auction completed.</p>
                <button
                  onClick={handleCopyTeams}
                  className="btn-secondary inline-flex items-center gap-2 text-sm py-2 px-4"
                >
                  <Copy size={15} /> Copy Teams for WhatsApp
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[["Team A", auction.captain_a], ["Team B", auction.captain_b]].map(([label, c]) => {
                // Confidential once completed — backend strips prices/points from
                // the response entirely (see auction.py get_auction), so
                // points_remaining comes back null and only names are left to show.
                const pricesHidden = c.points_remaining == null;
                return (
                  <div key={c.captain_id} className="card">
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
                        <h3 className="font-bold text-gray-900">{c.name}</h3>
                      </div>
                      {!pricesHidden && (
                        <span className={`text-sm font-semibold ${c.is_drained ? "text-red-600" : "text-pitch-700"}`}>
                          {c.points_remaining} pts left{c.is_drained && " (drained)"}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mb-2">{c.roster_count} players picked</p>
                    {c.roster?.length > 0 && (
                      <div className="border-t pt-2 space-y-1">
                        {c.roster.map((p) => (
                          <div key={p.user_id} className="flex items-center justify-between text-xs">
                            <span className="text-gray-800">{p.name}</span>
                            <span className="text-gray-400">
                              {GROUP_LABELS[p.category] || p.category}
                              {!pricesHidden && (
                                <> — {p.assigned_via === "leftover_free" || p.assigned_via === "free_pick"
                                  ? "free"
                                  // p.price is the full sold price (base + extra) — only the extra
                                  // actually comes out of the 17-pt budget, so showing just "X pts"
                                  // here reads as a budget overspend when it isn't one.
                                  : `${p.price} (${(p.price - auction.starting_price).toFixed(1)} pts used)`}</>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
