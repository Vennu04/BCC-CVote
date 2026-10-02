from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
from bson.errors import InvalidId
from pymongo.errors import DuplicateKeyError
from datetime import datetime, timedelta
import pytz

from .. import mongo
from ..utils.auth import admin_required, admin_only_required
from ..utils.audit import log_action
from ..utils.time_utils import IST, utcnow, utc_to_ist, format_ist
from .admin import _window_info, _window_status

tournament_bp = Blueprint("tournament", __name__)

DEFAULT_GROUPS = ["A", "B", "C"]
DEFAULT_TOURNAMENT_NAME = "BCC Tournament 2026"


# ── Tournaments ────────────────────────────────────────────────────────────────
# Teams and fixtures belong to a tournament; exactly one is "active" (the
# current one) and every page works on it. When a tournament is over, an admin
# starts a new one with its own groups (A/B/C/D… whatever is needed) and the
# old one is kept, read-only, as history — no developer or build involved.
# The very first call adopts everything that existed before tournaments did
# into a default tournament, so nothing is lost.

def _clean_groups(raw):
    groups, seen = [], set()
    for g in raw or []:
        g = " ".join(str(g).split()).upper()
        if not g or len(g) > 12 or not all(ch.isalnum() or ch == " " for ch in g):
            raise ValueError("Group names must be 1–12 letters or numbers (e.g. A, B, C or D)")
        if g not in seen:
            seen.add(g)
            groups.append(g)
    if not groups:
        raise ValueError("A tournament needs at least one group")
    return groups


def current_tournament():
    t = mongo.db.tournaments.find_one({"status": "active"}, sort=[("created_at", -1)])
    if t:
        return t
    if mongo.db.tournaments.count_documents({}) == 0:
        groups = sorted(set(mongo.db.tournament_teams.distinct("group"))) or DEFAULT_GROUPS
        # Upsert on a fixed marker (unique index) so two first requests at once
        # can't create two default tournaments.
        try:
            mongo.db.tournaments.update_one({"seed": "initial"}, {"$setOnInsert": {
                "name": DEFAULT_TOURNAMENT_NAME, "groups": groups, "status": "active", "created_at": datetime.utcnow(),
            }}, upsert=True)
        except DuplicateKeyError:
            pass
        tid = mongo.db.tournaments.find_one({"seed": "initial"})["_id"]
        for coll in (mongo.db.tournament_teams, mongo.db.tournament_fixtures):
            coll.update_many({"tournament_id": {"$exists": False}}, {"$set": {"tournament_id": tid}})
        return mongo.db.tournaments.find_one({"_id": tid})
    return mongo.db.tournaments.find_one(sort=[("created_at", -1)])


def _tournament_for_request():
    """?tournament_id= picks an older tournament (read-only history); else the current one."""
    tid = _object_id(request.args.get("tournament_id")) if request.args.get("tournament_id") else None
    if tid:
        t = mongo.db.tournaments.find_one({"_id": tid})
        if t:
            return t
    return current_tournament()


def _tournament_to_dict(t):
    return {"id": str(t["_id"]), "name": t["name"], "groups": t.get("groups") or DEFAULT_GROUPS,
            "status": t.get("status", "finished"),
            "team_count": mongo.db.tournament_teams.count_documents({"tournament_id": t["_id"]})}


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

    end_str = fixture.get("end_time") if time_str else None
    start_display = _12h_display(time_str) or ""
    end_display = _12h_display(end_str) if end_str else None
    slot_fields = {
        "day": datetime.fromisoformat(fixture["date"]).strftime("%A"),
        "time_of_day": "Evening" if (time_str and int(time_str.split(":")[0]) >= 16) else "Morning",
        "match_time": f"{start_display} – {end_display}" if start_display and end_display else start_display,
        "start_time": time_str,
        "end_time": end_str if end_display else None,
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


def _captain_names(teams):
    ids = [ObjectId(t["captain_id"]) for t in teams if ObjectId.is_valid(t.get("captain_id") or "")]
    return {str(u["_id"]): u["name"] for u in mongo.db.users.find({"_id": {"$in": ids}}, {"name": 1})} if ids else {}


def _team_to_dict(t, captain_names=None):
    cid = t.get("captain_id")
    return {"id": str(t["_id"]), "name": t["name"], "group": t["group"],
            "captain_id": cid, "captain_name": (captain_names or {}).get(cid) if cid else None}


# Matches store a denormalised copy of each team's name (match_slots
# team_a_name/team_b_name) — keep every match of this team in step when it's
# renamed, and keep the captain's own team_name (shown on their profile, and
# the fallback for spotting captains) in step with the team.
def _sync_team_everywhere(team):
    tid = str(team["_id"])
    mongo.db.match_slots.update_many({"team_a_id": tid}, {"$set": {"team_a_name": team["name"]}})
    mongo.db.match_slots.update_many({"team_b_id": tid}, {"$set": {"team_b_name": team["name"]}})
    if ObjectId.is_valid(team.get("captain_id") or ""):
        mongo.db.users.update_one({"_id": ObjectId(team["captain_id"])}, {"$set": {"team_name": team["name"].upper()}})


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
        "end_time": f.get("end_time"),
        "venue": f.get("venue"),
        "result": f.get("result"),
        "match_slot_id": f.get("match_slot_id"),
        **(schedule or {}),
    }


@tournament_bp.route("/tournament/teams", methods=["GET"])
@jwt_required()
def list_teams():
    t = _tournament_for_request()
    teams = list(mongo.db.tournament_teams.find({"tournament_id": t["_id"]}).sort([("group", 1), ("name", 1)]))
    names = _captain_names(teams)
    return jsonify({"teams": [_team_to_dict(x, names) for x in teams], "tournament": _tournament_to_dict(t)})


@tournament_bp.route("/tournament/fixtures", methods=["GET"])
@jwt_required()
def list_fixtures():
    t = _tournament_for_request()
    teams_by_id = {str(x["_id"]): x for x in mongo.db.tournament_teams.find({"tournament_id": t["_id"]})}
    fixtures = list(mongo.db.tournament_fixtures.find({"tournament_id": t["_id"]}).sort([("group", 1), ("match_number", 1)]))
    schedules = _schedule_info_by_fixture(fixtures)
    return jsonify({
        "fixtures": [_fixture_to_dict(f, teams_by_id, schedules.get(str(f["_id"]))) for f in fixtures]
    })


@tournament_bp.route("/admin/tournament/teams", methods=["POST"])
@admin_required
def create_team():
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    group = " ".join((data.get("group") or "").split()).upper()
    t = current_tournament()
    if not name or group not in t["groups"]:
        return jsonify({"error": f"name and a group ({', '.join(t['groups'])}) are required"}), 400
    if mongo.db.tournament_teams.find_one({"name": name, "tournament_id": t["_id"]}):
        return jsonify({"error": "A team with this name already exists in this tournament"}), 400
    doc = {"name": name, "group": group, "tournament_id": t["_id"], "created_at": datetime.utcnow()}
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
    existing = mongo.db.tournament_teams.find_one({"_id": team_oid})
    if not existing:
        return jsonify({"error": "Team not found"}), 404
    tour = mongo.db.tournaments.find_one({"_id": existing.get("tournament_id")}) or current_tournament()
    if "group" in data:
        group = " ".join((data["group"] or "").split()).upper()
        if group not in tour["groups"]:
            return jsonify({"error": f"group must be one of {', '.join(tour['groups'])}"}), 400
        updates["group"] = group
    if "captain_id" in data:
        cid = data["captain_id"] or None
        if cid:
            captain = mongo.db.users.find_one({"_id": ObjectId(cid), "role": "captain", "is_active": True}) \
                if ObjectId.is_valid(cid) else None
            if not captain:
                return jsonify({"error": "Pick an active captain"}), 400
            other = mongo.db.tournament_teams.find_one({"captain_id": cid, "_id": {"$ne": team_oid},
                                                        "tournament_id": existing.get("tournament_id")})
            if other:
                return jsonify({"error": f"{captain['name']} is already captain of {other['name']}"}), 400
        updates["captain_id"] = cid
    if not updates:
        return jsonify({"error": "No fields to update"}), 400
    result = mongo.db.tournament_teams.update_one({"_id": team_oid}, {"$set": updates})
    if result.matched_count == 0:
        return jsonify({"error": "Team not found"}), 404
    team = mongo.db.tournament_teams.find_one({"_id": team_oid})
    _sync_team_everywhere(team)
    return jsonify({"success": True, "team": _team_to_dict(team, _captain_names([team]))})


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
    group = " ".join((data.get("group") or "").split()).upper()
    team1_oid = _object_id(data.get("team1_id"))
    team2_oid = _object_id(data.get("team2_id"))
    tour = current_tournament()
    if group not in tour["groups"] or not team1_oid or not team2_oid:
        return jsonify({"error": "group, team1_id, and team2_id are required"}), 400
    if team1_oid == team2_oid:
        return jsonify({"error": "A team cannot play itself"}), 400
    team1 = mongo.db.tournament_teams.find_one({"_id": team1_oid, "tournament_id": tour["_id"]})
    team2 = mongo.db.tournament_teams.find_one({"_id": team2_oid, "tournament_id": tour["_id"]})
    if not team1 or not team2:
        return jsonify({"error": "One or both teams not found in the current tournament"}), 404
    try:
        voting_opens_at = _parse_voting_opens((data.get("voting_opens_at") or "").strip())
    except ScheduleError as e:
        return jsonify({"error": str(e)}), e.status
    last = mongo.db.tournament_fixtures.find_one({"group": group, "tournament_id": tour["_id"]}, sort=[("match_number", -1)])
    match_number = (last["match_number"] + 1) if last else 1
    doc = {
        "tournament_id": tour["_id"],
        "group": group,
        "match_number": match_number,
        "team1_id": team1_oid,
        "team2_id": team2_oid,
        "date": (data.get("date") or "").strip() or None,
        "time": (data.get("time") or "").strip() or None,
        "end_time": (data.get("end_time") or "").strip() or None,
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
    for field in ("date", "time", "end_time", "venue", "result"):
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
    if any(k in data for k in ("date", "time", "end_time", "voting_opens_at")):
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


@tournament_bp.route("/tournaments", methods=["GET"])
@jwt_required()
def list_tournaments():
    current = current_tournament()
    all_t = list(mongo.db.tournaments.find().sort("created_at", -1))
    return jsonify({"current_id": str(current["_id"]), "tournaments": [_tournament_to_dict(t) for t in all_t]})


@tournament_bp.route("/admin/tournaments", methods=["POST"])
@admin_only_required
def start_tournament():
    """Finish the current tournament and start a new one.
    Body: {"name", "groups": ["A","B",...], "copy_teams": bool} — copy_teams
    brings over the current tournament's teams, groups and captains."""
    data = request.get_json(silent=True) or {}
    name = " ".join((data.get("name") or "").split())
    if not name:
        return jsonify({"error": "Give the tournament a name"}), 400
    try:
        groups = _clean_groups(data.get("groups"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    old = current_tournament()
    now = datetime.utcnow()
    new_id = mongo.db.tournaments.insert_one(
        {"name": name, "groups": groups, "status": "active", "created_at": now}).inserted_id
    mongo.db.tournaments.update_one({"_id": old["_id"]}, {"$set": {"status": "finished", "finished_at": now}})
    copied = 0
    if data.get("copy_teams"):
        for team in mongo.db.tournament_teams.find({"tournament_id": old["_id"]}):
            group = team["group"] if team["group"] in groups else groups[0]
            mongo.db.tournament_teams.insert_one({
                "name": team["name"], "group": group, "captain_id": team.get("captain_id"),
                "tournament_id": new_id, "created_at": now,
            })
            copied += 1
    log_action(get_jwt_identity(), "create", "tournament", str(new_id),
               old_value={"finished": str(old["_id"])}, new_value={"name": name, "groups": groups, "copied_teams": copied})
    return jsonify({"tournament": _tournament_to_dict(mongo.db.tournaments.find_one({"_id": new_id})),
                    "copied_teams": copied}), 201


@tournament_bp.route("/admin/tournaments/<tournament_id>", methods=["PUT"])
@admin_required
def update_tournament(tournament_id):
    """Rename a tournament or change its groups (add any; remove only an empty one)."""
    t = mongo.db.tournaments.find_one({"_id": _object_id(tournament_id)}) if _object_id(tournament_id) else None
    if not t:
        return jsonify({"error": "Tournament not found"}), 404
    data = request.get_json(silent=True) or {}
    updates = {}
    if "name" in data:
        name = " ".join((data.get("name") or "").split())
        if not name:
            return jsonify({"error": "Give the tournament a name"}), 400
        updates["name"] = name
    if "groups" in data:
        try:
            groups = _clean_groups(data.get("groups"))
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        for removed in set(t.get("groups") or []) - set(groups):
            if mongo.db.tournament_teams.find_one({"tournament_id": t["_id"], "group": removed}):
                return jsonify({"error": f"Group {removed} still has teams — move or remove them first"}), 400
        updates["groups"] = groups
    if not updates:
        return jsonify({"error": "Nothing to change"}), 400
    mongo.db.tournaments.update_one({"_id": t["_id"]}, {"$set": updates})
    return jsonify({"tournament": _tournament_to_dict(mongo.db.tournaments.find_one({"_id": t["_id"]}))})
