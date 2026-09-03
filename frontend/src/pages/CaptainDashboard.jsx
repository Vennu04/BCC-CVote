import { useAuth } from "../context/AuthContext";
import { useVoting } from "../hooks/useVoting";
import Navbar from "../components/Navbar";
import VotingSlots from "../components/VotingSlots";
import { Shield } from "lucide-react";

const STATUS_META = {
  not_played:  { label: "Not played match yet", color: "bg-white/5 text-white/50 border-white/10" },
  in_progress: { label: "In-Progress",          color: "bg-blue-500/10 text-blue-400 border-blue-500/30" },
  qualified:   { label: "Qualified",            color: "bg-green-500/10 text-green-400 border-green-500/30" },
  eliminated:  { label: "Eliminated",           color: "bg-red-500/10 text-red-400 border-red-500/30" },
};

export default function CaptainDashboard() {
  const { user } = useAuth();
  const voting = useVoting();
  const status = STATUS_META[user?.tournament_status] || STATUS_META.not_played;

  return (
    <div className="min-h-screen bg-gradient-to-br from-royal-950 via-royal-900 to-royal-950">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white">Welcome back, Captain {user?.name} 👋</h1>
          <p className="text-white/45 text-sm mt-1">
            Mark your availability for this weekend's matches — each match has its own voting window
          </p>
        </div>

        {/* My Team card */}
        <div className="card-dark mb-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-sky-400/10 border border-sky-400/25 text-sky-400 rounded-xl p-3">
              <Shield size={20} />
            </div>
            <div>
              <p className="text-xs text-white/40 uppercase tracking-wide font-medium">My Team</p>
              <p className="font-bold text-white">{user?.team_name || <span className="text-white/30 italic">No team name set</span>}</p>
              <p className="text-xs text-white/40">Code: {user?.team_code}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-lg font-black text-sky-400">{user?.matches_scheduled ?? 0}</p>
              <p className="text-[11px] text-white/40 uppercase">Scheduled</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-black text-white">{user?.matches_played ?? 0}</p>
              <p className="text-[11px] text-white/40 uppercase">Played</p>
            </div>
            <span className={`text-xs font-semibold rounded-full px-3 py-1.5 border ${status.color}`}>
              {status.label}
            </span>
          </div>
        </div>

        <VotingSlots voting={voting} />
      </div>
    </div>
  );
}
