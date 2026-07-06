import { useState, useEffect, useMemo } from "react";
import api from "../../utils/api";
import toast from "react-hot-toast";
import Navbar from "../../components/Navbar";
import { useAuction } from "../../hooks/useAuction";
import { Gavel, PlayCircle, StopCircle, RefreshCw } from "lucide-react";

const STORAGE_KEY = "bcc_active_auction_id";

const GROUP_LABELS = {
  extra_power_allrounder: "Extra Power — All-Rounders",
  extra_power_batsman: "Extra Power — Batsmen",
  power: "Power",
  classic: "Classic",
};

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
  const [selectedByGroup, setSelectedByGroup] = useState({});

  // Keep each category's dropdown selection valid as players get sold/released —
  // default to the first still-available player in that group.
  useEffect(() => {
    if (!auction?.available_players) return;
    setSelectedByGroup((prev) => {
      const next = { ...prev };
      for (const group of Object.keys(GROUP_LABELS)) {
        const players = auction.available_players.filter((p) => p.category === group);
        if (!players.some((p) => p.id === next[group])) {
          next[group] = players[0]?.id || "";
        }
      }
      return next;
    });
  }, [auction?.available_players]);

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

  const handleRelease = async (playerId) => {
    setReleasing(playerId);
    try {
      await api.post(`/admin/auction/${auctionId}/release`, { player_id: playerId });
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

  const handleNewAuction = () => {
    localStorage.removeItem(STORAGE_KEY);
    setAuctionId(null);
    setSelectedSlotId("");
    setCaptainAId("");
    setCaptainBId("");
  };

  return (
    <div className="min-h-screen bg-cricket-cream">
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
            {auction.status === "pending" && (
              <div className="card text-center py-6">
                <p className="text-gray-600 mb-3">Auction created — not started yet.</p>
                <button onClick={handleStart} disabled={starting} className="btn-primary flex items-center gap-2 text-sm py-2 px-4 mx-auto">
                  <PlayCircle size={16} /> {starting ? "Starting…" : "Start Auction (25 min clock)"}
                </button>
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
                  const players = (auction.available_players || []).filter((p) => p.category === group);
                  if (players.length === 0) return null;
                  const selectedId = selectedByGroup[group] || "";
                  return (
                    <div key={group} className="mb-4">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
                      <div className="flex items-center gap-2">
                        <select
                          className="input-field flex-1"
                          value={selectedId}
                          onChange={(e) => setSelectedByGroup({ ...selectedByGroup, [group]: e.target.value })}
                          disabled={!!auction.current_player}
                        >
                          {players.map((p) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={() => handleRelease(selectedId)}
                          disabled={!selectedId || releasing === selectedId || !!auction.current_player}
                          className="text-sm py-1.5 px-3 rounded-lg border border-pitch-300 text-pitch-700 bg-white hover:bg-pitch-50 disabled:opacity-50 whitespace-nowrap"
                        >
                          {releasing === selectedId ? "Releasing…" : "Release"}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {(auction.available_players || []).length === 0 && (
                  <p className="text-sm text-gray-500">All players have been sold or assigned.</p>
                )}
              </div>
            )}

            {auction.status === "completed" && (
              <div className="card text-center py-6 text-green-700 font-medium">Auction completed.</div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[["Team A", auction.captain_a], ["Team B", auction.captain_b]].map(([label, c]) => (
                <div key={c.captain_id} className="card">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
                      <h3 className="font-bold text-gray-900">{c.name}</h3>
                    </div>
                    <span className="text-sm font-semibold text-pitch-700">{c.points_remaining} pts left</span>
                  </div>
                  <p className="text-xs text-gray-500 mb-2">{c.roster_count} players picked</p>
                  {c.roster?.length > 0 && (
                    <div className="border-t pt-2 space-y-1">
                      {c.roster.map((p) => (
                        <div key={p.user_id} className="flex items-center justify-between text-xs">
                          <span className="text-gray-800">{p.name}</span>
                          <span className="text-gray-400">
                            {GROUP_LABELS[p.category] || p.category} —{" "}
                            {p.assigned_via === "leftover_free" ? "free" : `${p.price} pts`}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
