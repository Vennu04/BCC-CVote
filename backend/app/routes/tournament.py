from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from bson import ObjectId
from bson.errors import InvalidId
from datetime import datetime, timedelta
import pytz

from .. import mongo
from ..utils.auth import admin_required
from ..utils.time_utils import IST, utcnow, utc_to_ist, format_ist
from .admin import _window_info, _window_status

tournament_bp = Blueprint("tournament", __name__)

GROUPS = ("A", "B", "C")


def _12h_display(value):
    try:
        return datetime.strptime(value, "%H:%M").strftime("%I:%M %p")
    except (TypeError, ValueError):
        return None


class ScheduleError(Exception):
    """A fixture's date/time/voting-open combination can't be scheduled —
    the message is safe to show admin verbatim."""

    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


def _object_id(raw):
    try:
        return ObjectId(raw)
    except (InvalidId, TypeError):
        return None


def _parse_voting_opens(raw):
    """Admin-picked "voting opens" moment ("YYYY-MM-DDTHH:MM", IST, straight
    from an <input type="datetime-local">) as a naive UTC datetime, or None
    when blank — blank means "open right away", the pre-scheduling default."""
    if not raw:
        return None
    try:
        return IST.localize(datetime.fromisoformat(raw)).astimezone(pytz.utc).replace(tzinfo=None)
    except (TypeError, ValueError):
        raise ScheduleError("voting_opens_at must look like 2026-08-15T09:00")


# A fixture only becomes a real votable/auctionable match once it has a date —
# this creates the same match_slots + voting_windows documents the manual
# admin.py add_slot()/set_window() flow would (so it shows up on the Window
# Dashboard and the Auction page's "Compare Available Slots" exactly like any
# other match), but triggered automatically from saving the fixture instead
# of two separate manual admin actions. Voting opens at voting_opens_at when
# admin picked one (a scheduled open), otherwise immediately, and always
# closes at the fixture's own kickoff time, so no separate close-time picker
# is needed in the Tournament admin UI.
#
# Also handles rescheduling: once a fixture already has a slot, changing its
# date/time/voting-open moves that same slot and its active window instead of
# leaving them stuck on the original date. Refused once an auction exists for
# the window, since that auction's voter pool was derived from the window.
# Every validation happens before the first write, so a refusal leaves
# everything untouched.
def _sync_match_slot_and_window(fixture, team1, team2, voting_opens_at=None):
    if not fixture.get("date"):
        return None

    try:
        match_dt = datetime.fromisoformat(fixture["date"])
    except ValueError:
        raise ScheduleError("date must look like 2026-08-15")
    time_str = fixture.get("time")
    if time_str:
        try:
            hh, mm = time_str.split(":")
            match_dt = match_dt.replace(hour=int(hh), minute=int(mm))
        except ValueError:
            time_str = None
    if not time_str:
        match_dt = match_dt.replace(hour=23, minute=59)  # end of match day, no kickoff time given

    now = utcnow()
    closes_at = IST.localize(match_dt).astimezone(pytz.utc).replace(tzinfo=None)

    slot = None
    window = None
    slot_oid = _object_id(fixture.get("match_slot_id"))
    if slot_oid:
        slot = mongo.db.match_slots.find_one({"_id": slot_oid})
    if slot:
        window = mongo.db.voting_windows.find_one({"slot_id": str(slot["_id"]), "is_active": True})
        if window and mongo.db.auctions.find_one({"window_id": str(window["_id"])}):
            raise ScheduleError(
                "An auction already exists for this match — its date/time can no longer be changed", 409
            )
        if window and window.get("is_cancelled"):
            window = None  # a cancelled match is called off; scheduling it again starts a fresh window

    if voting_opens_at is not None:
        opens_at = voting_opens_at
        if opens_at >= closes_at:
            raise ScheduleError("Voting must open before the match starts")
    else:
        # Keep an already-scheduled open time when only the kickoff moved;
        # otherwise open right now.
        opens_at = window["opens_at"] if window and window["opens_at"] < closes_at else now
        if closes_at <= opens_at:
            # Fixture date/time is already in the past (or right now) — give it a
            # short real window rather than opening a voting window that's
            # instantly closed and unusable.
            closes_at = opens_at + timedelta(hours=6)

    slot_fields = {
        "day": datetime.fromisoformat(fixture["date"]).strftime("%A"),
        "time_of_day": "Evening" if (time_str and int(time_str.split(":")[0]) >= 16) else "Morning",
        "match_time": _12h_display(time_str) or "",
        "start_time": time_str,
        "description": fixture.get("venue") or "",
        "match_date": fixture["date"],
        "team_a_id": str(team1["_id"]), "team_a_name": team1["name"],
        "team_b_id": str(team2["_id"]), "team_b_name": team2["name"],
    }
    if slot:
        mongo.db.match_slots.update_one({"_id": slot["_id"]}, {"$set": slot_fields})
        slot_id = slot["_id"]
    else:
        last_slot = mongo.db.match_slots.find_one(sort=[("slot_number", -1)])
        slot_id = mongo.db.match_slots.insert_one({
            **slot_fields,
            "slot_number": (last_slot["slot_number"] + 1) if last_slot else 1,
            "end_time": None,
            "is_adhoc": True,
            "is_active": True,
            "created_at": now,
            "group": fixture["group"],
            "tournament_fixture_id": str(fixture["_id"]),
        }).inserted_id

    if window:
        mongo.db.voting_windows.update_one(
            {"_id": window["_id"]},
            {"$set": {"opens_at": opens_at, "closes_at": closes_at}, "$unset": {"closed_early": ""}},
        )
    else:
        mongo.db.voting_windows.update_many({"slot_id": str(slot_id)}, {"$set": {"is_active": False}})
        mongo.db.voting_windows.insert_one({
            "slot_id": str(slot_id),
            "opens_at": opens_at,
            "closes_at": closes_at,
            "is_active": True,
            "created_at": now,
        })
    mongo.db.tournament_fixtures.update_one(
        {"_id": fixture["_id"]}, {"$set": {"match_slot_id": str(slot_id)}}
    )
    return str(slot_id)


def _team_to_dict(t):
    return {"id": str(t["_id"]), "name": t["name"], "group": t["group"]}


# Where each fixture is on the way to an auction — voting window state plus
# the linked auction, resolved for all fixtures in two queries (windows, then
# auctions) rather than a lookup per fixture. Reuses the Window Dashboard's own
# status labels ("scheduled" / "open" / "closed" / "cancelled" /
# "auction_completed") so both pages always agree; None when the fixture has no
# schedule yet (or its slot was since removed).
def _schedule_info_by_fixture(fixtures):
    slot_ids = [f["match_slot_id"] for f in fixtures if f.get("match_slot_id")]
    if not slot_ids:
        return {}
    windows = {
        w["slot_id"]: w
        for w in mongo.db.voting_windows.find({"slot_id": {"$in": slot_ids}, "is_active": True})
    }
    auction_by_window = {}
    window_ids = [str(w["_id"]) for w in windows.values()]
    if window_ids:
        for a in mongo.db.auctions.find({"window_id": {"$in": window_ids}}).sort("created_at", -1):
            auction_by_window.setdefault(a["window_id"], a)

    info = {}
    for f in fixtures:
        window = windows.get(f.get("match_slot_id"))
        if not window:
            continue
        window_info = _window_info(window)
        auction = auction_by_window.get(str(window["_id"]))
        info[str(f["_id"])] = {
            "window_status": _window_status(window, window_info, auction),
            # datetime-local's own format, so the admin form can prefill it as-is
            "voting_opens_at": utc_to_ist(window["opens_at"]).strftime("%Y-%m-%dT%H:%M"),
            "voting_opens_display": format_ist(window["opens_at"]),
            "voting_closes_display": format_ist(window["closes_at"]),
            "auction_id": str(auction["_id"]) if auction else None,
            "auction_status": auction["status"] if auction else None,
        }
    return info


def _fixture_to_dict(f, teams_by_id, schedule=None):
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
        **(schedule or {}),
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
    schedules = _schedule_info_by_fixture(fixtures)
    return jsonify({
        "fixtures": [_fixture_to_dict(f, teams_by_id, schedules.get(str(f["_id"]))) for f in fixtures]
    })


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
    try:
        voting_opens_at = _parse_voting_opens((data.get("voting_opens_at") or "").strip())
    except ScheduleError as e:
        return jsonify({"error": str(e)}), e.status
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
    try:
        doc["match_slot_id"] = _sync_match_slot_and_window(doc, team1, team2, voting_opens_at)
    except ScheduleError as e:
        mongo.db.tournament_fixtures.delete_one({"_id": doc["_id"]})  # nothing half-created on a bad schedule
        return jsonify({"error": str(e)}), e.status
    teams_by_id = {str(team1["_id"]): team1, str(team2["_id"]): team2}
    schedules = _schedule_info_by_fixture([doc])
    return jsonify({"fixture": _fixture_to_dict(doc, teams_by_id, schedules.get(str(doc["_id"])))}), 201


@tournament_bp.route("/admin/tournament/fixtures/<fixture_id>", methods=["PUT"])
@admin_required
def update_fixture(fixture_id):
    fixture_oid = _object_id(fixture_id)
    if not fixture_oid:
        return jsonify({"error": "Fixture not found"}), 404
    fixture = mongo.db.tournament_fixtures.find_one({"_id": fixture_oid})
    if not fixture:
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
    voting_opens_raw = data.get("voting_opens_at")
    if not updates and "voting_opens_at" not in data:
        return jsonify({"error": "No fields to update"}), 400

    # A fixture created without a date yet may only become schedulable right
    # now, and one that already has a slot needs that slot/window moved along
    # with any change to its date, time, or voting-open time — so those
    # re-sync. The merged fixture is synced *before* the fixture's own update
    # is saved, so a refused schedule (e.g. an auction already exists) leaves
    # everything as it was. Venue/team/result-only edits never touch the
    # window (so they keep working after an auction exists); the slot's own
    # display fields just follow along.
    match_slot_id = fixture.get("match_slot_id")
    merged = {**fixture, **updates}
    team1 = mongo.db.tournament_teams.find_one({"_id": merged["team1_id"]})
    team2 = mongo.db.tournament_teams.find_one({"_id": merged["team2_id"]})
    if any(k in data for k in ("date", "time", "voting_opens_at")):
        if team1 and team2:
            try:
                voting_opens_at = _parse_voting_opens(
                    voting_opens_raw.strip() if isinstance(voting_opens_raw, str) else None
                )
                match_slot_id = _sync_match_slot_and_window(merged, team1, team2, voting_opens_at) or match_slot_id
            except ScheduleError as e:
                return jsonify({"error": str(e)}), e.status
    elif match_slot_id and team1 and team2 and any(k in data for k in ("venue", "team1_id", "team2_id")):
        slot_oid = _object_id(match_slot_id)
        if slot_oid:
            mongo.db.match_slots.update_one({"_id": slot_oid}, {"$set": {
                "description": merged.get("venue") or "",
                "team_a_id": str(team1["_id"]), "team_a_name": team1["name"],
                "team_b_id": str(team2["_id"]), "team_b_name": team2["name"],
            }})

    if updates:
        mongo.db.tournament_fixtures.update_one({"_id": fixture_oid}, {"$set": updates})
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
