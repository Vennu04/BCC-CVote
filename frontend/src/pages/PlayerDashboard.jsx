import { useAuth } from "../context/AuthContext";
import { useVoting } from "../hooks/useVoting";
import Navbar from "../components/Navbar";
import VotingSlots from "../components/VotingSlots";

export default function PlayerDashboard() {
  const { user } = useAuth();
  const voting = useVoting();

  return (
    <div className="min-h-screen bg-cricket-cream">
      <Navbar />
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Hey {user?.name} 👋</h1>
          <p className="text-gray-500 text-sm mt-1">
            Mark your availability for this weekend's matches — each match has its own voting window
          </p>
        </div>

        <VotingSlots voting={voting} />
      </div>
    </div>
  );
}
