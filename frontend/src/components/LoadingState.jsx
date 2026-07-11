// Shared loading/empty placeholders so every admin page renders the same
// "nothing to show yet" language instead of each page inlining its own
// ad-hoc <p>Loading…</p> / empty-state string.
export function LoadingState({ label = "Loading…" }) {
  return <p className="text-gray-500 text-sm py-8 text-center">{label}</p>;
}

export function EmptyState({ message }) {
  return <div className="text-center py-12 text-gray-400 text-sm">{message}</div>;
}
