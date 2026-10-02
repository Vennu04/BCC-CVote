"""Captain-confirmed match dates: suggest up to 3 options; once both captains
tick the same one the match is scheduled and voting opens."""
from datetime import timedelta

import pytest
from bson import ObjectId

from app import mongo
from app.utils.time_utils import now_ist


def _day(n):
    return (now_ist().date() + timedelta(days=n)).isoformat()


@pytest.fixture()
def fixture_setup(client, admin_headers, make_user):
    a = make_user("captain", "CAPA1", "pw", name="Cap A")
    b = make_user("captain", "CAPB1", "pw", name="Cap B")
    outsider = make_user("captain", "OUT1", "pw", name="Outsider")
    ids = []
    for name, cap in (("Hawks", a), ("Royals", b)):
        tid = client.post("/api/admin/tournament/teams", headers=admin_headers, json={"name": name, "group": "A"}).get_json()["team"]["id"]
        client.put(f"/api/admin/tournament/teams/{tid}", headers=admin_headers, json={"captain_id": str(cap["_id"])})
        ids.append(tid)
    fx = client.post("/api/admin/tournament/fixtures", headers=admin_headers,
                     json={"group": "A", "team1_id": ids[0], "team2_id": ids[1]}).get_json()["fixture"]
    return {"a": a, "b": b, "outsider": outsider, "fixture_id": fx["id"]}


def _opts():
    return [{"date": _day(3), "time": "06:15", "end_time": "10:00"}, {"date": _day(4), "time": "06:15"}, {"date": _day(5), "time": "15:30"}]


def test_both_captains_agree_and_the_match_is_scheduled(client, auth_header, fixture_setup):
    s = fixture_setup
    res = client.post("/api/schedule/proposals", headers=auth_header(s["a"]), json={"fixture_id": s["fixture_id"], "options": _opts()})
    assert res.status_code == 201
    pid = res.get_json()["proposal"]["id"]
    # captain B sees it and it's their turn
    mine = client.get("/api/schedule/proposals", headers=auth_header(s["b"])).get_json()["proposals"]
    assert [p["id"] for p in mine] == [pid] and mine[0]["my_turn"]
    # B can only make option 2 (index 1) — A proposed all three, so it's agreed
    res = client.put(f"/api/schedule/proposals/{pid}/response", headers=auth_header(s["b"]), json={"options": [1]})
    assert res.status_code == 200 and res.get_json()["scheduled"] is True

    fx = mongo.db.tournament_fixtures.find_one({"_id": ObjectId(s["fixture_id"])})
    assert fx["date"] == _day(4) and fx["time"] == "06:15" and fx.get("match_slot_id")
    assert mongo.db.voting_windows.find_one({"slot_id": fx["match_slot_id"], "is_active": True})
    assert mongo.db.schedule_proposals.find_one({"_id": ObjectId(pid)})["status"] == "scheduled"


def test_no_common_date_waits_and_admin_can_pick(client, admin_headers, auth_header, fixture_setup):
    s = fixture_setup
    pid = client.post("/api/schedule/proposals", headers=admin_headers,
                      json={"fixture_id": s["fixture_id"], "options": _opts()}).get_json()["proposal"]["id"]
    assert client.put(f"/api/schedule/proposals/{pid}/response", headers=auth_header(s["a"]), json={"options": [0]}).get_json()["scheduled"] is False
    assert client.put(f"/api/schedule/proposals/{pid}/response", headers=auth_header(s["b"]), json={"options": [2]}).get_json()["scheduled"] is False
    res = client.post(f"/api/schedule/proposals/{pid}/pick", headers=admin_headers, json={"option": 2})
    assert res.status_code == 200
    assert mongo.db.tournament_fixtures.find_one({"_id": ObjectId(s["fixture_id"])})["time"] == "15:30"


def test_who_can_do_what(client, admin_headers, auth_header, fixture_setup):
    s = fixture_setup
    body = {"fixture_id": s["fixture_id"], "options": _opts()}
    assert client.post("/api/schedule/proposals", headers=auth_header(s["outsider"]), json=body).status_code == 403
    pid = client.post("/api/schedule/proposals", headers=auth_header(s["a"]), json=body).get_json()["proposal"]["id"]
    assert client.put(f"/api/schedule/proposals/{pid}/response", headers=auth_header(s["outsider"]), json={"options": [0]}).status_code == 403
    assert client.post(f"/api/schedule/proposals/{pid}/pick", headers=auth_header(s["b"]), json={"option": 0}).status_code == 403
    assert client.delete(f"/api/schedule/proposals/{pid}", headers=auth_header(s["b"])).status_code == 403
    assert client.delete(f"/api/schedule/proposals/{pid}", headers=auth_header(s["a"])).status_code == 200
    # the outsider can't see it; captain A's fixture list has it
    assert client.get("/api/schedule/proposals", headers=auth_header(s["outsider"])).get_json()["proposals"] == []
    assert [f["id"] for f in client.get("/api/schedule/fixtures", headers=auth_header(s["a"])).get_json()["fixtures"]] == [s["fixture_id"]]
    assert client.get("/api/schedule/fixtures", headers=auth_header(s["outsider"])).get_json()["fixtures"] == []


def test_bad_options_and_missing_captains(client, admin_headers, auth_header, fixture_setup, make_user):
    s = fixture_setup
    for opts in ([], [{"date": _day(-1), "time": "06:15"}], [{"date": _day(2), "time": "6am"}],
                 [{"date": _day(2), "time": "06:15", "end_time": "05:00"}], _opts() + [{"date": _day(9), "time": "06:15"}]):
        assert client.post("/api/schedule/proposals", headers=admin_headers,
                           json={"fixture_id": s["fixture_id"], "options": opts}).status_code == 400
    t = client.post("/api/admin/tournament/teams", headers=admin_headers, json={"name": "No Cap", "group": "A"}).get_json()["team"]["id"]
    team1 = mongo.db.tournament_fixtures.find_one({"_id": ObjectId(s["fixture_id"])})["team1_id"]
    fx = client.post("/api/admin/tournament/fixtures", headers=admin_headers,
                     json={"group": "A", "team1_id": str(team1), "team2_id": t}).get_json()["fixture"]["id"]
    res = client.post("/api/schedule/proposals", headers=admin_headers, json={"fixture_id": fx, "options": _opts()})
    assert res.status_code == 400 and "captain" in res.get_json()["error"]
