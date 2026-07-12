import { useState, useEffect } from "react";
import api from "../utils/api";
import { ChevronDown, ChevronUp, ListOrdered } from "lucide-react";

const GROUP_LABELS = {
  extra_power_allrounder: "Extra Power — All-Rounders",
  extra_power_batsman: "Extra Power — Batsmen",
  power: "Power",
  classic: "Classic",
};

// Same cadence as useAuction's bidding poll, but only while expanded -- a
// captain who leaves this open sees new releases land without collapsing
// and reopening it, and it costs nothing when collapsed.
const POLL_INTERVAL_MS = 2500;

// View-only, full release-order history — the auditable record referenced
// by PlayerInsightsCard's "Release order" line, so the fixed rule can be
// verified from the actual sequence of events after the fact, not just
// trusted from the current player's own justification.
export default function ReleaseOrderLog({ auctionId }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const fetchLog = async () => {
      try {
        const res = await api.get(`/auction/${auctionId}/release-log`);
        if (!cancelled) setEntries(res.data.entries || []);
      } catch {
        // Silent — a supplementary audit view, not core bidding
        // functionality; a failed poll just leaves the last-known log up.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    setLoading(true);
    fetchLog();
    const interval = setInterval(fetchLog, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, [open, auctionId]);

  return (
    <div className="card">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 text-left"
      >
        <div className="flex items-center gap-2">
          <ListOrdered size={16} className="text-cricket-navy" />
          <h3 className="font-bold text-gray-900 text-sm">Release Order Log</h3>
          <span className="text-xs text-gray-400">(auditable, view-only)</span>
        </div>
        {open ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {open && (
        <div className="mt-3 max-h-80 overflow-y-auto">
          {loading && entries.length === 0 ? (
            <p className="text-xs text-gray-400">Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-xs text-gray-400">No players released yet.</p>
          ) : (
            <table className="min-w-full text-xs">
              <thead>
                <tr className="text-gray-400 text-left">
                  <th className="font-medium pb-1 pr-3">#</th>
                  <th className="font-medium pb-1 pr-3">Player</th>
                  <th className="font-medium pb-1 pr-3">Category</th>
                  <th className="font-medium pb-1">Released At</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.order_index} className="border-t border-gray-100">
                    <td className="py-1.5 pr-3 text-gray-400 font-mono">{e.order_index}</td>
                    <td className="py-1.5 pr-3 text-gray-800 font-medium">{e.player_name}</td>
                    <td className="py-1.5 pr-3 text-gray-500">{GROUP_LABELS[e.category] || e.category}</td>
                    <td className="py-1.5 text-gray-400">{e.released_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
