import { useState, useEffect, useMemo, useCallback } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import PageBackgroundPhoto from "../../components/PageBackgroundPhoto";
import auctionPhoto from "../../assets/dashboard-backgrounds/auction.webp";
import AuctionRulesNote from "../../components/AuctionRulesNote";
import ConfirmedPlayersPanel from "../../components/ConfirmedPlayersPanel";
import CountdownBadge from "../../components/CountdownBadge";
import PlayerInsightsCard from "../../components/PlayerInsightsCard";
import FairnessBanner from "../../components/FairnessBanner";
import ReleaseOrderLog from "../../components/ReleaseOrderLog";
import { useAuction } from "../../hooks/useAuction";
import { Gavel, PlayCircle, StopCircle, RefreshCw, Copy, Pause, CheckCircle2, FlaskConical, Link2 } from "lucide-react";

const STORAGE_KEY = "bcc_active_auction_id";

const GROUP_LABELS = {
  extra_power_allrounder: "Extra Power — All-Rounders",
  extra_power_batsman: "Extra Power — Batsmen",
  power: "Power",
  classic: "Classic",
};

// Same cadence as the Voting Windows page's turnout monitoring — frequent
// enough to watch confirmations land live while deciding which slot to run,
// without the overhead the 2.5s in-auction bidding poll needs once it's live.
const SLOT_POLL_INTERVAL_MS = 5000;

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

  const lines = [
    "🏏 *BCC-CVote Auction Results*",
    "",
    teamBlock("Team A", auction.captain_a),
    "",
    teamBlock("Team B", auction.captain_b),
  ];
  if (auction.is_test) lines.unshift("🧪 TEST DATA — DO NOT SHARE AS A REAL RESULT", "");
  return lines.join("\n");
}

export default function AdminAuction() {
  const [slots, setSlots] = useState([]);
  const [voteMatrix, setVoteMatrix] = useState([]);
  const [captains, setCaptains] = useState([]);
  const [selectedSlotId, setSelectedSlotId] = useState("");
  const [captainAId, setCaptainAId] = useState("");
  const [captainBId, setCaptainBId] = useState("");
  const [creating, setCreating] = useState(false);
  const [practiceCaptainAId, setPracticeCaptainAId] = useState("");
  const [practiceCaptainBId, setPracticeCaptainBId] = useState("");
  const [practicePlayerIds, setPracticePlayerIds] = useState(new Set());
  const [creatingPractice, setCreatingPractice] = useState(false);
  const [starting, setStarting] = useState(false);
  const [releasing, setReleasing] = useState(null);
  const [pausing, setPausing] = useState(false);
  const [resuming, setResuming] = useState(false);

  const [auctionId, setAuctionId] = useState(() => localStorage.getItem(STORAGE_KEY) || null);
  const { auction, loading, refetch } = useAuction(auctionId);

  // One-shot completion toast, gated by localStorage (not component state) so
  // it survives a refresh/reconnect instead of firing again — is_complete
  // itself is a stable computed value (see get_auction), so this is purely
  // about not re-toasting something admin already saw, not about detecting
  // the transition. The persistent banner below covers the case where the
  // toast was missed or dismissed.
  useEffect(() => {
    if (!auction?.is_complete || !auctionId) return;
    const key = `bcc_auction_complete_notified_${auctionId}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    toast.success("Live auction complete — every player's sold. Close it, then copy the teams for WhatsApp.", { duration: 7000, icon: "🏁" });
  }, [auction?.is_complete, auctionId]);

  // Same one-shot pattern as the completion toast above — fires once, the
  // moment BOTH captains have loaded the auction page at least once, so
  // admin isn't stuck guessing whether it's actually safe to hit Start yet.
  // The persistent readout in the pending-state card below covers the case
  // where this toast was missed, same relationship as the completion banner
  // has with its own toast.
  useEffect(() => {
    if (!auction || auction.status !== "pending" || !auctionId) return;
    if (!auction.captain_a_joined || !auction.captain_b_joined) return;
    const key = `bcc_auction_both_joined_notified_${auctionId}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    toast.success("Both captains have joined — ready to start.", { duration: 6000, icon: "🤝" });
  }, [auction, auctionId]);

  useEffect(() => {
    api.get("/admin/captains").then((res) => setCaptains(res.data || [])).catch(() => toast.error("Failed to load captains"));
  }, []);

  // Slots + turnout are polled, not fetched once — this screen is exactly
  // where admin watches confirmations land live to decide when there's
  // enough turnout to create the auction (see ConfirmedPlayersPanel below),
  // so it needs to update without a manual refresh, same as Voting Windows.
  // Pulled out of the effect (rather than an inline closure) so
  // ConfirmedPlayersPanel's mark-vote controls can trigger the same refetch
  // immediately after admin sets someone's vote here, not just on the next
  // poll tick.
  const fetchSlotsAndVotes = useCallback(async () => {
    await Promise.all([
      api.get("/admin/window").then((res) => setSlots(res.data.windows || [])).catch(() => {}),
      api.get("/admin/dashboard").then((res) => setVoteMatrix(res.data.vote_matrix || [])).catch(() => {}),
    ]);
  }, []);

  useEffect(() => {
    fetchSlotsAndVotes();
    const interval = setInterval(fetchSlotsAndVotes, SLOT_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchSlotsAndVotes]);

  // Informational only — Captain A/B can be any active captain (they're
  // running the draft, not required to be in the player pool themselves).
  const availableVoterCount = useMemo(() => {
    if (!selectedSlotId) return 0;
    return voteMatrix.filter((row) => row.votes.some((v) => v.slot_id === selectedSlotId && v.availability === "available")).length;
  }, [voteMatrix, selectedSlotId]);

  // What create_auction will actually see once captains are picked — the
  // panel below excludes them from the pool the same way the backend does,
  // so an odd category there means creation will be rejected until a
  // player's category is changed via Manage Players.
  const excludeCaptainIds = useMemo(
    () => new Set([captainAId, captainBId].filter(Boolean)),
    [captainAId, captainBId]
  );

  // Practice auctions don't need real votes/categories — any active voter
  // (captain or player) is a fair pick for a rehearsal pool, minus whoever's
  // running the draft this time.
  const practicePlayerCandidates = useMemo(
    () => voteMatrix
      .map((row) => row.captain)
      .filter((c) => c.id !== practiceCaptainAId && c.id !== practiceCaptainBId),
    [voteMatrix, practiceCaptainAId, practiceCaptainBId]
  );

  const togglePracticePlayer = (id) => {
    setPracticePlayerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

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

  const handleCreatePractice = async (e) => {
    e.preventDefault();
    if (!practiceCaptainAId || !practiceCaptainBId) return;
    if (practiceCaptainAId === practiceCaptainBId) { toast.error("Pick two different captains"); return; }
    if (practicePlayerIds.size < 2) { toast.error("Pick at least 2 players for the rehearsal"); return; }
    setCreatingPractice(true);
    try {
      const res = await api.post("/admin/auction/practice", {
        captain_a_id: practiceCaptainAId, captain_b_id: practiceCaptainBId,
        player_ids: Array.from(practicePlayerIds),
      });
      toast.success("Practice auction created — copy the link below for the two captains");
      localStorage.setItem(STORAGE_KEY, res.data.auction_id);
      setAuctionId(res.data.auction_id);
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to create practice auction");
    } finally {
      setCreatingPractice(false);
    }
  };

  const handleCopyPracticeLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/auction/${auctionId}`);
      toast.success("Link copied — send it to the two captains");
    } catch {
      toast.error("Couldn't copy — your browser may be blocking clipboard access");
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

  const handlePause = async () => {
    setPausing(true);
    try {
      await api.post(`/admin/auction/${auctionId}/pause`);
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to pause");
    } finally {
      setPausing(false);
    }
  };

  const handleResume = async () => {
    setResuming(true);
    try {
      await api.post(`/admin/auction/${auctionId}/resume`);
      refetch();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to resume");
    } finally {
      setResuming(false);
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
    setPracticeCaptainAId("");
    setPracticeCaptainBId("");
    setPracticePlayerIds(new Set());
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
          <div className="flex items-center gap-3">
            {auction?.status === "active" && <CountdownBadge endsAtIso={auction.ends_at_iso} />}
            {auctionId && (
              <button onClick={handleNewAuction} className="flex items-center gap-1 text-xs text-gray-500 hover:text-pitch-600">
                <RefreshCw size={13} /> Start a new auction
              </button>
            )}
          </div>
        </div>

        {!auctionId && slots.length > 0 && (
          <div className="card">
            <h2 className="font-bold text-gray-900 mb-1">Compare Available Slots</h2>
            <p className="text-xs text-gray-500 mb-3">
              Live turnout per candidate slot — pick whichever has enough confirmed players
              in each category before setting up the auction below.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {slots.map(({ slot }) => (
                <button
                  key={slot.id}
                  type="button"
                  onClick={() => { setSelectedSlotId(slot.id); setCaptainAId(""); setCaptainBId(""); }}
                  className={`text-left rounded-lg border-2 px-3 py-2.5 transition-colors ${
                    selectedSlotId === slot.id ? "border-pitch-400 bg-pitch-50" : "border-gray-200 bg-white hover:border-gray-300"
                  }`}
                >
                  <p className="text-xs font-semibold text-gray-700 mb-2">{slot.day} {slot.match_time || slot.time_of_day}</p>
                  <ConfirmedPlayersPanel voteMatrix={voteMatrix} slotId={slot.id} compact />
                </button>
              ))}
            </div>
          </div>
        )}

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

              {/* Same live per-category view as the comparison strip above, now
                  scoped to just the selected slot with the picked captains excluded
                  — exactly what create_auction will see. */}
              {selectedSlotId && (
                <ConfirmedPlayersPanel voteMatrix={voteMatrix} slotId={selectedSlotId} excludeIds={excludeCaptainIds} onVoteSet={fetchSlotsAndVotes} />
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

        {!auctionId && (
          <div className="card border-2 border-amber-200">
            <div className="flex items-center gap-2 mb-1">
              <FlaskConical size={16} className="text-amber-600" />
              <h2 className="font-bold text-gray-900">Practice Auction (Rehearsal)</h2>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Let two captains try out the live-bidding screen with any players you pick — no real votes,
              budgets, or player stats are touched. Won't show up in anyone's "Join Auction" badge; you'll
              get a link to share manually once it's created.
            </p>
            <form onSubmit={handleCreatePractice} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Captain A</label>
                  <select className="input-field" value={practiceCaptainAId} onChange={(e) => setPracticeCaptainAId(e.target.value)} required>
                    <option value="">Select a team…</option>
                    {captains.map((c) => (
                      <option key={c.id} value={c.id} disabled={c.id === practiceCaptainBId}>
                        {c.name}{c.team_name ? ` — ${c.team_name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Captain B</label>
                  <select className="input-field" value={practiceCaptainBId} onChange={(e) => setPracticeCaptainBId(e.target.value)} required>
                    <option value="">Select a team…</option>
                    {captains.map((c) => (
                      <option key={c.id} value={c.id} disabled={c.id === practiceCaptainAId}>
                        {c.name}{c.team_name ? ` — ${c.team_name}` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Players ({practicePlayerIds.size} picked — pick at least 2, ideally 2+ per category for realistic bidding)
                </label>
                <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y">
                  {practicePlayerCandidates.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={practicePlayerIds.has(p.id)}
                        onChange={() => togglePracticePlayer(p.id)}
                      />
                      <span className="text-gray-800">{p.name}</span>
                      {p.auction_category && (
                        <span className="text-xs text-gray-400">{GROUP_LABELS[p.auction_category] || p.auction_category}</span>
                      )}
                    </label>
                  ))}
                  {practicePlayerCandidates.length === 0 && (
                    <p className="text-xs text-gray-400 px-3 py-2">No other captains/players to pick from yet.</p>
                  )}
                </div>
              </div>

              <button type="submit" disabled={creatingPractice} className="btn-secondary text-sm py-2 px-4">
                {creatingPractice ? "Creating…" : "Create Practice Auction"}
              </button>
            </form>
          </div>
        )}

        {auctionId && loading && <p className="text-gray-500 text-sm">Loading…</p>}

        {auctionId && auction && (
          <>
            {auction.is_test && (
              <div className="flex items-center justify-between gap-3 flex-wrap bg-amber-100 border-2 border-amber-400 text-amber-900 rounded-lg px-4 py-2.5 text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <FlaskConical size={16} /> PRACTICE AUCTION — no real votes, budgets, or player stats are affected
                </span>
                <button
                  type="button"
                  onClick={handleCopyPracticeLink}
                  className="flex items-center gap-1.5 text-xs font-medium bg-white border border-amber-300 rounded-lg px-3 py-1.5 hover:bg-amber-50"
                >
                  <Link2 size={13} /> Copy Practice Link
                </button>
              </div>
            )}

            <AuctionRulesNote auction={auction} />

            {auction.status !== "completed" && <FairnessBanner />}

            {auction.is_complete && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 text-green-800 rounded-lg px-4 py-3 text-sm font-medium">
                <CheckCircle2 size={18} /> Live auction complete — close it below, then copy the teams for WhatsApp.
              </div>
            )}

            {auction.status === "pending" && (
              <div className="card text-center py-6">
                <p className="text-gray-600 mb-1">Auction created — not started yet.</p>
                <p className="text-sm mb-4">
                  {auction.captain_a_joined && auction.captain_b_joined ? (
                    <span className="text-green-700 font-medium">✅ Both captains have joined — ready to start.</span>
                  ) : (
                    <span className="text-gray-500">Waiting for both captains to open "Join Auction" from their navbar…</span>
                  )}
                </p>
                <div className="flex items-center justify-center gap-5 mb-4 text-sm">
                  {[auction.captain_a, auction.captain_b].map((c, i) => {
                    const joined = i === 0 ? auction.captain_a_joined : auction.captain_b_joined;
                    return (
                      <span key={c.captain_id} className={`flex items-center gap-1.5 ${joined ? "text-green-700 font-medium" : "text-gray-400"}`}>
                        {joined ? <CheckCircle2 size={15} /> : <span className="w-2.5 h-2.5 rounded-full border-2 border-gray-300" />}
                        {c.name}
                      </span>
                    );
                  })}
                </div>
                <div className="flex items-center justify-center gap-3">
                  <button onClick={handleStart} disabled={starting} className="btn-primary flex items-center gap-2 text-sm py-2 px-4">
                    <PlayCircle size={16} /> {starting ? "Starting…" : "Start Auction (25 min clock)"}
                  </button>
                  <button onClick={handleCancelPending} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800">
                    <StopCircle size={13} /> Cancel
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-3">
                  You don't have to wait — Start works either way, and releases the first player automatically.
                </p>
              </div>
            )}

            {auction.status === "active" && (
              <div className="card">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h2 className="font-bold text-gray-900">Release a Player</h2>
                  <div className="flex items-center gap-3">
                    {auction.auto_release_category && (
                      auction.is_paused ? (
                        <button
                          onClick={handleResume}
                          disabled={resuming}
                          className="flex items-center gap-1 text-xs py-1.5 px-3 rounded-lg border border-pitch-300 text-pitch-700 bg-white hover:bg-pitch-50 disabled:opacity-50"
                        >
                          <PlayCircle size={13} /> {resuming ? "Resuming…" : "Resume Auto-Release"}
                        </button>
                      ) : (
                        <button
                          onClick={handlePause}
                          disabled={pausing}
                          className="flex items-center gap-1 text-xs py-1.5 px-3 rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
                        >
                          <Pause size={13} /> {pausing ? "Pausing…" : "Pause Auto-Release"}
                        </button>
                      )
                    )}
                    <button onClick={handleClose} className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800">
                      <StopCircle size={13} /> Force Close
                    </button>
                  </div>
                </div>

                {auction.auto_release_category && (
                  <p className="text-xs text-gray-500 mb-3">
                    {auction.is_paused ? (
                      <>Paused — currently on <strong>{GROUP_LABELS[auction.auto_release_category]}</strong>. Resume to continue automatically through the rest of the auction.</>
                    ) : (
                      <>Auto-releasing <strong>{GROUP_LABELS[auction.auto_release_category]}</strong> — every player comes up on its own as each one's bidding resolves, and the auction moves on to the next category by itself once this one's done. No further clicks needed.</>
                    )}
                  </p>
                )}

                {auction.current_player && (
                  <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
                    {auction.current_player.deprioritized ? (
                      <>Re-offering <strong>{auction.current_player.name}</strong> — both captains passed on them earlier; everyone else in this category is done.</>
                    ) : (
                      <>Currently bidding: <strong>{auction.current_player.name}</strong></>
                    )}
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

            {auction.current_player && <PlayerInsightsCard player={auction.current_player} />}

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

            {auction.status !== "pending" && <ReleaseOrderLog auctionId={auctionId} />}
          </>
        )}
      </div>
    </div>
  );
}
