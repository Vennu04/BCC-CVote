from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from bson import ObjectId
from datetime import datetime
import pytz

from .. import mongo
from ..utils.auth import get_current_user
from ..utils.time_utils import (
    is_voting_window_open, seconds_until_close,
    format_ist, now_ist, suggested_window_for_slot,
    can_revoke_vote, revoke_deadline_for_window
)

votes_bp = Blueprint("votes", __name__)

# Kept in sync with admin.py's VOTER_FILTER — a handful of role=="admin"
# accounts are flagged is_player=True so the same login can also vote; this
# is what counts them into the voter total here too.
VOTER_FILTER = {"$or": [{"role": {"$in": ["captain", "player"]}}, {"is_player": True}]}


def _get_active_window(slot_id):
    return mongo.db.voting_windows.find_one({"slot_id": slot_id, "is_active": True})


def _window_info(window, slot=None):
    if not window:
        return {"is_open": False, "opens_at": None, "closes_at": None, "seconds_remaining": 0,
                "can_revoke": False, "revoke_deadline": None}
    is_open = is_voting_window_open(window["opens_at"], window["closes_at"])
    info = {
        "is_open": is_open,
        "opens_at": format_ist(window["opens_at"]),
        "closes_at": format_ist(window["closes_at"]),
        "seconds_remaining": seconds_until_close(window["closes_at"]) if is_open else 0,
        "can_revoke": False,
        "revoke_deadline": None,
    }
    if slot:
        info["can_revoke"] = can_revoke_vote(window, slot)
        deadline = revoke_deadline_for_window(window, slot)
        info["revoke_deadline"] = format_ist(deadline) if deadline else None
    return info


def _serialize_slot(slot):
    return {
        "id": str(slot["_id"]),
        "slot_number": slot["slot_number"],
        "day": slot["day"],
        "time_of_day": slot["time_of_day"],
        "match_time": slot.get("match_time", ""),
        "description": slot.get("description", ""),
        "match_date": slot.get("match_date"),
        "is_adhoc": slot.get("is_adhoc", False),
        "label": f"{slot['day']} {slot.get('match_time', slot['time_of_day'])}",
    }


# ── Slots ──────────────────────────────────────────────────────────────────────

@votes_bp.route("/slots", methods=["GET"])
@jwt_required()
def get_slots():
    slots = list(mongo.db.match_slots.find({"is_active": {"$ne": False}}).sort("slot_number", 1))
    return jsonify([_serialize_slot(s) for s in slots])


# ── Voting window status ───────────────────────────────────────────────────────

@votes_bp.route("/votes/status", methods=["GET"])
@jwt_required()
def voting_status():
    slots = list(mongo.db.match_slots.find({"is_active": {"$ne": False}}).sort("slot_number", 1))
    result = []
    for slot in slots:
        window = _get_active_window(str(slot["_id"]))
        result.append({"slot": _serialize_slot(slot), **_window_info(window)})
    return jsonify({"slots": result})


# ── Captain's own votes ────────────────────────────────────────────────────────

@votes_bp.route("/votes/my", methods=["GET"])
@jwt_required()
def my_votes():
    user = get_current_user()
    slots = list(mongo.db.match_slots.find({"is_active": {"$ne": False}}).sort("slot_number", 1))

    result = []
    for slot in slots:
        sid = str(slot["_id"])
        window = _get_active_window(sid)
        vote = None
        if window:
            vote = mongo.db.votes.find_one({
                "captain_id": str(user["_id"]),
                "slot_id": sid,
                "window_id": str(window["_id"]),
            })
        result.append({
            "slot": _serialize_slot(slot),
            "availability": vote["availability"] if vote else None,
            "voted_at": format_ist(vote["voted_at"]) if vote else None,
            "window": _window_info(window, slot),
        })

    return jsonify({"votes": result})


# ── Submit / update a vote ─────────────────────────────────────────────────────

@votes_bp.route("/votes", methods=["POST"])
@jwt_required()
def submit_vote():
    user = get_current_user()
    data = request.get_json(silent=True) or {}
    slot_id = data.get("slot_id")
    availability = data.get("availability")

    if not slot_id or availability not in ("available", "not_available", "maybe"):
        return jsonify({"error": "slot_id and valid availability required"}), 400

    slot = mongo.db.match_slots.find_one({"_id": ObjectId(slot_id)})
    if not slot:
        return jsonify({"error": "Slot not found"}), 404
    if slot.get("is_active") is False:
        return jsonify({"error": "This match has been removed"}), 400

    window = _get_active_window(slot_id)
    if not window:
        return jsonify({"error": "No active voting window for this match"}), 400
    if not is_voting_window_open(window["opens_at"], window["closes_at"]):
        return jsonify({"error": "Voting window is closed for this match"}), 403

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


# ── Emergency revoke: withdraw a vote after the window has closed ─────────────

@votes_bp.route("/votes/<slot_id>", methods=["DELETE"])
@jwt_required()
def revoke_vote(slot_id):
    user = get_current_user()
    slot = mongo.db.match_slots.find_one({"_id": ObjectId(slot_id)})
    if not slot:
        return jsonify({"error": "Slot not found"}), 404

    window = _get_active_window(slot_id)
    if not window or not can_revoke_vote(window, slot):
        deadline = format_ist(revoke_deadline_for_window(window, slot)) if window else None
        msg = f"Revoke deadline has passed (was {deadline})" if deadline else "No voting window for this match"
        return jsonify({"error": msg}), 403

    result = mongo.db.votes.delete_one({
        "captain_id": str(user["_id"]),
        "slot_id": slot_id,
        "window_id": str(window["_id"]),
    })
    if result.deleted_count == 0:
        return jsonify({"error": "No vote to revoke"}), 404

    return jsonify({"message": "Vote revoked"})


# ── Bulk: mark captain not available for entire week ──────────────────────────

@votes_bp.route("/votes/not-available-week", methods=["POST"])
@jwt_required()
def not_available_week():
    user = get_current_user()
    slots = list(mongo.db.match_slots.find({"is_active": {"$ne": False}}))
    now = datetime.utcnow()

    updated, skipped = 0, 0
    for slot in slots:
        slot_id = str(slot["_id"])
        window = _get_active_window(slot_id)
        if not window or not is_voting_window_open(window["opens_at"], window["closes_at"]):
            skipped += 1
            continue

        filter_q = {
            "captain_id": str(user["_id"]),
            "slot_id": slot_id,
            "window_id": str(window["_id"]),
        }
        mongo.db.votes.update_one(filter_q, {
            "$set": {"availability": "not_available", "updated_at": now},
            "$setOnInsert": {"captain_id": str(user["_id"]), "slot_id": slot_id,
                             "window_id": str(window["_id"]), "voted_at": now},
        }, upsert=True)
        updated += 1

    if updated == 0:
        return jsonify({"error": "No open voting windows right now"}), 400

    return jsonify({"message": f"Marked not available for {updated} match(es)", "updated": updated, "skipped": skipped})


# ── Vote summary — admin only ──────────────────────────────────────────────────

@votes_bp.route("/votes/summary", methods=["GET"])
@jwt_required()
def vote_summary():
    slots = list(mongo.db.match_slots.find({"is_active": {"$ne": False}}).sort("slot_number", 1))
    total_captains = mongo.db.users.count_documents({"is_active": True, **VOTER_FILTER})

    summary = []
    for slot in slots:
        sid = str(slot["_id"])
        window = _get_active_window(sid)
        slot_votes = list(mongo.db.votes.find({"slot_id": sid, "window_id": str(window["_id"])})) if window else []
        total_voted = len(slot_votes)
        summary.append({
            "slot": _serialize_slot(slot),
            "window": _window_info(window),
            "counts": {
                "available": sum(1 for v in slot_votes if v["availability"] == "available"),
                "not_available": sum(1 for v in slot_votes if v["availability"] == "not_available"),
                "maybe": sum(1 for v in slot_votes if v["availability"] == "maybe"),
                "no_response": total_captains - total_voted,
            },
            "total_voted": total_voted,
            "total_captains": total_captains,
        })

    return jsonify({"summary": summary})
