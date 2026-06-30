import csv
import io
from datetime import datetime
from .time_utils import utc_to_ist


SLOT_LABELS = {
    1: "Saturday Morning",
    2: "Saturday Evening",
    3: "Sunday Morning",
    4: "Sunday Evening",
}

AVAILABILITY_LABELS = {
    "available": "Available",
    "not_available": "Not Available",
    "maybe": "Maybe",
    None: "No Response",
}


def build_csv_report(captains: list, slots: list, votes: list) -> str:
    """Build CSV string: rows=captains, columns=slots."""
    output = io.StringIO()
    slot_headers = [SLOT_LABELS.get(s["slot_number"], f"Slot {s['slot_number']}") for s in slots]
    writer = csv.writer(output)

    writer.writerow(["Captain", "Team Code"] + slot_headers + ["Voted At"])

    # Build vote lookup: (captain_id, slot_id) → availability
    vote_map = {}
    voted_at_map = {}
    for v in votes:
        vote_map[(v["captain_id"], v["slot_id"])] = v.get("availability")
        voted_at_map[v["captain_id"]] = v.get("voted_at")

    for captain in captains:
        cid = captain["_id"]
        row = [captain["name"], captain.get("team_code", "")]
        for slot in slots:
            availability = vote_map.get((cid, str(slot["_id"])))
            row.append(AVAILABILITY_LABELS.get(availability, "No Response"))
        voted_at = voted_at_map.get(cid)
        row.append(utc_to_ist(voted_at).strftime("%d %b %Y %I:%M %p IST") if voted_at else "Not voted")
        writer.writerow(row)

    # Summary row
    writer.writerow([])
    summary_row = ["TOTAL AVAILABLE", ""]
    for slot in slots:
        count = sum(
            1 for v in votes
            if v["slot_id"] == str(slot["_id"]) and v.get("availability") == "available"
        )
        summary_row.append(count)
    summary_row.append("")
    writer.writerow(summary_row)

    return output.getvalue()
