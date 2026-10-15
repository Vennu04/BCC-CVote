// Shared loading/empty placeholders so every admin page renders the same
// "nothing to show yet" language instead of each page inlining its own
// ad-hoc <p>Loading…</p> / empty-state string.
export function LoadingState({ label = "Loading…" }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <div className="w-8 h-8 rounded-full border-[3px] border-brand-line border-t-brand-navy animate-spin" />
      <p className="text-brand-muted text-sm">{label}</p>
    </div>
  );
}

export function EmptyState({ message }) {
  return <div className="text-center py-12 text-brand-muted text-sm">{message}</div>;
}
