import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../utils/api";
import Navbar from "../components/Navbar";
import VotingSlots from "../components/VotingSlots";
import { useAuth } from "../context/AuthContext";
import { useVoting } from "../hooks/useVoting";
import { useMyAuction } from "../hooks/useMyAuction";
import { Gavel, ChevronRight } from "lucide-react";

// Home — replaces Player Dashboard, Captain Dashboard and the admins' "My
// Votes" page: a live-auction banner when there is one, my own numbers,
// then one card per match to vote on.
export default function Home() {
  const { user } = useAuth();
  const voting = useVoting();
  const liveAuctionId = useMyAuction();
  const [me, setMe] = useState(null);

  useEffect(() => {
    api.get("/attendance/leaderboard")
      .then((res) => {
        const board = res.data.leaderboard || [];
        const i = board.findIndex((e) => e.is_me);
        if (i >= 0) setMe({ ...board[i], rank: i + 1, of: board.length });
      })
      .catch(() => {});
  }, []);

  const firstName = (user?.name || "").split(" ")[0];
  const isCaptain = user?.role === "captain";
  const openCount = voting.rows.filter(({ window }) => window?.is_open).length;

  return (
    <div className="min-h-screen bg-brand-ground">
      <Navbar />
      <div className="bg-brand-navy text-white">
        <div className="max-w-3xl mx-auto px-4 pt-3 pb-5">
          <h1 className="text-2xl font-black">Hi {firstName} 👋</h1>
          <p className="text-sm text-white/60">
            {isCaptain ? `Captain${user?.team_name ? ` · ${user.team_name}` : ""}` : "Player"}
            {" · "}{openCount ? `${openCount} match${openCount > 1 ? "es" : ""} open for voting` : "no voting open right now"}
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-3 pb-8 space-y-4">
        {liveAuctionId && (
          <Link to={`/auction/${liveAuctionId}`}
            className="block rounded-2xl p-4 text-white bg-gradient-to-r from-red-700 to-red-600 shadow-soft-lg">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-black bg-white/20 rounded-full px-2 py-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" /> LIVE
            </span>
            <span className="flex items-center justify-between mt-1.5">
              <span className="text-lg font-black">The auction is live</span>
              <span className="inline-flex items-center gap-1 bg-brand-gold text-brand-navy font-black text-sm rounded-xl px-3 py-2">
                <Gavel size={15} /> Join <ChevronRight size={15} />
              </span>
            </span>
          </Link>
        )}

        <div className="grid grid-cols-3 gap-2">
          <Stat value={me?.attendance_percentage != null ? `${Math.round(me.attendance_percentage)}%` : "—"} label="Attendance" to="/stats" />
          <Stat value={`${voting.votedCount}/${voting.rows.length}`} label="Voted" />
          {isCaptain
            ? <Stat value={user?.matches_played ?? 0} label="Played" to="/me" />
            : <Stat value={me ? `#${me.rank}` : "—"} label="Rank" to="/stats" />}
        </div>

        <VotingSlots voting={voting} />
      </div>
    </div>
  );
}

function Stat({ value, label, to }) {
  const body = (
    <>
      <span className="block text-2xl font-black text-brand-navy tabular-nums">{value}</span>
      <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</span>
    </>
  );
  const cls = "bg-white rounded-2xl shadow-soft py-3 text-center block";
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
