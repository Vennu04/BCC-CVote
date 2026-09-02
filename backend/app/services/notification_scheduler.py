import logging

from apscheduler.schedulers.background import BackgroundScheduler
from bson import ObjectId

from .. import mongo
from ..utils.time_utils import utcnow
from .push import send_push_to_user_ids

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS = 60

# Duplicated from votes.py's VOTER_FILTER rather than imported — same
# convention admin.py already follows for this exact filter (see its own
# "kept in sync with votes.py's VOTER_FILTER" comment); a handful of
# role=="admin" accounts are flagged is_player=True so they count too.
VOTER_FILTER = {"$or": [{"role": {"$in": ["captain", "player"]}}, {"is_player": True}]}


def _check_and_notify():
    now = utcnow()
    windows = mongo.db.voting_windows.find({
        "is_active": True,
        "is_cancelled": {"$ne": True},
        "opens_at": {"$lte": now},
        "notified_at": {"$exists": False},
    })

    for window in windows:
        # Atomic claim — both gunicorn workers run this same check on their
        # own 60s timer, so only one of them should actually win the
        # find_one_and_update below and send. The other sees no document
        # returned (someone else already set notified_at) and moves on.
        claimed = mongo.db.voting_windows.find_one_and_update(
            {"_id": window["_id"], "notified_at": {"$exists": False}},
            {"$set": {"notified_at": now}},
        )
        if not claimed:
            continue

        # slot_id is stored as a plain string on voting_windows (see
        # admin.py's set_window), not an ObjectId like match_slots._id.
        try:
            slot = mongo.db.match_slots.find_one({"_id": ObjectId(window["slot_id"])})
        except Exception:
            slot = None
        if not slot or slot.get("is_test"):
            continue  # don't notify everyone for practice/rehearsal windows

        user_ids = [
            u["_id"] for u in
            mongo.db.users.find({**VOTER_FILTER, "is_active": {"$ne": False}}, {"_id": 1})
        ]
        if not user_ids:
            continue

        label = f"{slot.get('day', '')} {slot.get('match_time') or slot.get('time_of_day', '')}".strip()
        result = send_push_to_user_ids(user_ids, {
            "title": "🏏 Voting is open!",
            "body": f"Cast your availability for {label} now.",
            "url": "/",
        })
        logger.info("notification_scheduler: notified window %s (%s) — %s", window["_id"], label, result)


def start_scheduler(app):
    scheduler = BackgroundScheduler(daemon=True)

    def job():
        with app.app_context():
            try:
                _check_and_notify()
            except Exception:
                logger.exception("notification_scheduler: check failed")

    scheduler.add_job(job, "interval", seconds=CHECK_INTERVAL_SECONDS, id="voting_window_notify")
    scheduler.start()
    return scheduler
