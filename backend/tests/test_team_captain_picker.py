"""
Teams carry their captain (picked once on the Tournament page); renames of a
team flow into its matches and its captain's profile; fixtures carry an end
time; removed people can be listed and brought back.
"""
from datetime import timedelta

from bson import ObjectId

from app import mongo
from app.utils.time_utils import now_ist


def _team(name, group="B"):
    return mongo.db.tournament_teams.insert_one({"name": name, "group": group}).inserted_id


def test_pick_captain_rename_team_and_matches_follow(client, admin_headers, make_user):
    t1, t2 = _team("Monster"), _team("Nanda Unbeatable")
    ravi = make_user("captain", "RAVI", "pw", name="Ravi", team_name="MONSTER")
    sada = make_user("captain", "SADA", "pw", name="Sadanand", team_name="NANDA UNBEATABLE SQUAD")
    date = (now_ist().date() + timedelta(days=3)).isoformat()
    res = client.post("/api/admin/tournament/fixtures", headers=admin_headers, json={
        "group": "B", "team1_id": str(t1), "team2_id": str(t2), "date": date, "time": "06:15", "end_time": "10:00"})
    assert res.status_code == 201
    slot_id = res.get_json()["fixture"]["match_slot_id"]
    slot = mongo.db.match_slots.find_one({"_id": ObjectId(slot_id)})
    assert slot["end_time"] == "10:00" and slot["match_time"] == "06:15 AM – 10:00 AM"

    # Text matching misses Sadanand; picking him as captain fixes it.
    assert client.put(f"/api/admin/tournament/teams/{t2}", headers=admin_headers,
                      json={"captain_id": str(sada["_id"])}).status_code == 200
    ov = client.get("/api/admin/overview", headers=admin_headers).get_json()
    assert {c["name"] for c in ov["matches"][0]["captains"]} == {"Ravi", "Sadanand"}

    # Rename the team: the match card and the captain's profile follow.
    assert client.put(f"/api/admin/tournament/teams/{t2}", headers=admin_headers,
                      json={"name": "Nanda Kings"}).status_code == 200
    assert mongo.db.match_slots.find_one({"_id": ObjectId(slot_id)})["team_b_name"] == "Nanda Kings"
    assert mongo.db.users.find_one({"_id": sada["_id"]})["team_name"] == "NANDA KINGS"
    teams = client.get("/api/tournament/teams", headers=admin_headers).get_json()["teams"]
    assert next(t for t in teams if t["id"] == str(t2))["captain_name"] == "Sadanand"


def test_one_captain_cannot_lead_two_teams(client, admin_headers, make_user):
    t1, t2 = _team("A1"), _team("A2")
    cap = make_user("captain", "CAPX", "pw")
    assert client.put(f"/api/admin/tournament/teams/{t1}", headers=admin_headers,
                      json={"captain_id": str(cap["_id"])}).status_code == 200
    res = client.put(f"/api/admin/tournament/teams/{t2}", headers=admin_headers, json={"captain_id": str(cap["_id"])})
    assert res.status_code == 400
    # clearing works
    assert client.put(f"/api/admin/tournament/teams/{t1}", headers=admin_headers,
                      json={"captain_id": None}).status_code == 200


def test_removed_people_can_be_listed_and_brought_back(client, admin_headers, make_user):
    gone = make_user("player", "GONE", "pw", is_active=False)
    make_user("player", "HERE", "pw")
    names = [p["team_code"] for p in client.get("/api/admin/players?inactive=1", headers=admin_headers).get_json()]
    assert names == ["GONE"]
    assert client.put(f"/api/admin/players/{gone['_id']}", headers=admin_headers,
                      json={"is_active": True}).status_code == 200
    assert client.get("/api/admin/players?inactive=1", headers=admin_headers).get_json() == []
