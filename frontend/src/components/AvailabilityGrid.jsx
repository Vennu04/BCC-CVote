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
  if (!matrix?.length) return <p className="text-gray-500 text-sm">No votes yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-gray-50">
            <th className="text-left px-4 py-3 font-semibold text-gray-700 border-b">Captain</th>
            <th className="text-left px-4 py-3 font-semibold text-gray-700 border-b">Team</th>
            {slots?.map((s) => (
              <th key={s.slot_number} className="px-4 py-3 font-semibold text-gray-700 border-b text-center whitespace-nowrap">
                <div className="text-xs text-gray-500">{s.day}</div>
                <div>{s.time_of_day}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, i) => (
            <tr key={row.captain.id} className={i % 2 === 0 ? "bg-white" : "bg-gray-50/50"}>
              <td className="px-4 py-3 font-medium text-gray-900 border-b">{row.captain.name}</td>
              <td className="px-4 py-3 border-b">
                <span className="bg-cricket-navy text-white text-xs font-bold px-2 py-0.5 rounded">
                  {row.captain.team_code}
                </span>
              </td>
              {row.votes.map((vote) => (
                <td key={vote.slot_id} className="px-4 py-3 border-b text-center">
                  {vote.availability ? (
                    <span className={BADGE[vote.availability]}>
                      {LABEL[vote.availability]}
                    </span>
                  ) : (
                    <span className="badge-no-response">— No Vote</span>
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
