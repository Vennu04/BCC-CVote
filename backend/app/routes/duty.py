"""
Auction Duty roster — which admin runs each weekend match's live auction.

Every match's live auction happens the evening BEFORE the match (a Saturday
match is auctioned on Friday evening), inside a fixed 7:30–10:30 PM IST
window split into three 1-hour slots. For weekend matches (Saturday/Sunday)
each full admin ticks the slots they can cover — or flags that they're a
captain in that match, which rules them out (create_auction already refuses
to let an admin run an auction they're linked to as captain) — and an admin
confirms one Lead and one Backup. Weekday matches aren't rostered at all: the
Organiser runs those, so they're listed for information only.

Evenings are derived from the live match_slots on every request, never
stored as their own schedule — so creating, moving or cancelling a match in
Manage Tournament is reflected here with nothing to keep in sync. Only the
admins' answers and the confirmed Lead/Backup are stored, one auction_duty
document per (slot_id, auction_date): if a match is moved to another day, its
old answers stay behind on the old date instead of silently carrying over to
an evening nobody actually said yes to.

Full admins only (role=="admin" or is_admin), not organizers — the user's
explicit call: "only users who have admin rights".
"""
from datetime import datetime, timedelta

import pytz
from bson import ObjectId
from flask import Blueprint, jsonify, request

from .. import mongo
from ..services.notifications import notify_event
from ..utils.audit import log_action
from ..utils.auth import admin_only_required, get_current_user
from ..utils.time_utils import IST, effective_match_date_str, now_ist, to_iso_utc, utcnow

duty_bp = Blueprint("duty", __name__)

# (code, label) — code is the slot's IST start time, which is also what
# the reminder job parses back into a datetime.
DUTY_SLOTS = [
    ("19:30", "7:30 – 8:30 PM"),
    ("20:30", "8:30 – 9:30 PM"),
    ("21:30", "9:30 – 10:30 PM"),
]
DUTY_SLOT_CODES = [code for code, _ in DUTY_SLOTS]
DUTY_SLOT_LABELS = dict(DUTY_SLOTS)
DUTY_EVENING_END = (22, 30)  # an evening drops off the roster once this passes
HORIZON_DAYS = 21            # how far ahead matches are listed
RECENT_DUTY_DAYS = 60        # window for "who has done the most duties lately"
WEEKEND_WEEKDAYS = (5, 6)    # match on Saturday/Sunday -> rostered
REMINDER_LEAD_TIME = timedelta(hours=1)

FULL_ADMIN_FILTER = {"is_active": {"$ne": False}, "$or": [{"role": "admin"}, {"is_admin": True}]}


def _full_admins():
    return list(mongo.db.users.find(FULL_ADMIN_FILTER, {"name": 1, "team_code": 1}).sort("name", 1))


def _slot_start_utc(auction_date, code):
    """Naive UTC datetime of a duty slot's start (auction_date is a date)."""
    hour, minute = (int(part) for part in code.split(":"))
    naive_ist = datetime.combine(auction_date, datetime.min.time()).replace(hour=hour, minute=minute)
    return IST.localize(naive_ist).astimezone(pytz.utc).replace(tzinfo=None)


def _match_label(slot):
    if slot.get("team_a_name") and slot.get("team_b_name"):
        return f"{slot['team_a_name']} vs {slot['team_b_name']}"
    return slot.get("description") or f"{slot.get('day', '')} {slot.get('time_of_day', '')}".strip()


def _upcoming_evenings():
    """Every active, non-test match whose auction evening hasn't finished
    yet and whose match is within HORIZON_DAYS, soonest first. A cancelled
    match drops off; a match without a determinable date is skipped (it
    can't have an auction evening either)."""
    now = now_ist()
    today = now.date()
    evenings = []
    for slot in mongo.db.match_slots.find({"is_active": {"$ne": False}, "is_test": {"$ne": True}}):
        date_str = effective_match_date_str(slot)
        if not date_str:
            continue
        try:
            match_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except (TypeError, ValueError):
            continue
        auction_date = match_date - timedelta(days=1)
        end_h, end_m = DUTY_EVENING_END
        evening_end = IST.localize(datetime.combine(auction_date, datetime.min.time()).replace(hour=end_h, minute=end_m))
        if evening_end < now or match_date > today + timedelta(days=HORIZON_DAYS):
            continue

        window = mongo.db.voting_windows.find_one({"slot_id": str(slot["_id"]), "is_active": True})
        if window and window.get("is_cancelled"):
            continue
        auction = None
        if window:
            auction = mongo.db.auctions.find_one(
                {"window_id": str(window["_id"])}, sort=[("created_at", -1)]
            )
        evenings.append({
            "slot": slot,
            "match_date": match_date,
            "auction_date": auction_date,
            "is_weekend": match_date.weekday() in WEEKEND_WEEKDAYS,
            "auction_status": auction.get("status") if auction else None,
        })
    evenings.sort(key=lambda e: (e["auction_date"], e["slot"].get("start_time") or e["slot"].get("match_time") or ""))
    return evenings


def _duty_doc(slot_id, auction_date):
    return mongo.db.auction_duty.find_one({"slot_id": slot_id, "auction_date": auction_date.isoformat()}) or {}


def _recent_duty_counts():
    since = (now_ist().date() - timedelta(days=RECENT_DUTY_DAYS)).isoformat()
    counts = {}
    for doc in mongo.db.auction_duty.find({"auction_date": {"$gte": since}}, {"lead_id": 1, "backup_id": 1}):
        for uid in (doc.get("lead_id"), doc.get("backup_id")):
            if uid:
                counts[uid] = counts.get(uid, 0) + 1
    return counts


def _available_for(responses, code):
    return [uid for uid, r in responses.items() if code in (r.get("slots") or []) and not r.get("captain")]


def suggest_pair(responses, admin_ids, names, counts):
    """(start_slot, lead_id, backup_id) or None. Earliest slot that has two
    free, non-captain admins (so the Backup can actually step in at the same
    time); failing that, the earliest slot with one (Lead only). Within a
    slot, whoever has done the fewest duties lately goes first, so the work
    rotates instead of always landing on the same person."""
    def ranked(code):
        ids = [uid for uid in _available_for(responses, code) if uid in admin_ids]
        return sorted(ids, key=lambda uid: (counts.get(uid, 0), names.get(uid, "")))

    for need in (2, 1):
        for code in DUTY_SLOT_CODES:
            ids = ranked(code)
            if len(ids) >= need:
                return {"start_slot": code, "lead_id": ids[0], "backup_id": ids[1] if len(ids) > 1 else None}
    return None


def _coverage(is_weekend, doc, suggestion):
    if not is_weekend:
        return "organiser"
    if doc.get("lead_id") and doc.get("backup_id"):
        return "covered"
    if doc.get("lead_id"):
        return "needs_backup"
    if suggestion:
        return "to_confirm"
    return "nobody"


def _evening_to_dict(evening, admin_ids, names, counts):
    slot = evening["slot"]
    slot_id = str(slot["_id"])
    doc = _duty_doc(slot_id, evening["auction_date"]) if evening["is_weekend"] else {}
    responses = {uid: r for uid, r in (doc.get("responses") or {}).items() if uid in admin_ids}
    suggestion = suggest_pair(responses, admin_ids, names, counts) if evening["is_weekend"] else None
    return {
        "slot_id": slot_id,
        "match_label": _match_label(slot),
        "group": slot.get("group"),
        "match_date": evening["match_date"].isoformat(),
        "match_day": evening["match_date"].strftime("%A"),
        "kickoff": slot.get("match_time") or slot.get("start_time") or "",
        "auction_date": evening["auction_date"].isoformat(),
        "auction_day": evening["auction_date"].strftime("%A"),
        "is_weekend": evening["is_weekend"],
        "auction_status": evening["auction_status"],
        "responses": {
            uid: {"slots": r.get("slots") or [], "captain": bool(r.get("captain")),
                  "updated_at": to_iso_utc(r.get("updated_at"))}
            for uid, r in responses.items()
        },
        "lead_id": doc.get("lead_id"),
        "backup_id": doc.get("backup_id"),
        "start_slot": doc.get("start_slot"),
        "assigned_by": names.get(doc.get("assigned_by")) if doc.get("assigned_by") else None,
        "assigned_at": to_iso_utc(doc.get("assigned_at")),
        "suggestion": suggestion,
        "coverage": _coverage(evening["is_weekend"], doc, suggestion),
    }


def _find_evening(slot_id):
    for evening in _upcoming_evenings():
        if str(evening["slot"]["_id"]) == slot_id:
            return evening
    return None


@duty_bp.route("/admin/duty", methods=["GET"])
@admin_only_required
def list_duty():
    me = get_current_user()
    admins = _full_admins()
    admin_ids = {str(a["_id"]) for a in admins}
    names = {str(a["_id"]): a["name"] for a in admins}
    counts = _recent_duty_counts()
    return jsonify({
        "me": str(me["_id"]),
        "slots": [{"code": code, "label": label} for code, label in DUTY_SLOTS],
        "admins": [
            {"id": str(a["_id"]), "name": a["name"], "team_code": a["team_code"],
             "recent_duties": counts.get(str(a["_id"]), 0)}
            for a in admins
        ],
        "evenings": [_evening_to_dict(e, admin_ids, names, counts) for e in _upcoming_evenings()],
    })


@duty_bp.route("/admin/duty/<slot_id>/me", methods=["PUT"])
@admin_only_required
def set_my_availability(slot_id):
    """An admin's own answer for one evening. Saying "I'm a captain", or
    unticking the slot they were confirmed for, also takes them off that
    evening's Lead/Backup — the roster never shows someone on duty who has
    since said they can't be."""
    me = get_current_user()
    uid = str(me["_id"])
    evening = _find_evening(slot_id)
    if not evening:
        return jsonify({"error": "That match isn't on the upcoming auction roster"}), 404
    if not evening["is_weekend"]:
        return jsonify({"error": "Weekday matches aren't rostered — the Organiser runs those auctions"}), 400

    data = request.get_json(silent=True) or {}
    captain = bool(data.get("captain"))
    slots = data.get("slots") or []
    if not isinstance(slots, list) or any(s not in DUTY_SLOT_CODES for s in slots):
        return jsonify({"error": f"slots must be a list drawn from {DUTY_SLOT_CODES}"}), 400
    slots = [] if captain else [c for c in DUTY_SLOT_CODES if c in slots]

    auction_date = evening["auction_date"].isoformat()
    key = {"slot_id": slot_id, "auction_date": auction_date}
    doc = mongo.db.auction_duty.find_one(key) or {}
    old = (doc.get("responses") or {}).get(uid)

    update = {"$set": {f"responses.{uid}": {"slots": slots, "captain": captain, "updated_at": utcnow()}}}
    removed_from = None
    free_at_start = doc.get("start_slot") in slots
    if doc.get("lead_id") == uid and not free_at_start:
        # Lead can't make it any more: the Backup (if any) doesn't get silently
        # promoted — someone confirms a new pair on purpose.
        update["$set"].update({"lead_id": None})
        update.setdefault("$unset", {})["reminder_sent_at"] = ""
        removed_from = "Lead"
    elif doc.get("backup_id") == uid and not free_at_start:
        update["$set"].update({"backup_id": None})
        removed_from = "Backup"

    mongo.db.auction_duty.update_one(key, update, upsert=True)
    log_action(uid, "duty_availability", "auction_duty", f"{slot_id}:{auction_date}",
               old_value={"slots": old.get("slots"), "captain": old.get("captain")} if old else None,
               new_value={"slots": slots, "captain": captain, "removed_from": removed_from})
    return jsonify({"message": "Saved", "removed_from": removed_from})


@duty_bp.route("/admin/duty/<slot_id>/assignment", methods=["PUT"])
@admin_only_required
def set_assignment(slot_id):
    """Confirm (or clear, with lead_id null) one evening's Lead/Backup. Both
    must have ticked the chosen start slot and not flagged themselves as a
    captain in that match."""
    me = get_current_user()
    evening = _find_evening(slot_id)
    if not evening:
        return jsonify({"error": "That match isn't on the upcoming auction roster"}), 404
    if not evening["is_weekend"]:
        return jsonify({"error": "Weekday matches aren't rostered — the Organiser runs those auctions"}), 400

    data = request.get_json(silent=True) or {}
    lead_id = data.get("lead_id") or None
    backup_id = data.get("backup_id") or None
    start_slot = data.get("start_slot") or None

    auction_date = evening["auction_date"].isoformat()
    key = {"slot_id": slot_id, "auction_date": auction_date}
    doc = mongo.db.auction_duty.find_one(key) or {}
    old = {"lead_id": doc.get("lead_id"), "backup_id": doc.get("backup_id"), "start_slot": doc.get("start_slot")}

    if not lead_id:
        if backup_id:
            return jsonify({"error": "Pick a Lead before a Backup"}), 400
        new = {"lead_id": None, "backup_id": None, "start_slot": None}
    else:
        if start_slot not in DUTY_SLOT_CODES:
            return jsonify({"error": "Pick which slot the auction starts in"}), 400
        if backup_id == lead_id:
            return jsonify({"error": "Lead and Backup must be two different admins"}), 400
        admins = {str(a["_id"]): a["name"] for a in _full_admins()}
        responses = doc.get("responses") or {}
        for role, uid in (("Lead", lead_id), ("Backup", backup_id)):
            if uid is None:
                continue
            if uid not in admins:
                return jsonify({"error": f"The {role} must be an admin"}), 400
            answer = responses.get(uid) or {}
            if answer.get("captain"):
                return jsonify({"error": f"{admins[uid]} is a captain in this match and can't run its auction"}), 400
            if start_slot not in (answer.get("slots") or []):
                return jsonify({
                    "error": f"{admins[uid]} hasn't ticked {DUTY_SLOT_LABELS[start_slot]} — "
                             f"they need to mark themselves available first"
                }), 400
        new = {"lead_id": lead_id, "backup_id": backup_id, "start_slot": start_slot}

    slot = evening["slot"]
    fields = {**new, "assigned_by": str(me["_id"]), "assigned_at": utcnow(),
              "match_label": _match_label(slot)}
    update = {"$set": fields}
    if (new["lead_id"], new["backup_id"], new["start_slot"]) != (old["lead_id"], old["backup_id"], old["start_slot"]):
        update["$unset"] = {"reminder_sent_at": ""}
    mongo.db.auction_duty.update_one(key, update, upsert=True)
    log_action(str(me["_id"]), "duty_assignment", "auction_duty", f"{slot_id}:{auction_date}",
               old_value=old, new_value=new)

    # Tell whoever was just put on duty — not the admin who clicked, who
    # already knows, and not anyone whose role didn't change.
    newly = [uid for uid in (new["lead_id"], new["backup_id"])
             if uid and uid not in (old["lead_id"], old["backup_id"]) and uid != str(me["_id"])]
    if newly:
        notify_event("auction_duty_assigned", [ObjectId(uid) for uid in newly], {
            "label": _match_label(slot),
            "when": f"{evening['auction_date'].strftime('%a %d %b')}, {DUTY_SLOT_LABELS[new['start_slot']]}",
        }, url="/admin/duty")
    return jsonify({"message": "Roster updated"})


def send_due_duty_reminders():
    """Called from the notification scheduler every minute: one push to the
    Lead and Backup when their evening's start slot is under an hour away.
    Claimed atomically (reminder_sent_at) since both gunicorn workers run the
    same job; cleared again whenever the assignment changes."""
    now = utcnow()
    for doc in mongo.db.auction_duty.find({
        "lead_id": {"$ne": None}, "start_slot": {"$in": DUTY_SLOT_CODES},
        "reminder_sent_at": {"$exists": False},
    }):
        try:
            auction_date = datetime.strptime(doc["auction_date"], "%Y-%m-%d").date()
        except (KeyError, ValueError):
            continue
        start = _slot_start_utc(auction_date, doc["start_slot"])
        if not (start - REMINDER_LEAD_TIME <= now < start):
            continue
        claimed = mongo.db.auction_duty.find_one_and_update(
            {"_id": doc["_id"], "reminder_sent_at": {"$exists": False}},
            {"$set": {"reminder_sent_at": now}},
        )
        if not claimed:
            continue
        recipients = [ObjectId(uid) for uid in (doc.get("lead_id"), doc.get("backup_id")) if uid]
        notify_event("auction_duty_reminder", recipients, {
            "label": doc.get("match_label") or "tonight's match",
            "when": DUTY_SLOT_LABELS[doc["start_slot"]],
        }, url="/admin/auction")
