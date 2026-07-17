"""Shared "which match is chronologically next, and who's voted available for
it" logic — originally built for Manage Players' availability tag, now also
consumed by the live-auction Player Insights panel (auction.py) so both
places agree on exactly the same match and the same definition of
"available" without duplicating the query."""

from .. import mongo
from ..utils.time_utils import get_next_match_slot


def _get_active_window(slot_id):
    return mongo.db.voting_windows.find_one({"slot_id": slot_id, "is_active": True})


def next_match_context():
    """
    (slot, availability_map) for whichever active match_slots doc is
    chronologically next. availability_map is {user_id_str: True} for every
    voter with an explicit "available" vote logged against that match's
    current voting window. Anyone missing from the map — no vote yet, an
    explicit not_available/maybe, or no window open at all for that slot —
    is treated as unavailable by the caller, since every consumer of this
    (the Players dashboard tag, the auction Insights panel) is deliberately
    binary, not tri-state.
    """
    slots = list(mongo.db.match_slots.find({"is_active": {"$ne": False}}))
    # A slot whose current window was cancelled ("not enough players") isn't
    # a real upcoming match this week -- skip it so "next match" falls
    # through to whichever slot is actually still on.
    candidate_slots = [
        s for s in slots
        if not (w := _get_active_window(str(s["_id"]))) or not w.get("is_cancelled")
    ]
    slot, _ = get_next_match_slot(candidate_slots)
    if not slot:
        return None, {}
    window = _get_active_window(str(slot["_id"]))
    if not window:
        return slot, {}
    votes = mongo.db.votes.find({
        "slot_id": str(slot["_id"]), "window_id": str(window["_id"]), "availability": "available",
    })
    return slot, {v["captain_id"]: True for v in votes}


def next_match_label(slot):
    if not slot:
        return None
    label = f"{slot['day']} {slot['time_of_day']}"
    if slot.get("is_adhoc") and slot.get("match_date"):
        label += f" ({slot['match_date']})"
    return label
