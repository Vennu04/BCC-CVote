import { CATEGORIES } from "../utils/categories";

// The coloured short tag for an auction group (EP-AR, P-BAT, ...). `full`
// adds the group's full name after the tag.
export default function CategoryTag({ category, full = false, className = "" }) {
  const c = CATEGORIES[category];
  if (!c) {
    return <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-extrabold bg-amber-50 text-amber-800 ${className}`}>No group</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`}>
      <span className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-extrabold tracking-wide ${c.chip}`} title={c.label}>{c.short}</span>
      {full && <span className="text-sm font-semibold text-brand-ink">{c.label}</span>}
    </span>
  );
}
