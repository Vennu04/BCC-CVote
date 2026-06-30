from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from bson import ObjectId
from datetime import datetime
import pytz

from .. import mongo
from ..utils.auth import captain_required, get_current_user
from ..utils.time_utils import (
    is_voting_window_open, seconds_until_close,
    format_ist, now_ist, get_upcoming_weekend_dates
)

votes_bp = Blueprint("votes", __name__)


def _get_active_window():
    return mongo.db.voting_windows.find_one({"is_active": True})


def _serialize_slot(slot):
    return {
        "id": str(slot["_id"]),
        "slot_number": slot["slot_number"],
        "day": slot["day"],
        "time_of_day": slot["time_of_day"],
        "label": f"Slot {slot['slot_number']} — {slot['day']} {slot['time_of_day']}",
    }


# ── Slots ──────────────────────────────────────────────────────────────────────

@votes_bp.route("/slots", methods=["GET"])
@jwt_required()
def get_slots():
    slots = list(mongo.db.match_slots.find().sort("slot_number", 1))
    return jsonify([_serialize_slot(s) for s in slots])


# ── Voting window status ───────────────────────────────────────────────────────

@votes_bp.route("/votes/status", methods=["GET"])
@jwt_required()
def voting_status():
    window = _get_active_window()
    if not window:
        return jsonify({"is_open": False, "message": "No active voting window set"})

    opens_at = window["opens_at"]
    closes_at = window["closes_at"]
    is_open = is_voting_window_open(opens_at, closes_at)

    return jsonify({
        "is_open": is_open,
        "opens_at": format_ist(opens_at),
        "closes_at": format_ist(closes_at),
        "seconds_remaining": seconds_until_close(closes_at) if is_open else 0,
        "weekend": get_upcoming_weekend_dates(),
    })


# ── Captain's own votes ────────────────────────────────────────────────────────

@votes_bp.route("/votes/my", methods=["GET"])
@jwt_required()
def my_votes():
    user = get_current_user()
    window = _get_active_window()
    if not window:
        return jsonify({"votes": [], "window": None})

    my_votes = list(mongo.db.votes.find({
        "captain_id": str(user["_id"]),
        "window_id": str(window["_id"]),
    }))

    votes_by_slot = {v["slot_id"]: v for v in my_votes}
    slots = list(mongo.db.match_slots.find().sort("slot_number", 1))

    result = []
    for slot in slots:
        sid = str(slot["_id"])
        vote = votes_by_slot.get(sid)
        result.append({
            "slot": _serialize_slot(slot),
            "availability": vote["availability"] if vote else None,
            "voted_at": format_ist(vote["voted_at"]) if vote else None,
        })

    return jsonify({
        "votes": result,
        "window": {
            "is_open": is_voting_window_open(window["opens_at"], window["closes_at"]),
            "closes_at": format_ist(window["closes_at"]),
            "seconds_remaining": seconds_until_close(window["closes_at"]),
        },
    })


# ── Submit / update a vote ─────────────────────────────────────────────────────

@votes_bp.route("/votes", methods=["POST"])
@jwt_required()
def submit_vote():
    window = _get_active_window()
    if not window:
        return jsonify({"error": "No active voting window"}), 400

    if not is_voting_window_open(window["opens_at"], window["closes_at"]):
        return jsonify({"error": "Voting window is closed"}), 403

    user = get_current_user()
    data = request.get_json(silent=True) or {}
    slot_id = data.get("slot_id")
    availability = data.get("availability")

    if not slot_id or availability not in ("available", "not_available", "maybe"):
        return jsonify({"error": "slot_id and valid availability required"}), 400

    slot = mongo.db.match_slots.find_one({"_id": ObjectId(slot_id)})
    if not slot:
        return jsonify({"error": "Slot not found"}), 404

    now = datetime.utcnow()
    filter_q = {
        "captain_id": str(user["_id"]),
        "slot_id": slot_id,
        "window_id": str(window["_id"]),
    }
    update_doc = {
        "$set": {"availability": availability, "updated_at": now},
        "$setOnInsert": {"captain_id": str(user["_id"]), "slot_id": slot_id,
                          "window_id": str(window["_id"]), "voted_at": now},
    }
    mongo.db.votes.update_one(filter_q, update_doc, upsert=True)

    return jsonify({"message": "Vote recorded", "slot_id": slot_id, "availability": availability})


# ── Public vote summary (counts per slot — visible to all captains) ────────────

@votes_bp.route("/votes/summary", methods=["GET"])
@jwt_required()
def vote_summary():
    window = _get_active_window()
    if not window:
        return jsonify({"summary": [], "window": None})

    slots = list(mongo.db.match_slots.find().sort("slot_number", 1))
    all_votes = list(mongo.db.votes.find({"window_id": str(window["_id"])}))

    summary = []
    for slot in slots:
        sid = str(slot["_id"])
        slot_votes = [v for v in all_votes if v["slot_id"] == sid]
        summary.append({
            "slot": _serialize_slot(slot),
            "counts": {
                "available": sum(1 for v in slot_votes if v["availability"] == "available"),
                "not_available": sum(1 for v in slot_votes if v["availability"] == "not_available"),
                "maybe": sum(1 for v in slot_votes if v["availability"] == "maybe"),
                "no_response": 0,  # filled in after fetching total captains
            },
            "total_voted": len(slot_votes),
        })

    total_captains = mongo.db.users.count_documents({"role": "captain", "is_active": True})
    for item in summary:
        item["counts"]["no_response"] = total_captains - item["total_voted"]
        item["total_captains"] = total_captains

    return jsonify({
        "summary": summary,
        "window": {
            "is_open": is_voting_window_open(window["opens_at"], window["closes_at"]),
            "closes_at": format_ist(window["closes_at"]),
        },
    })
