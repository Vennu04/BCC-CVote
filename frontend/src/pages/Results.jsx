import { useState, useEffect } from "react";
import api from "../utils/api";
import Navbar from "../components/Navbar";
import { BarChart2 } from "lucide-react";

const AVAILABILITY_COLOR = {
  available:     "bg-green-500",
  not_available: "bg-red-500",
  maybe:         "bg-yellow-400",
  no_response:   "bg-gray-200",
};

export default function Results() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/votes/summary")
      .then((res) => setData(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="min-h-screen"><Navbar />
      <div className="flex items-center justify-center h-64"><p className="text-gray-500">Loading…</p></div>
    </div>
  );

  const summary = data?.summary || [];
  const window = data?.window;

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex items-center gap-2 mb-6">
          <BarChart2 className="text-pitch-600" size={24} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Availability Results</h1>
            <p className="text-sm text-gray-500">
              {window?.is_open ? `Voting closes: ${window.closes_at}` : "Voting is closed"}
            </p>
          </div>
        </div>

        {summary.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-500">No results yet. Voting hasn't started.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {summary.map((item) => {
              const { slot, counts, total_captains, total_voted } = item;
              const pct = (v) => total_captains > 0 ? Math.round((v / total_captains) * 100) : 0;

              return (
                <div key={slot.id} className="card">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{slot.day}</p>
                      <p className="font-bold text-gray-900">{slot.time_of_day}</p>
                    </div>
                    <span className="text-xs bg-gray-100 text-gray-600 rounded-full px-2.5 py-1">
                      {total_voted}/{total_captains} voted
                    </span>
                  </div>

                  {/* Stacked bar */}
                  <div className="flex h-3 rounded-full overflow-hidden mb-3 bg-gray-100">
                    {counts.available > 0 && (
                      <div className="bg-green-500 transition-all" style={{ width: `${pct(counts.available)}%` }} />
                    )}
                    {counts.maybe > 0 && (
                      <div className="bg-yellow-400 transition-all" style={{ width: `${pct(counts.maybe)}%` }} />
                    )}
                    {counts.not_available > 0 && (
                      <div className="bg-red-500 transition-all" style={{ width: `${pct(counts.not_available)}%` }} />
                    )}
                  </div>

                  {/* Legend */}
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />{counts.available} Available</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-yellow-400 inline-block" />{counts.maybe} Maybe</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />{counts.not_available} Not Available</span>
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-200 inline-block" />{counts.no_response} No Response</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
