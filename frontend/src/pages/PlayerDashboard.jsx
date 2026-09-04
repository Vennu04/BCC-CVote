import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useVoting } from "../hooks/useVoting";
import api from "../utils/api";
import Navbar from "../components/Navbar";
import VotingSlots from "../components/VotingSlots";
import DashboardTicker from "../components/DashboardTicker";
import DashboardStatCard from "../components/DashboardStatCard";
import { Gavel } from "lucide-react";

export default function PlayerDashboard() {
  const { user } = useAuth();
  const voting = useVoting();

  // Both non-critical, same "fetch once, fail silently" pattern
  // AdminDashboard's insights card already uses — this page fully works
  // without either, they only add ticker/stat-card content when available.
  const [myAuctionId, setMyAuctionId] = useState(null);
  useEffect(() => {
    api.get("/auction/my-active").then((res) => setMyAuctionId(res.data?.auction_id || null)).catch(() => {});
  }, []);

  const [attendancePct, setAttendancePct] = useState(null);
  useEffect(() => {
    if (!user?.name) return;
    api.get("/attendance/leaderboard").then((res) => {
      const { leaderboard, total_matches_organized } = res.data;
      const mine = leaderboard.find((e) => e.name === user.name);
      if (mine && total_matches_organized) {
        setAttendancePct(Math.round((mine.attendance_count / total_matches_organized) * 100));
      }
    }).catch(() => {});
  }, [user?.name]);

  // Real-data ticker — only what's already loaded/fetched on this page, same
  // "no invented numbers" rule as AdminDashboard's ticker.
  const anyOpen = voting.rows.some(({ window }) => window?.is_open);
  const tickerItems = [
    { label: "VOTING", value: `${voting.votedCount} OF ${voting.rows.length} VOTED`, color: "text-green-400" },
    { label: "TEAM CODE", value: user?.team_code || "—", color: "text-sky-400" },
    { label: "AUCTION", value: myAuctionId ? "IN PROGRESS — JOIN NOW" : "NO ACTIVE AUCTION", color: myAuctionId ? "text-amber-400" : "text-white/40" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-royal-900 via-royal-800 to-royal-900">
      <Navbar />

      <DashboardTicker items={tickerItems} live={anyOpen} />

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white">Welcome back, {user?.name} 👋</h1>
          <p className="text-white/45 text-sm mt-1">
            Mark your availability for this weekend's matches — each match has its own voting window
          </p>
        </div>

        {/* Scoreboard-style stat cards — same visual grammar as
            AdminDashboard's stat row. A player's own /auth/me profile
            carries far less than a captain's (no matches_scheduled/played,
            no tournament_status), so this row leans on the voting hook's
            own state plus the two small non-critical fetches above rather
            than inventing fields that don't exist for this role. */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
          <DashboardStatCard accent="bg-green-400" value={voting.votedCount} label="Slots Voted" />
          <DashboardStatCard
            accent="bg-sky-400"
            value={attendancePct !== null ? `${attendancePct}%` : "—"}
            label="Attendance"
          />
          <DashboardStatCard
            accent={myAuctionId ? "bg-amber-400" : "bg-white/20"}
            value={
              myAuctionId
                ? <span className="inline-flex items-center gap-1.5 justify-center"><Gavel size={16} className="text-amber-400" />Live</span>
                : "No Auction"
            }
            label="Auction Status"
            small
          />
        </div>

        <VotingSlots voting={voting} />
      </div>
    </div>
  );
}
