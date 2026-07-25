// Backend-computed status (see admin.py's _window_status) -> display chip.
// Shared between the Voting Windows page and the Admin Dashboard so both
// show the exact same label/color for a given window state.
export const STATUS_STYLES = {
  scheduled: { label: "NOT OPEN YET", className: "bg-gray-100 text-gray-600" },
  open: { label: "OPEN", className: "bg-green-100 text-green-700" },
  closed: { label: "CLOSED", className: "bg-gray-100 text-gray-600" },
  auction_completed: { label: "LIVE AUCTION COMPLETED", className: "bg-blue-100 text-blue-700" },
  cancelled: { label: "CANCELLED", className: "bg-red-100 text-red-700" },
};
