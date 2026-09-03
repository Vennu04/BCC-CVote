import { useAuth } from "../context/AuthContext";
import { useVoting } from "../hooks/useVoting";
import Navbar from "../components/Navbar";
import VotingSlots from "../components/VotingSlots";

export default function PlayerDashboard() {
  const { user } = useAuth();
  const voting = useVoting();

  return (
    <div className="min-h-screen bg-gradient-to-br from-royal-950 via-royal-900 to-royal-950">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-white">Welcome back, {user?.name} 👋</h1>
          <p className="text-white/45 text-sm mt-1">
            Mark your availability for this weekend's matches — each match has its own voting window
          </p>
        </div>

        <VotingSlots voting={voting} />
      </div>
    </div>
  );
}
