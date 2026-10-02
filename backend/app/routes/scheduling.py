"""
Captain-confirmed match dates.

Instead of agreeing a date on WhatsApp and asking an admin to set it, anyone
involved suggests up to three date/time options for a fixture — an admin, or
the captain of either team (as picked on the Tournament page). Both captains
tick the options they can make; the moment both have ticked the same one,
the match is scheduled automatically (same path as an admin saving a date on
the fixture: the match appears and voting opens). Admins can always step in:
pick an option themselves, or cancel the request.

One open request per fixture — a new suggestion replaces the old one.
"""
import re
from datetime import datetime

from bson import ObjectId
from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required

from .. import mongo
from ..services.notifications import notify_event
from ..utils.audit import log_action
from ..utils.auth import get_current_user, is_staff
from ..utils.time_utils import now_ist, utcnow
from .tournament import ScheduleError, _sync_match_slot_and_window, _12h_display, current_tournament

scheduling_bp = Blueprint("scheduling", __name__)

MAX_OPTIONS = 3
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _oid(raw):
    return ObjectId(raw) if raw and ObjectId.is_valid(str(raw)) else None


def _teams(fixture):
    return (mongo.db.tournament_teams.find_one({"_id": fixture["team1_id"]}),
            mongo.db.tournament_teams.find_one({"_id": fixture["team2_id"]}))


def _fixture_captain_ids(fixture):
    t1, t2 = _teams(fixture)
    return [t.get("captain_id") for t in (t1, t2) if t and t.get("captain_id")]


def _auction_exists(fixture):
    slot_id = fixture.get("match_slot_id")
    if not slot_id:
        return False
    window = mongo.db.voting_windows.find_one({"slot_id": slot_id, "is_active": True})
    return bool(window and mongo.db.auctions.find_one({"window_id": str(window["_id"])}))


def _label(fixture):
    t1, t2 = _teams(fixture)
    return f"{t1['name'] if t1 else '?'} vs {t2['name'] if t2 else '?'}"


def _option_text(o):
    day = datetime.strptime(o["date"], "%Y-%m-%d").strftime("%a %d %b")
    end = f" – {_12h_display(o['end_time'])}" if o.get("end_time") else ""
    return f"{day}, {_12h_display(o['time'])}{end}"


def _clean_options(raw):
    if not isinstance(raw, list) or not 1 <= len(raw) <= MAX_OPTIONS:
        raise ValueError(f"Suggest between 1 and {MAX_OPTIONS} dates")
    today = now_ist().date()
    out, seen = [], set()
    for o in raw:
        o = o or {}
        date, time, end = (o.get("date") or "").strip(), (o.get("time") or "").strip(), (o.get("end_time") or "").strip()
        try:
            d = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            raise ValueError("Each option needs a date like 2026-10-10")
        if d < today:
            raise ValueError("Dates can't be in the past")
        if not TIME_RE.match(time):
            raise ValueError("Each option needs a start time like 06:15")
        if end and (not TIME_RE.match(end) or end <= time):
            raise ValueError("End time must be after the start time")
        if (date, time) in seen:
            continue
        seen.add((date, time))
        out.append({"date": date, "time": time, "end_time": end or None})
    return out


def _to_dict(p, me_id, names):
    fixture = mongo.db.tournament_fixtures.find_one({"_id": p["fixture_id"]}) or {}
    responses = p.get("responses") or {}
    return {
        "id": str(p["_id"]),
        "fixture_id": str(p["fixture_id"]),
        "label": _label(fixture) if fixture else "Match",
        "group": fixture.get("group"),
        "match_number": fixture.get("match_number"),
        "status": p["status"],
        "options": [{**o, "text": _option_text(o)} for o in p["options"]],
        "captains": [{"id": cid, "name": names.get(cid, "Captain"), "ticked": responses.get(cid),
                      "answered": cid in responses} for cid in p["captain_ids"]],
        "proposed_by": names.get(p.get("proposed_by"), "Admin"),
        "proposed_by_me": p.get("proposed_by") == me_id,
        "my_turn": me_id in p["captain_ids"],
        "my_ticks": responses.get(me_id),
        "scheduled_option": p.get("scheduled_option"),
    }


def _names(proposals):
    ids = {cid for p in proposals for cid in p["captain_ids"]} | {p.get("proposed_by") for p in proposals}
    oids = [ObjectId(i) for i in ids if i and ObjectId.is_valid(i)]
    return {str(u["_id"]): u["name"] for u in mongo.db.users.find({"_id": {"$in": oids}}, {"name": 1})}


def _schedule(proposal, idx, by_user_id):
    """Set the fixture's date from option idx and create/move its match +
    voting window. Raises ScheduleError if it can't (e.g. auction exists)."""
    fixture = mongo.db.tournament_fixtures.find_one({"_id": proposal["fixture_id"]})
    t1, t2 = _teams(fixture)
    opt = proposal["options"][idx]
    merged = {**fixture, "date": opt["date"], "time": opt["time"], "end_time": opt.get("end_time")}
    slot_id = _sync_match_slot_and_window(merged, t1, t2, None)
    mongo.db.tournament_fixtures.update_one({"_id": fixture["_id"]}, {"$set": {
        "date": opt["date"], "time": opt["time"], "end_time": opt.get("end_time")}})
    mongo.db.schedule_proposals.update_one({"_id": proposal["_id"]}, {"$set": {
        "status": "scheduled", "scheduled_option": idx, "scheduled_at": utcnow(), "scheduled_by": by_user_id}})
    log_action(by_user_id, "schedule_from_proposal", "fixture", str(fixture["_id"]),
               new_value={"date": opt["date"], "time": opt["time"], "proposal": str(proposal["_id"])})
    admins = [u["_id"] for u in mongo.db.users.find(
        {"is_active": {"$ne": False}, "$or": [{"role": "admin"}, {"is_admin": True}]}, {"_id": 1})]
    recipients = list({*admins, *[ObjectId(c) for c in proposal["captain_ids"]]})
    notify_event("match_date_fixed", recipients, {"label": _label(fixture), "when": _option_text(opt)}, url="/home")
    return slot_id


def _common_option(proposal):
    ticks = [set((proposal.get("responses") or {}).get(cid) or []) for cid in proposal["captain_ids"]]
    if len(ticks) < 2 or not all(ticks):
        return None
    common = set.intersection(*ticks)
    if not common:
        return None
    return min(common, key=lambda i: (proposal["options"][i]["date"], proposal["options"][i]["time"]))


# ── Routes ──────────────────────────────────────────────────────────────────────

@scheduling_bp.route("/schedule/fixtures", methods=["GET"])
@jwt_required()
def fixtures_i_can_schedule():
    """Fixtures this user may suggest dates for: admins — every fixture of
    the current tournament without a result or auction; captains — those of
    the team they captain."""
    me = get_current_user()
    me_id = str(me["_id"])
    tour = current_tournament()
    out = []
    for f in mongo.db.tournament_fixtures.find({"tournament_id": tour["_id"], "result": {"$in": [None, ""]}}).sort(
            [("group", 1), ("match_number", 1)]):
        caps = _fixture_captain_ids(f)
        if not (is_staff(me) or me_id in caps) or _auction_exists(f):
            continue
        open_p = mongo.db.schedule_proposals.find_one({"fixture_id": f["_id"], "status": "open"})
        out.append({"id": str(f["_id"]), "label": _label(f), "group": f["group"], "match_number": f["match_number"],
                    "date": f.get("date"), "time": f.get("time"), "captains_ready": len(caps) == 2,
                    "open_proposal_id": str(open_p["_id"]) if open_p else None})
    return jsonify({"fixtures": out})


@scheduling_bp.route("/schedule/proposals", methods=["GET"])
@jwt_required()
def list_proposals():
    me = get_current_user()
    me_id = str(me["_id"])
    query = {"status": "open"}
    if not is_staff(me):
        query["captain_ids"] = me_id
    proposals = list(mongo.db.schedule_proposals.find(query).sort("created_at", -1))
    names = _names(proposals)
    return jsonify({"proposals": [_to_dict(p, me_id, names) for p in proposals]})


@scheduling_bp.route("/schedule/proposals", methods=["POST"])
@jwt_required()
def create_proposal():
    me = get_current_user()
    me_id = str(me["_id"])
    data = request.get_json(silent=True) or {}
    fixture = mongo.db.tournament_fixtures.find_one({"_id": _oid(data.get("fixture_id"))}) if _oid(data.get("fixture_id")) else None
    if not fixture:
        return jsonify({"error": "Fixture not found"}), 404
    caps = _fixture_captain_ids(fixture)
    if not (is_staff(me) or me_id in caps):
        return jsonify({"error": "Only an admin or one of the two captains can suggest dates"}), 403
    if len(caps) != 2:
        return jsonify({"error": "Both teams need a captain first — an admin picks them on the Tournament page"}), 400
    if fixture.get("result"):
        return jsonify({"error": "This match has already been played"}), 400
    if _auction_exists(fixture):
        return jsonify({"error": "An auction already exists for this match — its date can't change"}), 409
    try:
        options = _clean_options(data.get("options"))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    mongo.db.schedule_proposals.update_many({"fixture_id": fixture["_id"], "status": "open"},
                                            {"$set": {"status": "replaced", "closed_at": utcnow()}})
    # A captain suggesting dates can obviously make all of them.
    responses = {me_id: list(range(len(options)))} if me_id in caps else {}
    doc = {"fixture_id": fixture["_id"], "options": options, "captain_ids": caps, "responses": responses,
           "proposed_by": me_id, "status": "open", "created_at": utcnow()}
    doc["_id"] = mongo.db.schedule_proposals.insert_one(doc).inserted_id
    log_action(me_id, "propose_dates", "fixture", str(fixture["_id"]), new_value={"options": options})
    others = [ObjectId(c) for c in caps if c != me_id]
    if others:
        notify_event("match_dates_proposed", others, {"label": _label(fixture)}, url="/schedule")
    return jsonify({"proposal": _to_dict(doc, me_id, _names([doc]))}), 201


@scheduling_bp.route("/schedule/proposals/<proposal_id>/response", methods=["PUT"])
@jwt_required()
def respond(proposal_id):
    """Body: {"options": [0, 2]} — the option indexes this captain can make
    (empty list = none of them)."""
    me = get_current_user()
    me_id = str(me["_id"])
    p = mongo.db.schedule_proposals.find_one({"_id": _oid(proposal_id)}) if _oid(proposal_id) else None
    if not p or p["status"] != "open":
        return jsonify({"error": "This date request is no longer open"}), 404
    if me_id not in p["captain_ids"]:
        return jsonify({"error": "Only the two captains answer this"}), 403
    ticks = (request.get_json(silent=True) or {}).get("options")
    if not isinstance(ticks, list) or any(not isinstance(i, int) or not 0 <= i < len(p["options"]) for i in ticks):
        return jsonify({"error": "options must be a list of option numbers"}), 400
    mongo.db.schedule_proposals.update_one({"_id": p["_id"]}, {"$set": {f"responses.{me_id}": sorted(set(ticks))}})
    p = mongo.db.schedule_proposals.find_one({"_id": p["_id"]})

    idx = _common_option(p)
    if idx is not None:
        try:
            _schedule(p, idx, me_id)
        except ScheduleError as e:
            return jsonify({"error": str(e)}), e.status
        return jsonify({"message": f"Both captains agreed — match fixed for {_option_text(p['options'][idx])}. Voting is open.",
                        "scheduled": True})
    if not ticks:
        others = [ObjectId(c) for c in p["captain_ids"] if c != me_id]
        notify_event("match_dates_rejected", others, {"label": _label(mongo.db.tournament_fixtures.find_one({"_id": p["fixture_id"]}))},
                     url="/schedule")
    return jsonify({"message": "Answer saved — waiting for the other captain", "scheduled": False})


@scheduling_bp.route("/schedule/proposals/<proposal_id>/pick", methods=["POST"])
@jwt_required()
def admin_pick(proposal_id):
    """Admin fixes one of the suggested options directly. Body: {"option": 1}"""
    me = get_current_user()
    if not is_staff(me):
        return jsonify({"error": "Admins only"}), 403
    p = mongo.db.schedule_proposals.find_one({"_id": _oid(proposal_id)}) if _oid(proposal_id) else None
    if not p or p["status"] != "open":
        return jsonify({"error": "This date request is no longer open"}), 404
    idx = (request.get_json(silent=True) or {}).get("option")
    if not isinstance(idx, int) or not 0 <= idx < len(p["options"]):
        return jsonify({"error": "Pick one of the options"}), 400
    try:
        _schedule(p, idx, str(me["_id"]))
    except ScheduleError as e:
        return jsonify({"error": str(e)}), e.status
    return jsonify({"message": f"Match fixed for {_option_text(p['options'][idx])}. Voting is open.", "scheduled": True})


@scheduling_bp.route("/schedule/proposals/<proposal_id>", methods=["DELETE"])
@jwt_required()
def cancel(proposal_id):
    me = get_current_user()
    me_id = str(me["_id"])
    p = mongo.db.schedule_proposals.find_one({"_id": _oid(proposal_id)}) if _oid(proposal_id) else None
    if not p or p["status"] != "open":
        return jsonify({"error": "This date request is no longer open"}), 404
    if not (is_staff(me) or p.get("proposed_by") == me_id):
        return jsonify({"error": "Only an admin or whoever suggested the dates can cancel"}), 403
    mongo.db.schedule_proposals.update_one({"_id": p["_id"]}, {"$set": {"status": "cancelled", "closed_at": utcnow()}})
    log_action(me_id, "cancel_date_request", "fixture", str(p["fixture_id"]))
    return jsonify({"message": "Date request cancelled"})
