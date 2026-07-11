import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import api from "../utils/api";
import { ChevronDown, ChevronUp, Check, HelpCircle, X as XIcon } from "lucide-react";

// Same "X yet to vote" toggle language as ConfirmedPlayersPanel, but for a
// different job: instead of just showing who hasn't voted, it lets admin
// mark a vote on their behalf right there — for the real-world case where a
// captain/player couldn't cast their own vote in time (mobile issues,
// travel, work) and asks admin to do it. Posts straight to the admin-only
// /admin/votes override endpoint (see admin.py) rather than the self-service
// /votes route, so it works regardless of whether this slot's window is
// still open.
export default function YetToVotePanel({ matrix, slotId, noResponseCount, onVoteSet }) {
  const [expanded, setExpanded] = useState(false);
  const [markingId, setMarkingId] = useState(null);

  const pending = useMemo(() => {
    return matrix
      .filter((row) => {
        const vote = row.votes.find((v) => v.slot_id === slotId);
        return !vote?.availability;
      })
      .map((row) => row.captain)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [matrix, slotId]);

  if (noResponseCount === 0) {
    return <span className="text-gray-400">— {noResponseCount}</span>;
  }

  const handleMark = async (personId, personName, availability) => {
    setMarkingId(personId);
    try {
      await api.post("/admin/votes", { user_id: personId, slot_id: slotId, availability });
      toast.success(`${personName} marked ${availability.replace("_", " ")}`);
      await onVoteSet();
    } catch (err) {
      toast.error(err.response?.data?.error || "Failed to set vote");
    } finally {
      setMarkingId(null);
    }
  };

  return (
    <div className="text-left">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-gray-400 hover:text-gray-600"
      >
        — {noResponseCount} yet to vote {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
      </button>

      {expanded && (
        <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
          {pending.map((person) => (
            <div key={person.id} className="flex items-center justify-between gap-2 bg-gray-50 rounded px-2 py-1">
              <span className="truncate text-gray-700" title={person.name}>
                {person.name}{person.role === "captain" ? " (C)" : ""}
              </span>
              <div className="flex gap-1 shrink-0">
                <button
                  onClick={() => handleMark(person.id, person.name, "available")}
                  disabled={markingId === person.id}
                  className="p-1 rounded bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50"
                  title={`Mark ${person.name} available`}
                >
                  <Check size={11} />
                </button>
                <button
                  onClick={() => handleMark(person.id, person.name, "maybe")}
                  disabled={markingId === person.id}
                  className="p-1 rounded bg-yellow-100 text-yellow-700 hover:bg-yellow-200 disabled:opacity-50"
                  title={`Mark ${person.name} maybe`}
                >
                  <HelpCircle size={11} />
                </button>
                <button
                  onClick={() => handleMark(person.id, person.name, "not_available")}
                  disabled={markingId === person.id}
                  className="p-1 rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                  title={`Mark ${person.name} not available`}
                >
                  <XIcon size={11} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
