"""Reference-only knockout attendance tracking: a GET/PUT pair scoped to the
same voter roster (VOTER_FILTER) used everywhere else, with bulk update."""


def test_list_attendance_returns_voter_roster_with_defaults(client, make_user, admin_headers):
    captain = make_user("captain", "CAP1", "cap1")
    player = make_user("player", "PLR1", "plr1")
    admin_voter = make_user("admin", "ADMINVOTER", "pw", is_player=True)
    plain_admin = make_user("admin", "PLAINADMIN", "pw")  # no is_player

    res = client.get("/api/admin/attendance", headers=admin_headers)
    assert res.status_code == 200
    by_code = {r["team_code"]: r for r in res.get_json()}

    assert set(by_code) == {"CAP1", "PLR1", "ADMINVOTER"}
    assert "PLAINADMIN" not in by_code
    assert by_code["CAP1"]["attendance_count"] == 0
    assert by_code["CAP1"]["knockout_eligible"] is False


def test_update_attendance_bulk_updates_multiple_rows(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    p2 = make_user("player", "PLR2", "plr2")

    res = client.put("/api/admin/attendance", json={"updates": [
        {"id": str(p1["_id"]), "attendance_count": 6, "knockout_eligible": True},
        {"id": str(p2["_id"]), "attendance_count": 3, "knockout_eligible": False},
    ]}, headers=admin_headers)
    assert res.status_code == 200
    assert res.get_json()["modified_count"] == 2

    listing = {r["team_code"]: r for r in client.get("/api/admin/attendance", headers=admin_headers).get_json()}
    assert listing["PLR1"]["attendance_count"] == 6
    assert listing["PLR1"]["knockout_eligible"] is True
    assert listing["PLR2"]["attendance_count"] == 3
    assert listing["PLR2"]["knockout_eligible"] is False


def test_update_attendance_rejects_negative_count(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    res = client.put("/api/admin/attendance", json={"updates": [
        {"id": str(p1["_id"]), "attendance_count": -1, "knockout_eligible": False},
    ]}, headers=admin_headers)
    assert res.status_code == 400


def test_update_attendance_rejects_non_bool_eligible(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    res = client.put("/api/admin/attendance", json={"updates": [
        {"id": str(p1["_id"]), "attendance_count": 1, "knockout_eligible": "yes"},
    ]}, headers=admin_headers)
    assert res.status_code == 400


def test_update_attendance_rejects_account_outside_voter_roster(client, make_user, admin_headers):
    plain_admin = make_user("admin", "PLAINADMIN", "pw")  # no is_player
    res = client.put("/api/admin/attendance", json={"updates": [
        {"id": str(plain_admin["_id"]), "attendance_count": 1, "knockout_eligible": True},
    ]}, headers=admin_headers)
    assert res.status_code == 400


def test_update_attendance_rejects_empty_updates(client, admin_headers):
    res = client.put("/api/admin/attendance", json={"updates": []}, headers=admin_headers)
    assert res.status_code == 400
