export default function VoteButton({ label, emoji, active, onClick, disabled, colorActive, colorIdle }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm font-medium transition-all duration-150
        ${active ? colorActive : colorIdle}
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
        ${active ? "shadow-sm scale-[1.02]" : ""}`}
    >
      <span>{emoji}</span>
      <span>{label}</span>
    </button>
  );
}
