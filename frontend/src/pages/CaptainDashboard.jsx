import { useAuth } from "../context/AuthContext";
import { useVoting } from "../hooks/useVoting";
import Navbar from "../components/Navbar";
import VotingSlots from "../components/VotingSlots";
import DashboardTicker from "../components/DashboardTicker";
import DashboardStatCard from "../components/DashboardStatCard";
import { Shield } from "lucide-react";

const STATUS_META = {
  not_played:  { label: "Not played match yet", color: "bg-white/5 text-white/50 border-white/10", accent: "bg-white/20" },
  in_progress: { label: "In-Progress",          color: "bg-blue-500/10 text-blue-400 border-blue-500/30", accent: "bg-blue-400" },
  qualified:   { label: "Qualified",            color: "bg-green-500/10 text-green-400 border-green-500/30", accent: "bg-green-400" },
  eliminated:  { label: "Eliminated",           color: "bg-red-500/10 text-red-400 border-red-500/30", accent: "bg-red-400" },
};

export default function CaptainDashboard() {
  const { user } = useAuth();
  const voting = useVoting();
  const status = STATUS_META[user?.tournament_status] || STATUS_META.not_played;

  // Real-data ticker — only what's already loaded on this page (user profile
  // + the voting hook's own state), same "no invented numbers" rule as
  // AdminDashboard's ticker.
  const anyOpen = voting.rows.some(({ window }) => window?.is_open);
  const tickerItems = [
    { label: "VOTING", value: `${voting.votedCount} OF ${voting.rows.length} VOTED`, color: "text-green-400" },
    { label: "STATUS", value: status.label.toUpperCase(), color: "text-sky-400" },
    { label: "TEAM", value: `${user?.team_code || ""}${user?.team_name ? ` · ${user.team_name}` : ""}`, color: "text-amber-400" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-royal-900 via-royal-800 to-royal-900">
      <Navbar />

      <DashboardTicker items={tickerItems} live={anyOpen} />

      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white">Welcome back, Captain {user?.name} 👋</h1>
          <p className="text-white/45 text-sm mt-1">
            Mark your availability for this weekend's matches — each match has its own voting window
          </p>
        </div>

        {/* Scoreboard-style stat cards — same visual grammar as
            AdminDashboard's stat row, converted to real captain-facing
            fields (this app has no per-captain "squad size"/"points left"
            outside an active auction, so those aren't shown here). */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <DashboardStatCard accent="bg-sky-400" value={user?.matches_scheduled ?? 0} label="Scheduled" />
          <DashboardStatCard accent="bg-amber-400" value={user?.matches_played ?? 0} label="Played" />
          <DashboardStatCard accent={status.accent} value={status.label} label="Tournament Status" small />
          <DashboardStatCard
            accent="bg-green-400"
            value={<span className="inline-flex items-center gap-1.5 justify-center"><Shield size={18} className="text-sky-400" />{user?.team_code}</span>}
            label={user?.team_name || "My Team"}
            small
          />
        </div>

        <VotingSlots voting={voting} />
      </div>
    </div>
  );
}
