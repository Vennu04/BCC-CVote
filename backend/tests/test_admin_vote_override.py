"""Admin-set/clear vote — for a captain/player who couldn't cast or fix their
own vote in time (mobile issues, travel, work). Deliberately bypasses the
self-service window-open and revoke-deadline rules in votes.py; every
override is logged to vote_overrides for accountability."""

from app import mongo


def test_admin_set_vote_creates_new_vote(client, make_user, make_slot_and_window, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    slot_id, _ = make_slot_and_window()

    res = client.post("/api/admin/votes", json={
        "user_id": str(p1["_id"]), "slot_id": slot_id, "availability": "available",
    }, headers=admin_headers)
    assert res.status_code == 200
    assert res.get_json()["availability"] == "available"

    dash = client.get("/api/admin/dashboard", headers=admin_headers).get_json()
    row = next(r for r in dash["vote_matrix"] if r["captain"]["id"] == str(p1["_id"]))
    vote = next(v for v in row["votes"] if v["slot_id"] == slot_id)
    assert vote["availability"] == "available"


def test_admin_set_vote_overwrites_existing_vote(client, make_user, make_slot_and_window, make_vote, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    slot_id, window_id = make_slot_and_window()
    make_vote(p1["_id"], slot_id, window_id, "not_available")

    res = client.post("/api/admin/votes", json={
        "user_id": str(p1["_id"]), "slot_id": slot_id, "availability": "maybe",
    }, headers=admin_headers)
    assert res.status_code == 200

    stored = mongo.db.votes.find_one({"captain_id": str(p1["_id"]), "slot_id": slot_id})
    assert stored["availability"] == "maybe"
    # Exactly one vote doc — an overwrite, not a duplicate.
    assert mongo.db.votes.count_documents({"captain_id": str(p1["_id"]), "slot_id": slot_id}) == 1


def test_admin_set_vote_works_after_window_closed(client, make_user, make_slot_and_window, admin_headers):
    """The whole point: admin can still fix a vote after the deadline that
    would block the person's own self-service submit_vote/revoke_vote."""
    from datetime import datetime, timedelta
    p1 = make_user("player", "PLR1", "plr1")
    slot_id, _ = make_slot_and_window(
        opens_at=datetime.utcnow() - timedelta(days=3),
        closes_at=datetime.utcnow() - timedelta(days=2),
    )

    res = client.post("/api/admin/votes", json={
        "user_id": str(p1["_id"]), "slot_id": slot_id, "availability": "available",
    }, headers=admin_headers)
    assert res.status_code == 200


def test_admin_set_vote_rejects_invalid_availability(client, make_user, make_slot_and_window, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    slot_id, _ = make_slot_and_window()
    res = client.post("/api/admin/votes", json={
        "user_id": str(p1["_id"]), "slot_id": slot_id, "availability": "yes please",
    }, headers=admin_headers)
    assert res.status_code == 400


def test_admin_set_vote_rejects_unknown_slot(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    res = client.post("/api/admin/votes", json={
        "user_id": str(p1["_id"]), "slot_id": "64b000000000000000000000", "availability": "available",
    }, headers=admin_headers)
    assert res.status_code == 404


def test_admin_set_vote_rejects_slot_with_no_window_configured(client, make_user, admin_headers):
    from datetime import datetime
    p1 = make_user("player", "PLR1", "plr1")
    slot_id = mongo.db.match_slots.insert_one({
        "slot_number": 9, "day": "Sunday", "time_of_day": "Evening",
        "is_active": True, "created_at": datetime.utcnow(),
    }).inserted_id
    res = client.post("/api/admin/votes", json={
        "user_id": str(p1["_id"]), "slot_id": str(slot_id), "availability": "available",
    }, headers=admin_headers)
    assert res.status_code == 400


def test_admin_set_vote_logs_override(client, make_user, make_slot_and_window, admin_headers, admin_user):
    p1 = make_user("player", "PLR1", "plr1")
    slot_id, _ = make_slot_and_window()

    client.post("/api/admin/votes", json={
        "user_id": str(p1["_id"]), "slot_id": slot_id, "availability": "available",
    }, headers=admin_headers)

    log = mongo.db.vote_overrides.find_one({"target_user_id": str(p1["_id"])})
    assert log is not None
    assert log["admin_id"] == str(admin_user["_id"])
    assert log["action"] == "set"
    assert log["old_availability"] is None
    assert log["new_availability"] == "available"


def test_admin_clear_vote_removes_it(client, make_user, make_slot_and_window, make_vote, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    slot_id, window_id = make_slot_and_window()
    make_vote(p1["_id"], slot_id, window_id, "available")

    res = client.delete(f"/api/admin/votes/{slot_id}/{p1['_id']}", headers=admin_headers)
    assert res.status_code == 200
    assert mongo.db.votes.find_one({"captain_id": str(p1["_id"]), "slot_id": slot_id}) is None


def test_admin_clear_vote_logs_override(client, make_user, make_slot_and_window, make_vote, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    slot_id, window_id = make_slot_and_window()
    make_vote(p1["_id"], slot_id, window_id, "not_available")

    client.delete(f"/api/admin/votes/{slot_id}/{p1['_id']}", headers=admin_headers)

    log = mongo.db.vote_overrides.find_one({"target_user_id": str(p1["_id"]), "action": "clear"})
    assert log is not None
    assert log["old_availability"] == "not_available"
    assert log["new_availability"] is None


def test_admin_clear_vote_404s_when_no_vote_exists(client, make_user, make_slot_and_window, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    slot_id, _ = make_slot_and_window()
    res = client.delete(f"/api/admin/votes/{slot_id}/{p1['_id']}", headers=admin_headers)
    assert res.status_code == 404


def test_admin_vote_routes_require_admin(client, make_user, make_slot_and_window, auth_header):
    p1 = make_user("player", "PLR1", "plr1")
    slot_id, _ = make_slot_and_window()
    headers = auth_header(p1)
    res = client.post("/api/admin/votes", json={
        "user_id": str(p1["_id"]), "slot_id": slot_id, "availability": "available",
    }, headers=headers)
    assert res.status_code == 403
