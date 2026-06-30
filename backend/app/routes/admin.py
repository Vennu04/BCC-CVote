from flask import Blueprint, request, jsonify, make_response
from flask_jwt_extended import jwt_required
from bson import ObjectId
from werkzeug.security import generate_password_hash
from datetime import datetime
import pytz

from .. import mongo
from ..utils.auth import admin_required
from ..utils.time_utils import (
    is_voting_window_open, format_ist, now_ist, IST
)
from ..utils.export import build_csv_report

admin_bp = Blueprint("admin", __name__)


def _user_to_dict(u):
    return {
        "id": str(u["_id"]),
        "name": u["name"],
        "team_code": u["team_code"],
        "role": u["role"],
        "is_active": u.get("is_active", True),
        "matches_scheduled": u.get("matches_scheduled", 0),
        "matches_played": u.get("matches_played", 0),
        "tournament_status": u.get("tournament_status", "not_played"),
        "created_at": format_ist(u.get("created_at")),
    }


def _get_active_window():
    return mongo.db.voting_windows.find_one({"is_active": True})


# ── Dashboard ──────────────────────────────────────────────────────────────────

@admin_bp.route("/dashboard", methods=["GET"])
@admin_required
def dashboard():
    window = _get_active_window()
    captains = list(mongo.db.users.find({"role": "captain", "is_active": True}).sort("name", 1))
    slots = list(mongo.db.match_slots.find().sort("slot_number", 1))

    if not window:
        return jsonify({
            "window": None,
            "captains": [_user_to_dict(c) for c in captains],
            "slots": [],
            "vote_matrix": [],
        })

    all_votes = list(mongo.db.votes.find({"window_id": str(window["_id"])}))
    vote_map = {(v["captain_id"], v["slot_id"]): v for v in all_votes}

    # Build captain × slot matrix
    matrix = []
    for captain in captains:
        cid = str(captain["_id"])
        row = {"captain": _user_to_dict(captain), "votes": []}
        for slot in slots:
            sid = str(slot["_id"])
            vote = vote_map.get((cid, sid))
            row["votes"].append({
                "slot_id": sid,
                "slot_label": f"Slot {slot['slot_number']}",
                "day": slot["day"],
                "time_of_day": slot["time_of_day"],
                "availability": vote["availability"] if vote else None,
                "voted_at": format_ist(vote["voted_at"]) if vote else None,
            })
        matrix.append(row)

    # Per-slot summary
    slot_summary = []
    for slot in slots:
        sid = str(slot["_id"])
        slot_votes = [v for v in all_votes if v["slot_id"] == sid]
        slot_summary.append({
            "slot_id": sid,
            "slot_number": slot["slot_number"],
            "day": slot["day"],
            "time_of_day": slot["time_of_day"],
            "label": f"Slot {slot['slot_number']} — {slot['day']} {slot['time_of_day']}",
            "available": sum(1 for v in slot_votes if v["availability"] == "available"),
            "not_available": sum(1 for v in slot_votes if v["availability"] == "not_available"),
            "maybe": sum(1 for v in slot_votes if v["availability"] == "maybe"),
            "no_response": len(captains) - len(slot_votes),
        })

    is_open = is_voting_window_open(window["opens_at"], window["closes_at"])
    return jsonify({
        "window": {
            "id": str(window["_id"]),
            "is_open": is_open,
            "opens_at": format_ist(window["opens_at"]),
            "closes_at": format_ist(window["closes_at"]),
        },
        "captains_total": len(captains),
        "captains_voted": len({v["captain_id"] for v in all_votes}),
        "slots": slot_summary,
        "vote_matrix": matrix,
    })


# ── Captains management ────────────────────────────────────────────────────────

@admin_bp.route("/captains", methods=["GET"])
@admin_required
def list_captains():
    captains = list(mongo.db.users.find({"role": "captain"}).sort("name", 1))
    return jsonify([_user_to_dict(c) for c in captains])


@admin_bp.route("/captains", methods=["POST"])
@admin_required
def add_captain():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    team_code = (data.get("team_code") or "").strip().upper()
    password = data.get("password") or team_code.lower()

    if not name or not team_code:
        return jsonify({"error": "name and team_code are required"}), 400

    if mongo.db.users.find_one({"team_code": team_code}):
        return jsonify({"error": "Team code already exists"}), 409

    doc = {
        "name": name,
        "team_code": team_code,
        "password_hash": generate_password_hash(password),
        "role": "captain",
        "is_active": True,
        "matches_scheduled": 0,
        "matches_played": 0,
        "tournament_status": "not_played",
        "created_at": datetime.utcnow(),
    }
    result = mongo.db.users.insert_one(doc)
    doc["_id"] = result.inserted_id
    return jsonify({
        "message": "Captain added",
        "captain": _user_to_dict(doc),
        "default_password": password,
    }), 201


@admin_bp.route("/captains/<captain_id>", methods=["PUT"])
@admin_required
def update_captain(captain_id):
    data = request.get_json(silent=True) or {}
    updates = {}
    if "name" in data:
        updates["name"] = data["name"].strip()
    if "is_active" in data:
        updates["is_active"] = bool(data["is_active"])
    if "password" in data and data["password"]:
        updates["password_hash"] = generate_password_hash(data["password"])
    if "team_code" in data:
        new_code = data["team_code"].strip().upper()
        if mongo.db.users.find_one({"team_code": new_code, "_id": {"$ne": ObjectId(captain_id)}}):
            return jsonify({"error": "Team code already taken"}), 409
        updates["team_code"] = new_code
    if "matches_scheduled" in data:
        updates["matches_scheduled"] = max(0, int(data["matches_scheduled"]))
    if "matches_played" in data:
        updates["matches_played"] = max(0, int(data["matches_played"]))
    if "tournament_status" in data:
        valid = {"not_played", "in_progress", "qualified", "eliminated"}
        if data["tournament_status"] not in valid:
            return jsonify({"error": "Invalid tournament_status"}), 400
        updates["tournament_status"] = data["tournament_status"]

    if not updates:
        return jsonify({"error": "No fields to update"}), 400

    result = mongo.db.users.update_one({"_id": ObjectId(captain_id)}, {"$set": updates})
    if result.matched_count == 0:
        return jsonify({"error": "Captain not found"}), 404

    updated = mongo.db.users.find_one({"_id": ObjectId(captain_id)})
    return jsonify({"message": "Captain updated", "captain": _user_to_dict(updated)})


@admin_bp.route("/captains/<captain_id>", methods=["DELETE"])
@admin_required
def remove_captain(captain_id):
    result = mongo.db.users.update_one(
        {"_id": ObjectId(captain_id), "role": "captain"},
        {"$set": {"is_active": False}}
    )
    if result.matched_count == 0:
        return jsonify({"error": "Captain not found"}), 404
    return jsonify({"message": "Captain deactivated"})


# ── Voting window management ───────────────────────────────────────────────────

@admin_bp.route("/window", methods=["GET"])
@admin_required
def get_window():
    window = _get_active_window()
    if not window:
        return jsonify({"window": None})
    return jsonify({
        "window": {
            "id": str(window["_id"]),
            "is_open": is_voting_window_open(window["opens_at"], window["closes_at"]),
            "opens_at": format_ist(window["opens_at"]),
            "closes_at": format_ist(window["closes_at"]),
        }
    })


@admin_bp.route("/window", methods=["POST"])
@admin_required
def set_window():
    """
    Body: { "opens_at": "2024-06-06T12:30:00", "closes_at": "2024-06-07T14:30:00" }
    Datetimes treated as IST.
    """
    data = request.get_json(silent=True) or {}
    try:
        opens_str = data["opens_at"]
        closes_str = data["closes_at"]
        opens_naive = datetime.fromisoformat(opens_str)
        closes_naive = datetime.fromisoformat(closes_str)
        opens_at = IST.localize(opens_naive).astimezone(pytz.utc).replace(tzinfo=None)
        closes_at = IST.localize(closes_naive).astimezone(pytz.utc).replace(tzinfo=None)
    except (KeyError, ValueError) as e:
        return jsonify({"error": f"Invalid datetime: {e}"}), 400

    if opens_at >= closes_at:
        return jsonify({"error": "opens_at must be before closes_at"}), 400

    # Deactivate previous windows
    mongo.db.voting_windows.update_many({}, {"$set": {"is_active": False}})
    result = mongo.db.voting_windows.insert_one({
        "opens_at": opens_at,
        "closes_at": closes_at,
        "is_active": True,
        "created_at": datetime.utcnow(),
    })
    return jsonify({
        "message": "Voting window set",
        "window_id": str(result.inserted_id),
        "opens_at": format_ist(opens_at),
        "closes_at": format_ist(closes_at),
    }), 201


@admin_bp.route("/window/close", methods=["POST"])
@admin_required
def close_window_early():
    window = _get_active_window()
    if not window:
        return jsonify({"error": "No active window to close"}), 404
    now = datetime.utcnow()
    mongo.db.voting_windows.update_one(
        {"_id": window["_id"]},
        {"$set": {"closes_at": now, "closed_early": True}}
    )
    return jsonify({"message": "Voting window closed early"})


# ── Export ─────────────────────────────────────────────────────────────────────

@admin_bp.route("/export/csv", methods=["GET"])
@admin_required
def export_csv():
    window = _get_active_window()
    captains = list(mongo.db.users.find({"role": "captain", "is_active": True}).sort("name", 1))
    slots = list(mongo.db.match_slots.find().sort("slot_number", 1))
    votes = list(mongo.db.votes.find(
        {"window_id": str(window["_id"])} if window else {"_id": None}
    ))

    csv_data = build_csv_report(captains, slots, votes)
    response = make_response(csv_data)
    response.headers["Content-Type"] = "text/csv"
    response.headers["Content-Disposition"] = (
        f"attachment; filename=bcc-cvote-availability-{datetime.utcnow().strftime('%Y%m%d')}.csv"
    )
    return response
