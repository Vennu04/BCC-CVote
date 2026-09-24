"""A voting window scheduled for later must read as "not yet open", not
"closed" — the Home card uses it to say when voting opens."""
from datetime import timedelta

from app import mongo
from app.utils.time_utils import utcnow


def _slot_with_window(opens_delta, closes_delta):
    slot_id = str(mongo.db.match_slots.insert_one({
        "slot_number": 1, "day": "Saturday", "time_of_day": "Morning", "match_time": "06:15 AM",
        "is_adhoc": True, "is_active": True, "created_at": utcnow(),
    }).inserted_id)
    mongo.db.voting_windows.insert_one({
        "slot_id": slot_id, "is_active": True, "created_at": utcnow(),
        "opens_at": utcnow() + opens_delta, "closes_at": utcnow() + closes_delta,
    })
    return slot_id


def _window(client, headers):
    return client.get("/api/votes/my", headers=headers).get_json()["votes"][0]["window"]


def test_future_window_is_not_yet_open(client, make_user, auth_header):
    _slot_with_window(timedelta(days=1), timedelta(days=2))
    w = _window(client, auth_header(make_user("player", "NYO1", "pw")))
    assert w["is_open"] is False and w["not_yet_open"] is True and w["opens_at"]


def test_open_and_closed_windows_are_not_flagged(client, make_user, auth_header):
    headers = auth_header(make_user("player", "NYO2", "pw"))
    _slot_with_window(-timedelta(days=1), timedelta(days=1))
    assert _window(client, headers)["not_yet_open"] is False
    mongo.db.voting_windows.update_many({}, {"$set": {"closes_at": utcnow() - timedelta(hours=1)}})
    w = _window(client, headers)
    assert w["is_open"] is False and w["not_yet_open"] is False
