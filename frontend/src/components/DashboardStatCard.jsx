// Scoreboard-style stat card — top colored accent bar, big condensed
// numeral/value, small-caps label underneath. Mirrors AdminDashboard.jsx's
// inline stat-card markup (kept separate/new rather than shared with Admin,
// since Admin itself must stay untouched), used only by CaptainDashboard
// and PlayerDashboard, on the lighter `.card-dark-light` tone.
export default function DashboardStatCard({ accent = "bg-sky-400", value, label, small = false }) {
  return (
    <div className="card-dark-light text-center relative overflow-hidden !p-0">
      <div className={`h-[3px] ${accent}`} />
      <div className="p-4">
        {/* `small` — for text values (a status label) that would overflow the
            default big-numeral treatment used for plain counts. */}
        <p className={`text-white leading-tight ${small ? "text-base font-extrabold" : "text-3xl font-black"}`}>{value}</p>
        <p className="text-[11px] font-bold text-white/40 uppercase tracking-wide mt-1">{label}</p>
      </div>
    </div>
  );
}
