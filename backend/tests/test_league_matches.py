"""League matches are the source of truth attendance_count/total_matches_organized
are derived from (see admin.py's _attendance_counts/_attendance_settings) —
admin records each match and checks off who attended it, rather than typing
running totals by hand."""


def test_add_match_defaults_label_and_starts_with_no_attendees(client, admin_headers):
    res = client.post("/api/admin/attendance/matches", json={}, headers=admin_headers)
    assert res.status_code == 201
    match = res.get_json()["match"]
    assert match["label"] == "Match 1"
    assert match["attendee_ids"] == []
    assert match["attendee_count"] == 0

    second = client.post("/api/admin/attendance/matches", json={}, headers=admin_headers).get_json()["match"]
    assert second["label"] == "Match 2"


def test_add_match_accepts_custom_label_and_date(client, admin_headers):
    res = client.post("/api/admin/attendance/matches", json={
        "label": "Semis vs Yuvi Sixers", "match_date": "2026-07-10",
    }, headers=admin_headers)
    match = res.get_json()["match"]
    assert match["label"] == "Semis vs Yuvi Sixers"
    assert match["match_date"] == "2026-07-10"


def test_list_matches_returns_all_sorted_by_creation(client, admin_headers):
    client.post("/api/admin/attendance/matches", json={"label": "First"}, headers=admin_headers)
    client.post("/api/admin/attendance/matches", json={"label": "Second"}, headers=admin_headers)

    res = client.get("/api/admin/attendance/matches", headers=admin_headers)
    labels = [m["label"] for m in res.get_json()]
    assert labels == ["First", "Second"]


def test_setting_match_attendance_updates_derived_counts_and_total(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    p2 = make_user("player", "PLR2", "plr2")
    p3 = make_user("player", "PLR3", "plr3")

    m1 = client.post("/api/admin/attendance/matches", json={}, headers=admin_headers).get_json()["match"]
    m2 = client.post("/api/admin/attendance/matches", json={}, headers=admin_headers).get_json()["match"]

    client.put(f"/api/admin/attendance/matches/{m1['id']}",
               json={"attendee_ids": [str(p1["_id"]), str(p2["_id"])]}, headers=admin_headers)
    client.put(f"/api/admin/attendance/matches/{m2['id']}",
               json={"attendee_ids": [str(p1["_id"])]}, headers=admin_headers)

    body = client.get("/api/admin/attendance", headers=admin_headers).get_json()
    assert body["settings"]["total_matches_organized"] == 2
    by_code = {r["team_code"]: r for r in body["voters"]}
    assert by_code["PLR1"]["attendance_count"] == 2  # attended both
    assert by_code["PLR2"]["attendance_count"] == 1  # attended only m1
    assert by_code["PLR3"]["attendance_count"] == 0  # attended neither


def test_deleting_a_match_recomputes_counts_and_total(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    m1 = client.post("/api/admin/attendance/matches", json={}, headers=admin_headers).get_json()["match"]
    m2 = client.post("/api/admin/attendance/matches", json={}, headers=admin_headers).get_json()["match"]
    client.put(f"/api/admin/attendance/matches/{m1['id']}", json={"attendee_ids": [str(p1["_id"])]}, headers=admin_headers)
    client.put(f"/api/admin/attendance/matches/{m2['id']}", json={"attendee_ids": [str(p1["_id"])]}, headers=admin_headers)

    res = client.delete(f"/api/admin/attendance/matches/{m1['id']}", headers=admin_headers)
    assert res.status_code == 200

    body = client.get("/api/admin/attendance", headers=admin_headers).get_json()
    assert body["settings"]["total_matches_organized"] == 1
    by_code = {r["team_code"]: r for r in body["voters"]}
    assert by_code["PLR1"]["attendance_count"] == 1


def test_deleting_unknown_match_returns_404(client, admin_headers):
    res = client.delete("/api/admin/attendance/matches/000000000000000000000000", headers=admin_headers)
    assert res.status_code == 404


def test_update_match_rejects_attendee_outside_voter_roster(client, make_user, admin_headers):
    plain_admin = make_user("admin", "PLAINADMIN", "pw")  # no is_player
    m1 = client.post("/api/admin/attendance/matches", json={}, headers=admin_headers).get_json()["match"]

    res = client.put(f"/api/admin/attendance/matches/{m1['id']}",
                      json={"attendee_ids": [str(plain_admin["_id"])]}, headers=admin_headers)
    assert res.status_code == 400


def test_update_match_rejects_invalid_attendee_id(client, admin_headers):
    m1 = client.post("/api/admin/attendance/matches", json={}, headers=admin_headers).get_json()["match"]
    res = client.put(f"/api/admin/attendance/matches/{m1['id']}",
                      json={"attendee_ids": ["not-an-object-id"]}, headers=admin_headers)
    assert res.status_code == 400


def test_update_match_rejects_non_list_attendee_ids(client, admin_headers):
    m1 = client.post("/api/admin/attendance/matches", json={}, headers=admin_headers).get_json()["match"]
    res = client.put(f"/api/admin/attendance/matches/{m1['id']}",
                      json={"attendee_ids": "not-a-list"}, headers=admin_headers)
    assert res.status_code == 400


def test_update_match_full_replace_can_remove_a_previously_checked_attendee(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    p2 = make_user("player", "PLR2", "plr2")
    m1 = client.post("/api/admin/attendance/matches", json={}, headers=admin_headers).get_json()["match"]

    client.put(f"/api/admin/attendance/matches/{m1['id']}",
               json={"attendee_ids": [str(p1["_id"]), str(p2["_id"])]}, headers=admin_headers)
    res = client.put(f"/api/admin/attendance/matches/{m1['id']}",
                      json={"attendee_ids": [str(p1["_id"])]}, headers=admin_headers)
    assert res.get_json()["match"]["attendee_count"] == 1

    body = client.get("/api/admin/attendance", headers=admin_headers).get_json()
    by_code = {r["team_code"]: r for r in body["voters"]}
    assert by_code["PLR1"]["attendance_count"] == 1
    assert by_code["PLR2"]["attendance_count"] == 0
