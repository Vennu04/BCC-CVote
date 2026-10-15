import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../utils/api";
import Navbar from "../components/Navbar";
import VotingSlots from "../components/VotingSlots";
import DateRequestsCard from "../components/DateRequestsCard";
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
        <div className="max-w-3xl mx-auto px-4 pt-4 pb-9">
          <h1 className="text-[26px] font-extrabold leading-tight">Hi {firstName}</h1>
          <p className="text-sm text-white/80 mt-0.5">
            {isCaptain ? `Captain${user?.team_name ? ` · ${user.team_name}` : ""}` : "Player"}
            {" · "}{openCount ? `${openCount} match${openCount > 1 ? "es" : ""} open for voting` : "no voting open right now"}
          </p>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 -mt-5 pb-8 space-y-3.5">
        {liveAuctionId && (
          <Link to={`/auction/${liveAuctionId}`}
            className="flex items-center justify-between gap-3 rounded-2xl px-4 py-3.5 text-white bg-[#c8102e] shadow-soft-lg">
            <span className="flex flex-col gap-1">
              <span className="inline-flex items-center gap-1.5 text-xs font-extrabold tracking-wider">
                <span className="w-2 h-2 rounded-full bg-white animate-pulse" /> LIVE NOW
              </span>
              <span className="text-[17px] font-extrabold leading-tight">The auction is live</span>
            </span>
            <span className="flex items-center">
              <span className="inline-flex items-center gap-1 bg-brand-gold text-brand-navy font-extrabold text-[15px] rounded-xl px-3.5 py-3 whitespace-nowrap">
                <Gavel size={15} /> Join <ChevronRight size={15} />
              </span>
            </span>
          </Link>
        )}

        <DateRequestsCard />

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
      <span className="block font-display font-extrabold text-[30px] leading-none text-brand-navy tabular-nums">{value}</span>
      <span className="block text-xs font-bold text-brand-muted mt-1">{label}</span>
    </>
  );
  const cls = "bg-white rounded-2xl shadow-soft py-3 px-2 text-center block";
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}
