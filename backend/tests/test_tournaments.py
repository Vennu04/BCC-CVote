"""Tournaments — admins start a new tournament with any groups; the old one
is kept as history. Teams/fixtures that existed before are adopted."""
from app import mongo


def test_existing_teams_are_adopted_into_a_default_tournament(client, admin_headers):
    mongo.db.tournament_teams.insert_one({"name": "Old Team", "group": "B"})
    body = client.get("/api/tournament/teams", headers=admin_headers).get_json()
    assert [t["name"] for t in body["teams"]] == ["Old Team"]
    assert body["tournament"]["status"] == "active" and body["tournament"]["groups"] == ["B"]


def test_start_new_tournament_with_new_groups_and_keep_history(client, admin_headers, make_user):
    cap = make_user("captain", "CAPN", "pw")
    t1 = client.post("/api/admin/tournament/teams", headers=admin_headers, json={"name": "Hawks", "group": "A"})
    assert t1.status_code == 201
    team_id = t1.get_json()["team"]["id"]
    client.put(f"/api/admin/tournament/teams/{team_id}", headers=admin_headers, json={"captain_id": str(cap["_id"])})
    old_id = client.get("/api/tournaments", headers=admin_headers).get_json()["current_id"]

    res = client.post("/api/admin/tournaments", headers=admin_headers,
                      json={"name": "Winter Cup", "groups": ["a", "b", "c", "d"], "copy_teams": True})
    assert res.status_code == 201
    assert res.get_json()["tournament"]["groups"] == ["A", "B", "C", "D"]
    assert res.get_json()["copied_teams"] == 1

    # current pages show the new tournament; the copied team keeps its captain
    teams = client.get("/api/tournament/teams", headers=admin_headers).get_json()
    assert teams["tournament"]["name"] == "Winter Cup"
    assert teams["teams"][0]["captain_id"] == str(cap["_id"])
    # group D works now; an unknown group doesn't
    assert client.post("/api/admin/tournament/teams", headers=admin_headers, json={"name": "Lions", "group": "D"}).status_code == 201
    assert client.post("/api/admin/tournament/teams", headers=admin_headers, json={"name": "X", "group": "E"}).status_code == 400

    # the old tournament is history, still readable
    listing = client.get("/api/tournaments", headers=admin_headers).get_json()
    assert {t["status"] for t in listing["tournaments"]} == {"active", "finished"}
    old = client.get(f"/api/tournament/teams?tournament_id={old_id}", headers=admin_headers).get_json()
    assert old["tournament"]["status"] == "finished" and [t["name"] for t in old["teams"]] == ["Hawks"]


def test_groups_edit_rules(client, admin_headers):
    tid = client.get("/api/tournaments", headers=admin_headers).get_json()["current_id"]
    assert client.post("/api/admin/tournament/teams", headers=admin_headers, json={"name": "Hawks", "group": "A"}).status_code == 201
    assert client.put(f"/api/admin/tournaments/{tid}", headers=admin_headers, json={"groups": ["B", "C"]}).status_code == 400
    res = client.put(f"/api/admin/tournaments/{tid}", headers=admin_headers, json={"groups": ["A", "B", "C", "D"], "name": "Summer"})
    assert res.status_code == 200 and res.get_json()["tournament"]["groups"] == ["A", "B", "C", "D"]
    assert client.post("/api/admin/tournaments", headers=admin_headers, json={"name": "X", "groups": []}).status_code == 400
