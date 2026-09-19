"""Scheduling a pool (group A/B/C) fixture with a date, kickoff time, and an
optional "voting opens at" moment — backed by a real match slot + voting
window, so the match shows up on the Window Dashboard / Auction page. See
tournament.py's _sync_match_slot_and_window."""
from datetime import datetime, timedelta

from bson import ObjectId

from app import mongo
from app.utils.time_utils import IST, now_ist, utcnow


def _teams_and_group(client, admin_headers):
    ids = []
    for name in ("Alpha", "Bravo"):
        res = client.post("/api/admin/tournament/teams", json={"name": name, "group": "A"}, headers=admin_headers)
        ids.append(res.get_json()["team"]["id"])
    return ids


def _ist(days_from_now, hour=9, minute=0):
    dt = (now_ist() + timedelta(days=days_from_now)).replace(hour=hour, minute=minute, second=0, microsecond=0)
    return dt


def _create(client, admin_headers, team_ids, **extra):
    res = client.post("/api/admin/tournament/fixtures", json={
        "group": "A", "team1_id": team_ids[0], "team2_id": team_ids[1], **extra,
    }, headers=admin_headers)
    return res


def _window_for(fixture):
    return mongo.db.voting_windows.find_one({"slot_id": fixture["match_slot_id"], "is_active": True})


def test_fixture_without_date_has_no_slot_or_schedule(client, admin_headers):
    team_ids = _teams_and_group(client, admin_headers)
    fixture = _create(client, admin_headers, team_ids).get_json()["fixture"]
    assert fixture["match_slot_id"] is None
    assert "window_status" not in fixture


def test_dated_fixture_opens_voting_immediately_by_default(client, admin_headers):
    team_ids = _teams_and_group(client, admin_headers)
    kickoff = _ist(3)
    fixture = _create(client, admin_headers, team_ids,
                      date=kickoff.date().isoformat(), time="09:00").get_json()["fixture"]

    assert fixture["match_slot_id"]
    assert fixture["window_status"] == "open"
    window = _window_for(fixture)
    assert window["opens_at"] <= utcnow()
    assert window["closes_at"] > utcnow()


def test_voting_opens_at_schedules_a_future_window(client, admin_headers):
    team_ids = _teams_and_group(client, admin_headers)
    kickoff = _ist(3)
    opens = _ist(1, hour=18, minute=30)
    fixture = _create(client, admin_headers, team_ids,
                      date=kickoff.date().isoformat(), time="09:00",
                      voting_opens_at=opens.strftime("%Y-%m-%dT%H:%M")).get_json()["fixture"]

    assert fixture["window_status"] == "scheduled"
    assert fixture["voting_opens_at"] == opens.strftime("%Y-%m-%dT%H:%M")
    window = _window_for(fixture)
    assert window["opens_at"] > utcnow()


def test_voting_opens_at_must_be_before_kickoff(client, admin_headers):
    team_ids = _teams_and_group(client, admin_headers)
    kickoff = _ist(3)
    res = _create(client, admin_headers, team_ids,
                  date=kickoff.date().isoformat(), time="09:00",
                  voting_opens_at=_ist(4).strftime("%Y-%m-%dT%H:%M"))
    assert res.status_code == 400
    assert "before the match starts" in res.get_json()["error"]
    # A refused schedule leaves nothing half-created
    assert mongo.db.tournament_fixtures.count_documents({}) == 0
    assert mongo.db.match_slots.count_documents({}) == 0


def test_bad_voting_opens_at_format_is_a_400(client, admin_headers):
    team_ids = _teams_and_group(client, admin_headers)
    res = _create(client, admin_headers, team_ids, date=_ist(3).date().isoformat(),
                  time="09:00", voting_opens_at="tomorrow evening")
    assert res.status_code == 400


def test_rescheduling_moves_the_same_slot_and_window(client, admin_headers):
    team_ids = _teams_and_group(client, admin_headers)
    fixture = _create(client, admin_headers, team_ids,
                      date=_ist(3).date().isoformat(), time="09:00").get_json()["fixture"]
    slot_id = fixture["match_slot_id"]

    new_date = _ist(6).date().isoformat()
    res = client.put(f"/api/admin/tournament/fixtures/{fixture['id']}", json={
        "date": new_date, "time": "17:30",
        "voting_opens_at": _ist(4, hour=8).strftime("%Y-%m-%dT%H:%M"),
    }, headers=admin_headers)
    assert res.status_code == 200
    assert res.get_json()["match_slot_id"] == slot_id  # same slot, not a second one

    assert mongo.db.match_slots.count_documents({}) == 1
    slot = mongo.db.match_slots.find_one({"_id": ObjectId(slot_id)})
    assert slot["match_date"] == new_date
    assert slot["start_time"] == "17:30"
    assert slot["time_of_day"] == "Evening"

    assert mongo.db.voting_windows.count_documents({"slot_id": slot_id, "is_active": True}) == 1
    fixtures = client.get("/api/tournament/fixtures", headers=admin_headers).get_json()["fixtures"]
    assert fixtures[0]["window_status"] == "scheduled"


def test_changing_only_kickoff_keeps_a_scheduled_open_time(client, admin_headers):
    team_ids = _teams_and_group(client, admin_headers)
    opens = _ist(1, hour=18, minute=30)
    fixture = _create(client, admin_headers, team_ids, date=_ist(3).date().isoformat(), time="09:00",
                      voting_opens_at=opens.strftime("%Y-%m-%dT%H:%M")).get_json()["fixture"]

    client.put(f"/api/admin/tournament/fixtures/{fixture['id']}", json={"time": "11:00"}, headers=admin_headers)

    fixtures = client.get("/api/tournament/fixtures", headers=admin_headers).get_json()["fixtures"]
    assert fixtures[0]["voting_opens_at"] == opens.strftime("%Y-%m-%dT%H:%M")


def test_cannot_reschedule_once_an_auction_exists(client, admin_headers):
    team_ids = _teams_and_group(client, admin_headers)
    fixture = _create(client, admin_headers, team_ids,
                      date=_ist(3).date().isoformat(), time="09:00").get_json()["fixture"]
    window = _window_for(fixture)
    mongo.db.auctions.insert_one({"window_id": str(window["_id"]), "status": "pending", "created_at": utcnow()})

    res = client.put(f"/api/admin/tournament/fixtures/{fixture['id']}", json={
        "date": _ist(6).date().isoformat(),
    }, headers=admin_headers)
    assert res.status_code == 409

    # ...and the fixture itself was left unchanged
    stored = mongo.db.tournament_fixtures.find_one({"_id": ObjectId(fixture["id"])})
    assert stored["date"] == fixture["date"]

    listed = client.get("/api/tournament/fixtures", headers=admin_headers).get_json()["fixtures"][0]
    assert listed["auction_status"] == "pending"
    assert listed["auction_id"]


def test_venue_and_result_edits_still_work_after_an_auction_exists(client, admin_headers):
    team_ids = _teams_and_group(client, admin_headers)
    fixture = _create(client, admin_headers, team_ids,
                      date=_ist(3).date().isoformat(), time="09:00").get_json()["fixture"]
    window = _window_for(fixture)
    mongo.db.auctions.insert_one({"window_id": str(window["_id"]), "status": "active", "created_at": utcnow()})

    res = client.put(f"/api/admin/tournament/fixtures/{fixture['id']}", json={
        "venue": "Main Ground", "result": "Alpha won by 5 runs",
    }, headers=admin_headers)
    assert res.status_code == 200
    slot = mongo.db.match_slots.find_one({"_id": ObjectId(fixture["match_slot_id"])})
    assert slot["description"] == "Main Ground"


def test_adding_a_date_later_creates_the_slot(client, admin_headers):
    team_ids = _teams_and_group(client, admin_headers)
    fixture = _create(client, admin_headers, team_ids).get_json()["fixture"]

    res = client.put(f"/api/admin/tournament/fixtures/{fixture['id']}", json={
        "date": _ist(3).date().isoformat(), "time": "09:00",
    }, headers=admin_headers)
    assert res.status_code == 200
    assert res.get_json()["match_slot_id"]
    assert mongo.db.match_slots.count_documents({}) == 1


def test_scheduling_is_admin_only(client, make_user, auth_header):
    captain = make_user("captain", "CAP1", "cap1")
    res = client.put(f"/api/admin/tournament/fixtures/{ObjectId()}", json={"venue": "x"},
                     headers=auth_header(captain))
    assert res.status_code in (401, 403)


def test_admin_dashboard_identifies_a_fixture_match_by_teams_and_date(client, admin_headers):
    """The Admin Dashboard's stat cards and vote matrix have to say *which*
    match a slot is — both teams, group, real date and kickoff time — not just
    "Saturday Morning"."""
    team_ids = _teams_and_group(client, admin_headers)
    kickoff = _ist(3, hour=6, minute=15)
    _create(client, admin_headers, team_ids, date=kickoff.date().isoformat(), time="06:15")

    body = client.get("/api/admin/dashboard", headers=admin_headers).get_json()

    card = next(s for s in body["slots"] if s["team_a_name"] == "Alpha")
    assert (card["team_a_name"], card["team_b_name"], card["group"]) == ("Alpha", "Bravo", "A")
    assert card["resolved_match_date"] == kickoff.date().isoformat()
    assert card["match_time"] == "06:15 AM"

    # Same identity on the matrix columns, so the grid header can name the match.
    from tests.conftest import _insert_user  # a voter row is needed for the matrix to have columns
    _insert_user("captain", "CAP1", "cap1", name="Cap One")
    matrix = client.get("/api/admin/dashboard", headers=admin_headers).get_json()["vote_matrix"]
    cell = next(v for v in matrix[0]["votes"] if v["team_a_name"] == "Alpha")
    assert cell["team_b_name"] == "Bravo"
    assert cell["resolved_match_date"] == kickoff.date().isoformat()


def test_admin_dashboard_leaves_teams_empty_for_a_slot_without_a_fixture(client, admin_headers):
    mongo.db.match_slots.insert_one({
        "slot_number": 1, "day": "Saturday", "time_of_day": "Morning",
        "is_active": True, "is_adhoc": True, "match_date": _ist(2).date().isoformat(),
    })
    # No window yet -> not archived, so the card is listed with no team names.
    card = client.get("/api/admin/dashboard", headers=admin_headers).get_json()["slots"][0]
    assert card["team_a_name"] is None and card["team_b_name"] is None
