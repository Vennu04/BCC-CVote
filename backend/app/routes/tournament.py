from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime, timedelta
import pytz

from .. import mongo
from ..utils.auth import admin_required
from ..utils.time_utils import IST, utcnow

tournament_bp = Blueprint("tournament", __name__)

GROUPS = ("A", "B", "C")


def _12h_display(value):
    try:
        return datetime.strptime(value, "%H:%M").strftime("%I:%M %p")
    except (TypeError, ValueError):
        return None


# A fixture only becomes a real votable/auctionable match once it has a date —
# this creates the same match_slots + voting_windows documents the manual
# admin.py add_slot()/set_window() flow would (so it shows up on the Window
# Dashboard and the Auction page's "Compare Available Slots" exactly like any
# other match), but triggered automatically from saving the fixture instead
# of two separate manual admin actions. Voting opens immediately and closes
# at the fixture's own kickoff time, so no extra date/duration picker is
# needed in the Tournament admin UI. Guarded by match_slot_id so re-saving an
# already-scheduled fixture (e.g. just updating the venue) never creates a
# second slot/window for the same fixture.
def _ensure_match_slot_and_window(fixture, team1, team2):
    if fixture.get("match_slot_id") or not fixture.get("date"):
        return None

    match_dt = datetime.fromisoformat(fixture["date"])
    time_str = fixture.get("time")
    if time_str:
        try:
            hh, mm = time_str.split(":")
            match_dt = match_dt.replace(hour=int(hh), minute=int(mm))
        except ValueError:
            time_str = None
    if not time_str:
        match_dt = match_dt.replace(hour=23, minute=59)  # end of match day, no kickoff time given

    opens_at = utcnow()
    closes_at = IST.localize(match_dt).astimezone(pytz.utc).replace(tzinfo=None)
    if closes_at <= opens_at:
        # Fixture date/time is already in the past (or right now) — give it a
        # short real window rather than opening a voting window that's
        # instantly closed and unusable.
        closes_at = opens_at + timedelta(hours=6)

    last_slot = mongo.db.match_slots.find_one(sort=[("slot_number", -1)])
    slot_doc = {
        "slot_number": (last_slot["slot_number"] + 1) if last_slot else 1,
        "day": datetime.fromisoformat(fixture["date"]).strftime("%A"),
        "time_of_day": "Evening" if (time_str and int(time_str.split(":")[0]) >= 16) else "Morning",
        "match_time": _12h_display(time_str) or "",
        "start_time": time_str,
        "end_time": None,
        "description": fixture.get("venue") or "",
        "match_date": fixture["date"],
        "is_adhoc": True,
        "is_active": True,
        "created_at": utcnow(),
        "team_a_id": str(team1["_id"]), "team_a_name": team1["name"],
        "team_b_id": str(team2["_id"]), "team_b_name": team2["name"],
        "group": fixture["group"],
        "tournament_fixture_id": str(fixture["_id"]),
    }
    slot_id = mongo.db.match_slots.insert_one(slot_doc).inserted_id

    mongo.db.voting_windows.insert_one({
        "slot_id": str(slot_id),
        "opens_at": opens_at,
        "closes_at": closes_at,
        "is_active": True,
        "created_at": utcnow(),
    })
    mongo.db.tournament_fixtures.update_one(
        {"_id": fixture["_id"]}, {"$set": {"match_slot_id": str(slot_id)}}
    )
    return str(slot_id)


def _object_id(raw):
    try:
        return ObjectId(raw)
    except (InvalidId, TypeError):
        return None


def _team_to_dict(t):
    return {"id": str(t["_id"]), "name": t["name"], "group": t["group"]}


def _fixture_to_dict(f, teams_by_id):
    team1 = teams_by_id.get(str(f["team1_id"]))
    team2 = teams_by_id.get(str(f["team2_id"]))
    return {
        "id": str(f["_id"]),
        "group": f["group"],
        "match_number": f["match_number"],
        "team1_id": str(f["team1_id"]),
        "team2_id": str(f["team2_id"]),
        "team1_name": team1["name"] if team1 else "Unknown",
        "team2_name": team2["name"] if team2 else "Unknown",
        "date": f.get("date"),
        "time": f.get("time"),
        "venue": f.get("venue"),
        "result": f.get("result"),
        "match_slot_id": f.get("match_slot_id"),
    }


@tournament_bp.route("/tournament/teams", methods=["GET"])
@jwt_required()
def list_teams():
    teams = list(mongo.db.tournament_teams.find().sort([("group", 1), ("name", 1)]))
    return jsonify({"teams": [_team_to_dict(t) for t in teams]})


@tournament_bp.route("/tournament/fixtures", methods=["GET"])
@jwt_required()
def list_fixtures():
    teams_by_id = {str(t["_id"]): t for t in mongo.db.tournament_teams.find()}
    fixtures = list(mongo.db.tournament_fixtures.find().sort([("group", 1), ("match_number", 1)]))
    return jsonify({"fixtures": [_fixture_to_dict(f, teams_by_id) for f in fixtures]})


@tournament_bp.route("/admin/tournament/teams", methods=["POST"])
@admin_required
def create_team():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    group = (data.get("group") or "").strip().upper()
    if not name or group not in GROUPS:
        return jsonify({"error": "name and a valid group (A/B/C) are required"}), 400
    if mongo.db.tournament_teams.find_one({"name": name, "group": group}):
        return jsonify({"error": "A team with this name already exists in this group"}), 400
    doc = {"name": name, "group": group, "created_at": datetime.utcnow()}
    doc["_id"] = mongo.db.tournament_teams.insert_one(doc).inserted_id
    return jsonify({"team": _team_to_dict(doc)}), 201


@tournament_bp.route("/admin/tournament/teams/<team_id>", methods=["PUT"])
@admin_required
def update_team(team_id):
    team_oid = _object_id(team_id)
    if not team_oid:
        return jsonify({"error": "Team not found"}), 404
    data = request.get_json() or {}
    updates = {}
    if "name" in data:
        name = (data["name"] or "").strip()
        if not name:
            return jsonify({"error": "name cannot be empty"}), 400
        updates["name"] = name
    if "group" in data:
        group = (data["group"] or "").strip().upper()
        if group not in GROUPS:
            return jsonify({"error": "group must be A, B, or C"}), 400
        updates["group"] = group
    if not updates:
        return jsonify({"error": "No fields to update"}), 400
    result = mongo.db.tournament_teams.update_one({"_id": team_oid}, {"$set": updates})
    if result.matched_count == 0:
        return jsonify({"error": "Team not found"}), 404
    return jsonify({"success": True})


@tournament_bp.route("/admin/tournament/teams/<team_id>", methods=["DELETE"])
@admin_required
def delete_team(team_id):
    team_oid = _object_id(team_id)
    if not team_oid:
        return jsonify({"error": "Team not found"}), 404
    if mongo.db.tournament_fixtures.find_one({"$or": [{"team1_id": team_oid}, {"team2_id": team_oid}]}):
        return jsonify({"error": "Cannot remove a team that has fixtures — remove its fixtures first"}), 400
    result = mongo.db.tournament_teams.delete_one({"_id": team_oid})
    if result.deleted_count == 0:
        return jsonify({"error": "Team not found"}), 404
    return jsonify({"success": True})


@tournament_bp.route("/admin/tournament/fixtures", methods=["POST"])
@admin_required
def create_fixture():
    data = request.get_json() or {}
    group = (data.get("group") or "").strip().upper()
    team1_oid = _object_id(data.get("team1_id"))
    team2_oid = _object_id(data.get("team2_id"))
    if group not in GROUPS or not team1_oid or not team2_oid:
        return jsonify({"error": "group, team1_id, and team2_id are required"}), 400
    if team1_oid == team2_oid:
        return jsonify({"error": "A team cannot play itself"}), 400
    team1 = mongo.db.tournament_teams.find_one({"_id": team1_oid})
    team2 = mongo.db.tournament_teams.find_one({"_id": team2_oid})
    if not team1 or not team2:
        return jsonify({"error": "One or both teams not found"}), 404
    last = mongo.db.tournament_fixtures.find_one({"group": group}, sort=[("match_number", -1)])
    match_number = (last["match_number"] + 1) if last else 1
    doc = {
        "group": group,
        "match_number": match_number,
        "team1_id": team1_oid,
        "team2_id": team2_oid,
        "date": (data.get("date") or "").strip() or None,
        "time": (data.get("time") or "").strip() or None,
        "venue": (data.get("venue") or "").strip() or None,
        "result": None,
        "created_at": datetime.utcnow(),
    }
    doc["_id"] = mongo.db.tournament_fixtures.insert_one(doc).inserted_id
    doc["match_slot_id"] = _ensure_match_slot_and_window(doc, team1, team2)
    teams_by_id = {str(team1["_id"]): team1, str(team2["_id"]): team2}
    return jsonify({"fixture": _fixture_to_dict(doc, teams_by_id)}), 201


@tournament_bp.route("/admin/tournament/fixtures/<fixture_id>", methods=["PUT"])
@admin_required
def update_fixture(fixture_id):
    fixture_oid = _object_id(fixture_id)
    if not fixture_oid:
        return jsonify({"error": "Fixture not found"}), 404
    data = request.get_json() or {}
    updates = {}
    for field in ("date", "time", "venue", "result"):
        if field in data:
            value = data[field]
            updates[field] = (value.strip() or None) if isinstance(value, str) else value
    for field in ("team1_id", "team2_id"):
        if field in data:
            oid = _object_id(data[field])
            if not oid:
                return jsonify({"error": f"Invalid {field}"}), 400
            updates[field] = oid
    if not updates:
        return jsonify({"error": "No fields to update"}), 400
    result = mongo.db.tournament_fixtures.update_one({"_id": fixture_oid}, {"$set": updates})
    if result.matched_count == 0:
        return jsonify({"error": "Fixture not found"}), 404

    # A fixture created without a date yet (or one whose teams/date just
    # changed) may only become schedulable right now — same auto-open as
    # create_fixture, guarded the same way so an already-scheduled fixture
    # never gets a second slot/window from a later, unrelated edit (e.g. just
    # updating the venue or a result).
    match_slot_id = None
    if "date" in updates:
        fixture = mongo.db.tournament_fixtures.find_one({"_id": fixture_oid})
        team1 = mongo.db.tournament_teams.find_one({"_id": fixture["team1_id"]})
        team2 = mongo.db.tournament_teams.find_one({"_id": fixture["team2_id"]})
        if team1 and team2:
            match_slot_id = _ensure_match_slot_and_window(fixture, team1, team2) or fixture.get("match_slot_id")

    return jsonify({"success": True, "match_slot_id": match_slot_id})


@tournament_bp.route("/admin/tournament/fixtures/<fixture_id>", methods=["DELETE"])
@admin_required
def delete_fixture(fixture_id):
    fixture_oid = _object_id(fixture_id)
    if not fixture_oid:
        return jsonify({"error": "Fixture not found"}), 404
    result = mongo.db.tournament_fixtures.delete_one({"_id": fixture_oid})
    if result.deleted_count == 0:
        return jsonify({"error": "Fixture not found"}), 404
    return jsonify({"success": True})
