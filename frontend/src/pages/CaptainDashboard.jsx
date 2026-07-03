import { useAuth } from "../context/AuthContext";
import { useVoting } from "../hooks/useVoting";
import Navbar from "../components/Navbar";
import VotingSlots from "../components/VotingSlots";
import { Shield } from "lucide-react";

const STATUS_META = {
  not_played:  { label: "Not played match yet", color: "bg-gray-100 text-gray-600" },
  in_progress: { label: "In-Progress",          color: "bg-blue-100 text-blue-700" },
  qualified:   { label: "Qualified",            color: "bg-green-100 text-green-700" },
  eliminated:  { label: "Eliminated",           color: "bg-red-100 text-red-700" },
};

export default function CaptainDashboard() {
  const { user } = useAuth();
  const voting = useVoting();
  const status = STATUS_META[user?.tournament_status] || STATUS_META.not_played;

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Hey Captain {user?.name} 👋</h1>
          <p className="text-gray-500 text-sm mt-1">
            Mark your availability for this weekend's matches — each match has its own voting window
          </p>
        </div>

        {/* My Team card */}
        <div className="card mb-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-cricket-navy text-white rounded-lg p-2.5">
              <Shield size={20} />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">My Team</p>
              <p className="font-bold text-gray-900">{user?.team_name || <span className="text-gray-400 italic">No team name set</span>}</p>
              <p className="text-xs text-gray-500">Code: {user?.team_code}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-center">
              <p className="text-lg font-bold text-pitch-600">{user?.matches_scheduled ?? 0}</p>
              <p className="text-[11px] text-gray-500 uppercase">Scheduled</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-cricket-navy">{user?.matches_played ?? 0}</p>
              <p className="text-[11px] text-gray-500 uppercase">Played</p>
            </div>
            <span className={`text-xs font-semibold rounded-full px-3 py-1.5 ${status.color}`}>
              {status.label}
            </span>
          </div>
        </div>

        <VotingSlots voting={voting} />
      </div>
    </div>
  );
}
