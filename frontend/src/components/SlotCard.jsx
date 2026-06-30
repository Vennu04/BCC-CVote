import VoteButton from "./VoteButton";
import { Sun, Sunset } from "lucide-react";

const DAY_COLORS = {
  Saturday: "from-blue-50 to-blue-100 border-blue-200",
  Sunday:   "from-purple-50 to-purple-100 border-purple-200",
};

const TIME_ICONS = {
  Morning: <Sun size={20} className="text-yellow-500" />,
  Evening: <Sunset size={20} className="text-orange-500" />,
};

export default function SlotCard({ slot, currentVote, onVote, disabled, loading }) {
  return (
    <div className={`rounded-xl border-2 bg-gradient-to-br p-5 ${DAY_COLORS[slot.day] || "from-gray-50 to-gray-100 border-gray-200"}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {TIME_ICONS[slot.time_of_day]}
          <div>
            <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{slot.day}</p>
            <p className="font-bold text-gray-900">{slot.time_of_day}</p>
          </div>
        </div>
        <span className="text-xs bg-white text-gray-500 border border-gray-200 rounded-full px-2 py-0.5 font-medium">
          Slot {slot.slot_number}
        </span>
      </div>

      {/* Current vote badge */}
      {currentVote && (
        <div className="mb-3">
          <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${
            currentVote === "available"     ? "bg-green-100 text-green-800" :
            currentVote === "not_available" ? "bg-red-100 text-red-800" :
                                              "bg-yellow-100 text-yellow-800"
          }`}>
            {currentVote === "available" ? "✅ You voted Available" :
             currentVote === "not_available" ? "❌ You voted Not Available" :
             "🤔 You voted Maybe"}
          </span>
        </div>
      )}

      {/* Vote buttons */}
      <div className="flex gap-2 flex-wrap">
        <VoteButton
          label="Available"
          emoji="✅"
          value="available"
          active={currentVote === "available"}
          onClick={() => onVote(slot.id, "available")}
          disabled={disabled || loading}
          colorActive="bg-green-600 text-white border-green-600"
          colorIdle="bg-white text-green-700 border-green-300 hover:bg-green-50"
        />
        <VoteButton
          label="Maybe"
          emoji="🤔"
          value="maybe"
          active={currentVote === "maybe"}
          onClick={() => onVote(slot.id, "maybe")}
          disabled={disabled || loading}
          colorActive="bg-yellow-500 text-white border-yellow-500"
          colorIdle="bg-white text-yellow-700 border-yellow-300 hover:bg-yellow-50"
        />
        <VoteButton
          label="Not Available"
          emoji="❌"
          value="not_available"
          active={currentVote === "not_available"}
          onClick={() => onVote(slot.id, "not_available")}
          disabled={disabled || loading}
          colorActive="bg-red-600 text-white border-red-600"
          colorIdle="bg-white text-red-700 border-red-300 hover:bg-red-50"
        />
      </div>
    </div>
  );
}
