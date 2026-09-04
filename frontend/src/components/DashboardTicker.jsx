// Royal-blue scoreboard ticker strip — mirrors AdminDashboard.jsx's inline
// ticker pattern (kept separate/new rather than shared with Admin, since
// Admin itself must stay untouched), used only by CaptainDashboard and
// PlayerDashboard. Every item comes from data already fetched by the caller
// — this component never invents numbers itself.
export default function DashboardTicker({ items, live }) {
  return (
    <div className="bg-royal-700 border-b border-sky-400/10 flex items-center overflow-x-auto scroll-touch">
      {live && (
        <div className="flex items-center gap-2 px-4 py-2 bg-red-500 flex-shrink-0">
          <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
          <span className="text-[10.5px] font-black tracking-wide text-white">LIVE</span>
        </div>
      )}
      <div className="flex items-center flex-wrap gap-x-1">
        {items.map((t, i) => (
          <div key={t.label} className={`flex items-center gap-2 px-4 py-2 whitespace-nowrap ${i > 0 ? "border-l border-white/10" : ""}`}>
            <span className={`text-[11px] font-extrabold ${t.color || "text-sky-400"}`}>{t.label}</span>
            <span className="text-[11px] font-medium text-white/50">{t.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
