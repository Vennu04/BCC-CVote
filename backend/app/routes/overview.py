"""
Control Centre overview — one call that tells an admin where every upcoming
match is on its way to an auction, and what still needs doing.

Each match walks the same four steps the Admin Guide teaches, in order:
voting → attendance → categories → auction. The to-do list is derived from
those same facts, so the Control Centre never has to be told what's pending —
it's recomputed from the live collections on every request. Read-only: no
writes happen here.
"""
from datetime import datetime, timedelta

from flask import Blueprint, jsonify

from .. import mongo
from ..utils.auth import admin_required, get_current_user
from ..utils.time_utils import (
    IST, effective_match_date_str, format_ist, is_voting_window_open, now_ist, utc_to_ist,
)
from .admin import VOTER_FILTER
from .auction import AUCTION_GROUPS, MIN_AUCTION_POOL_SIZE
from .duty import DUTY_SLOT_LABELS, WEEKEND_WEEKDAYS, _match_label

overview_bp = Blueprint("overview", __name__)

HORIZON_DAYS = 21
GROUP_LABELS = {
    "extra_power_allrounder": "EP All-rounders",
    "extra_power_batsman": "EP Batsmen",
    "power": "Power",
    "classic": "Classic",
}
AUCTION_EVENING_START = (19, 30)  # the duty roster's first slot


def _window_state(window):
    if not window:
        return "none"
    if window.get("is_cancelled"):
        return "cancelled"
    if now_ist() < utc_to_ist(window["opens_at"]):
        return "scheduled"
    if is_voting_window_open(window["opens_at"], window["closes_at"]):
        return "open"
    return "closed"


def _steps(state, available, credited, odd, auction_status):
    voting_done = state == "closed" or auction_status is not None
    auction_done = auction_status == "completed"
    attendance_done = auction_done or (available > 0 and credited >= available)
    categories_done = auction_status is not None or (voting_done and not odd)
    steps = []
    for key, done in (("voting", voting_done), ("attendance", attendance_done),
                      ("categories", categories_done), ("auction", auction_done)):
        steps.append({"key": key, "state": "done" if done else "todo"})
    # the first unfinished step is the one to work on now
    for s in steps:
        if s["state"] == "todo":
            s["state"] = "current"
            break
    return steps


@overview_bp.route("/admin/overview", methods=["GET"])
@admin_required
def admin_overview():
    user = get_current_user()
    full_admin = user.get("role") == "admin" or user.get("is_admin") is True
    now = now_ist()
    today = now.date()

    voters = list(mongo.db.users.find({"is_active": True, **VOTER_FILTER}, {"auction_category": 1}))
    voter_ids = {str(v["_id"]) for v in voters}
    category_of = {str(v["_id"]): v.get("auction_category") for v in voters}

    matches, todos = [], []
    for slot in mongo.db.match_slots.find({"is_active": {"$ne": False}, "is_test": {"$ne": True}}):
        date_str = effective_match_date_str(slot)
        try:
            match_date = datetime.strptime(date_str, "%Y-%m-%d").date() if date_str else None
        except ValueError:
            match_date = None
        if not match_date or match_date < today or match_date > today + timedelta(days=HORIZON_DAYS):
            continue

        sid = str(slot["_id"])
        window = mongo.db.voting_windows.find_one({"slot_id": sid, "is_active": True})
        state = _window_state(window)
        if state == "cancelled":
            continue
        wid = str(window["_id"]) if window else None

        available_ids, voted_ids = [], set()
        if window:
            for v in mongo.db.votes.find({"slot_id": sid, "window_id": wid}):
                if v["captain_id"] not in voter_ids:
                    continue
                voted_ids.add(v["captain_id"])
                if v["availability"] == "available":
                    available_ids.append(v["captain_id"])
        by_group = {g: 0 for g in AUCTION_GROUPS}
        uncategorised = 0
        for uid in available_ids:
            cat = category_of.get(uid)
            if cat in by_group:
                by_group[cat] += 1
            else:
                uncategorised += 1
        odd = [g for g in AUCTION_GROUPS if by_group[g] % 2]
        credited = mongo.db.attendance_credits.count_documents({"slot_id": sid, "window_id": wid}) if wid else 0
        auction = mongo.db.auctions.find_one({"window_id": wid}, sort=[("created_at", -1)]) if wid else None
        auction_status = auction.get("status") if auction else None

        auction_date = match_date - timedelta(days=1)
        is_weekend = match_date.weekday() in WEEKEND_WEEKDAYS
        duty = mongo.db.auction_duty.find_one({"slot_id": sid, "auction_date": auction_date.isoformat()}) or {}
        label = _match_label(slot)
        kickoff = slot.get("match_time") or slot.get("start_time") or ""

        matches.append({
            "slot_id": sid,
            "label": label,
            "group": slot.get("group"),
            "match_date": match_date.isoformat(),
            "kickoff": kickoff,
            "auction_date": auction_date.isoformat(),
            "is_weekend": is_weekend,
            "voting": {"state": state, "closes_at": format_ist(window["closes_at"]) if window else None},
            "counts": {
                "available": len(available_ids),
                "not_available": len(voted_ids) - len(available_ids),
                "yet_to_vote": len(voter_ids - voted_ids) if window else None,
                "by_group": by_group,
                "uncategorised": uncategorised,
            },
            "odd_groups": odd,
            "attendance_credited": credited,
            "auction": {"id": str(auction["_id"]), "status": auction_status} if auction else None,
            "duty": {"lead_id": duty.get("lead_id"), "backup_id": duty.get("backup_id"),
                     "start_slot": DUTY_SLOT_LABELS.get(duty.get("start_slot"))} if is_weekend else None,
            "steps": _steps(state, len(available_ids), credited, odd, auction_status),
        })

        if auction_status == "completed":
            continue
        where = f"{label} · {match_date.strftime('%a %d %b')}"
        h, m = AUCTION_EVENING_START
        evening_start = IST.localize(datetime.combine(auction_date, datetime.min.time()).replace(hour=h, minute=m))
        if state == "open" and now >= evening_start - timedelta(hours=1):
            todos.append({"level": "red", "title": "Close voting before the auction", "detail": where,
                          "link": "/manage/matches/windows"})
        if odd and not auction:
            names = ", ".join(f"{GROUP_LABELS[g]} ({by_group[g]})" for g in odd)
            todos.append({"level": "red", "title": f"Odd numbers: {names}", "detail": where,
                          "link": "/manage/auction/run"})
        if state == "closed" and not auction and len(available_ids) < MIN_AUCTION_POOL_SIZE:
            todos.append({"level": "red", "title": f"Only {len(available_ids)} available — an auction needs {MIN_AUCTION_POOL_SIZE}",
                          "detail": where, "link": "/manage/matches/windows"})
        if uncategorised > 2 and not auction:
            todos.append({"level": "gold", "title": f"{uncategorised} available players have no category",
                          "detail": f"{where} · captains don't need one", "link": "/manage/players/people"})
        if state == "closed" and available_ids and credited < len(available_ids):
            todos.append({"level": "blue", "title": "Credit attendance", "detail": f"{where} · {len(available_ids) - credited} to credit",
                          "link": "/manage/players/attendance"})
        if is_weekend and full_admin and auction_date <= today + timedelta(days=7):
            if not duty.get("lead_id"):
                todos.append({"level": "gold", "title": f"No Lead for the {auction_date.strftime('%a')} auction",
                              "detail": where, "link": "/manage/auction/duty"})
            elif not duty.get("backup_id"):
                todos.append({"level": "gold", "title": f"{auction_date.strftime('%a')} auction needs a Backup",
                              "detail": where, "link": "/manage/auction/duty"})
        if state == "open" and window and len(voter_ids - voted_ids) > 0:
            todos.append({"level": "info", "title": f"{len(voter_ids - voted_ids)} yet to vote", "detail": where,
                          "link": "/manage"})

    matches.sort(key=lambda m: (m["match_date"], m["kickoff"]))
    order = {"red": 0, "gold": 1, "blue": 2, "info": 3}
    todos.sort(key=lambda t: order[t["level"]])
    return jsonify({"matches": matches, "todos": todos})
