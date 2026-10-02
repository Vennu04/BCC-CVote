"""
Home lists only matches still to be played, plus the permanent test match —
played matches drop off on their own once their end time has passed.
"""
from datetime import timedelta

from app import mongo
from app.utils.time_utils import now_ist, utcnow


def _slot(date, **extra):
    doc = {
        "slot_number": mongo.db.match_slots.count_documents({}) + 1,
        "day": date.strftime("%A"), "time_of_day": "Morning", "match_time": "06:15 AM",
        "start_time": "06:15", "is_adhoc": True, "match_date": date.isoformat(),
        "is_active": True, "created_at": utcnow(), **extra,
    }
    return str(mongo.db.match_slots.insert_one(doc).inserted_id)


def _ids(client, headers):
    resp = client.get("/api/slots", headers=headers)
    assert resp.status_code == 200
    return {s["id"] for s in resp.get_json()}


def test_home_hides_played_matches_but_keeps_upcoming_and_test(client, auth_header, make_user):
    captain = make_user("captain", "CAP", "pw")
    today = now_ist().date()
    old = _slot(today - timedelta(days=10))
    upcoming = _slot(today + timedelta(days=2))
    test = _slot(today - timedelta(days=60), is_test=True)

    ids = _ids(client, auth_header(captain))
    assert upcoming in ids and test in ids
    assert old not in ids


def test_todays_match_drops_off_after_its_end_time(client, auth_header, make_user):
    captain = make_user("captain", "CAP2", "pw")
    now = now_ist()
    earlier = (now - timedelta(hours=2)).strftime("%H:%M")
    later = (now + timedelta(hours=2)).strftime("%H:%M")
    start = (now - timedelta(hours=3)).strftime("%H:%M")
    if not start < earlier < later:  # too close to midnight for a same-day match
        return
    finished = _slot(now.date(), start_time=start, end_time=earlier)
    playing = _slot(now.date(), start_time=start, end_time=later)

    ids = _ids(client, auth_header(captain))
    assert playing in ids
    assert finished not in ids
