export default function VoteButton({ label, emoji, active, onClick, disabled, colorActive, colorIdle }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center justify-center gap-1.5 px-4 min-h-[44px] rounded-xl border text-sm font-medium transition-all duration-150 flex-1 sm:flex-none active:scale-[0.96]
        ${active ? colorActive : colorIdle}
        ${disabled ? "opacity-50 cursor-not-allowed active:scale-100" : "cursor-pointer"}
        ${active ? "shadow-soft scale-[1.02]" : ""}`}
    >
      <span>{emoji}</span>
      <span>{label}</span>
    </button>
  );
}
