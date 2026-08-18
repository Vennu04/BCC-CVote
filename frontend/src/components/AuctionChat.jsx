import { useState, useRef, useEffect } from "react";
import toast from "react-hot-toast";
import { MessageCircle, Send } from "lucide-react";
import { playTurnAlertSound, vibrateTurnAlert } from "../utils/turnAlert";

// Shared between the captain-facing Auction page and the admin control
// panel -- both already poll the same GET /auction/:id every 2.5s (see
// useAuction), and chat_feed rides along in that same response, so this
// needs no polling of its own. Lets captains ask the admin conducting the
// auction a quick question (or each other) without falling back to a phone
// call mid-bid, which is what was happening before this existed.
export default function AuctionChat({ chatFeed, currentUserId, onSend, sending }) {
  const [text, setText] = useState("");
  const feed = chatFeed || [];
  const scrollRef = useRef(null);
  const seenCountRef = useRef(null);

  // Alerts on a NEW message from someone else the same way "your turn"
  // already does (sound + vibrate + toast) -- easy to miss otherwise since
  // nothing else on screen visually points at the chat card. Baseline is
  // set on first mount without alerting, same pattern as the bid-feed
  // toast effect in Auction.jsx, so loading an auction with history doesn't
  // fire a burst of alerts for messages sent before this page was open.
  useEffect(() => {
    if (seenCountRef.current === null) {
      seenCountRef.current = feed.length;
      return;
    }
    if (feed.length > seenCountRef.current) {
      const newOnes = feed.slice(seenCountRef.current);
      const fromOthers = newOnes.filter((m) => m.sender_id !== currentUserId);
      if (fromOthers.length > 0) {
        playTurnAlertSound();
        vibrateTurnAlert();
        const last = fromOthers[fromOthers.length - 1];
        toast(`${last.sender_name}: ${last.message}`, { duration: 5000, icon: "💬" });
      }
      seenCountRef.current = feed.length;
    }
  }, [feed, currentUserId]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [feed.length]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
  };

  return (
    <div className="card">
      <h3 className="font-bold text-gray-900 mb-3 text-sm flex items-center gap-2">
        <MessageCircle size={16} className="text-pitch-600" /> Auction Chat
      </h3>
      <div ref={scrollRef} className="space-y-2 max-h-64 overflow-y-auto mb-3">
        {feed.length === 0 && (
          <p className="text-xs text-gray-400">No messages yet — ask here if anything's unclear.</p>
        )}
        {feed.map((m, i) => {
          const isMe = m.sender_id === currentUserId;
          return (
            <div key={i} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  isMe
                    ? "bg-pitch-600 text-white"
                    : m.sender_role === "admin"
                    ? "bg-amber-100 text-amber-900"
                    : "bg-gray-100 text-gray-800"
                }`}
              >
                {!isMe && (
                  <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70 mb-0.5">
                    {m.sender_name}
                    {m.sender_role === "admin" ? " (Admin)" : ""}
                  </p>
                )}
                <p className="whitespace-pre-wrap break-words">{m.message}</p>
                <p className={`text-[10px] mt-0.5 ${isMe ? "text-white/70" : "text-gray-400"}`}>{m.created_at}</p>
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <input
          type="text"
          className="input-field flex-1"
          placeholder="Message the room…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="icon-btn bg-pitch-600 hover:bg-pitch-700 text-white disabled:opacity-50 shrink-0"
          aria-label="Send message"
        >
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
