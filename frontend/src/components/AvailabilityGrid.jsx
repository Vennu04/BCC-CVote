const BADGE = {
  available:     "badge-available",
  not_available: "badge-not-available",
  maybe:         "badge-maybe",
};
const LABEL = {
  available:     "✅ Available",
  not_available: "❌ Not Available",
  maybe:         "🤔 Maybe",
};

export default function AvailabilityGrid({ matrix, slots }) {
  if (!matrix?.length) return <p className="text-white/40 text-sm">No votes yet.</p>;

  return (
    <div className="overflow-x-auto scroll-touch">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-royal-800">
            <th className="sticky left-0 z-10 bg-royal-800 text-left px-4 py-3 font-semibold text-white/60 border-b border-white/10">Captain</th>
            <th className="text-left px-4 py-3 font-semibold text-white/60 border-b border-white/10">Team</th>
            {slots?.map((s) => (
              <th key={s.slot_number} className="px-4 py-3 font-semibold text-white/60 border-b border-white/10 text-center whitespace-nowrap">
                <div className="text-xs text-white/35">{s.day}</div>
                <div>{s.time_of_day}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={row.captain.id} className={i % 2 === 0 ? "bg-royal-600" : "bg-royal-700/40"}>
              <td className={`sticky left-0 z-10 px-4 py-3 font-medium text-white border-b border-white/10 ${i % 2 === 0 ? "bg-royal-600" : "bg-royal-700"}`}>{row.captain.name}</td>
              <td className="px-4 py-3 border-b border-white/10">
                <span className="bg-sky-400/10 border border-sky-400/25 text-sky-400 text-xs font-bold px-2.5 py-1 rounded-lg">
                  {row.captain.team_code}
                </span>
              </td>
              {row.votes.map((vote) => (
                <td key={vote.slot_id} className="px-4 py-3 border-b border-white/10 text-center">
                  {vote.availability ? (
                    <span className={BADGE[vote.availability]}>
                      {LABEL[vote.availability]}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-white/5 text-white/40 border border-white/10">— No Vote</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
