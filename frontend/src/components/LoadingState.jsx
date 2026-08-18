// Shared loading/empty placeholders so every admin page renders the same
// "nothing to show yet" language instead of each page inlining its own
// ad-hoc <p>Loading…</p> / empty-state string.
export function LoadingState({ label = "Loading…" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <div className="w-8 h-8 rounded-full border-[3px] border-pitch-200 border-t-pitch-600 animate-spin" />
      <p className="text-gray-500 text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({ message }) {
  return <div className="text-center py-12 text-gray-400 text-sm">{message}</div>;
}
