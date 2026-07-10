"""Reference-only knockout attendance tracking: attendance_count and
total_matches_organized are both derived from league_matches (see
test_league_matches.py) — this file covers the voter-roster GET, the
knockout_eligible bulk PUT, and the knockout_cutoff setting."""


def test_list_attendance_returns_voter_roster_with_defaults(client, make_user, admin_headers):
    captain = make_user("captain", "CAP1", "cap1")
    player = make_user("player", "PLR1", "plr1")
    admin_voter = make_user("admin", "ADMINVOTER", "pw", is_player=True)
    plain_admin = make_user("admin", "PLAINADMIN", "pw")  # no is_player

    res = client.get("/api/admin/attendance", headers=admin_headers)
    assert res.status_code == 200
    body = res.get_json()
    by_code = {r["team_code"]: r for r in body["voters"]}

    assert set(by_code) == {"CAP1", "PLR1", "ADMINVOTER"}
    assert "PLAINADMIN" not in by_code
    assert by_code["CAP1"]["attendance_count"] == 0
    assert by_code["CAP1"]["knockout_eligible"] is False
    assert body["settings"] == {"total_matches_organized": 0, "knockout_cutoff": 14}


def test_update_attendance_bulk_updates_eligibility_only(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    p2 = make_user("player", "PLR2", "plr2")

    res = client.put("/api/admin/attendance", json={"updates": [
        {"id": str(p1["_id"]), "knockout_eligible": True},
        {"id": str(p2["_id"]), "knockout_eligible": False},
    ]}, headers=admin_headers)
    assert res.status_code == 200

    listing = {r["team_code"]: r for r in client.get("/api/admin/attendance", headers=admin_headers).get_json()["voters"]}
    assert listing["PLR1"]["knockout_eligible"] is True
    assert listing["PLR2"]["knockout_eligible"] is False


def test_update_attendance_settings_persists_cutoff_only(client, admin_headers):
    res = client.put("/api/admin/attendance/settings", json={"knockout_cutoff": 30}, headers=admin_headers)
    assert res.status_code == 200
    assert res.get_json()["settings"] == {"total_matches_organized": 0, "knockout_cutoff": 30}

    listing = client.get("/api/admin/attendance", headers=admin_headers).get_json()
    assert listing["settings"] == {"total_matches_organized": 0, "knockout_cutoff": 30}


def test_update_attendance_settings_is_idempotent_upsert(client, admin_headers):
    client.put("/api/admin/attendance/settings", json={"knockout_cutoff": 28}, headers=admin_headers)
    res = client.put("/api/admin/attendance/settings", json={"knockout_cutoff": 30}, headers=admin_headers)
    assert res.status_code == 200
    assert res.get_json()["settings"]["knockout_cutoff"] == 30


def test_update_attendance_settings_rejects_negative_cutoff(client, admin_headers):
    res = client.put("/api/admin/attendance/settings", json={"knockout_cutoff": -5}, headers=admin_headers)
    assert res.status_code == 400


def test_update_attendance_settings_ignores_total_matches_organized(client, admin_headers):
    # It's derived now — even if a client sends it, it has no effect and isn't
    # required for the request to succeed.
    res = client.put("/api/admin/attendance/settings", json={
        "knockout_cutoff": 28, "total_matches_organized": 999,
    }, headers=admin_headers)
    assert res.status_code == 200
    assert res.get_json()["settings"]["total_matches_organized"] == 0


def test_update_attendance_rejects_non_bool_eligible(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    res = client.put("/api/admin/attendance", json={"updates": [
        {"id": str(p1["_id"]), "knockout_eligible": "yes"},
    ]}, headers=admin_headers)
    assert res.status_code == 400


def test_update_attendance_rejects_account_outside_voter_roster(client, make_user, admin_headers):
    plain_admin = make_user("admin", "PLAINADMIN", "pw")  # no is_player
    res = client.put("/api/admin/attendance", json={"updates": [
        {"id": str(plain_admin["_id"]), "knockout_eligible": True},
    ]}, headers=admin_headers)
    assert res.status_code == 400


def test_update_attendance_rejects_empty_updates(client, admin_headers):
    res = client.put("/api/admin/attendance", json={"updates": []}, headers=admin_headers)
    assert res.status_code == 400


# ── +1 attendance increment — independent per-player, no shared match ──────

def test_increment_player_attendance_from_null(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1")
    res = client.post(f"/api/admin/players/{p1['_id']}/attendance/increment", headers=admin_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body["matches_present"] == 1
    assert body["total_matches"] == 1
    assert body["attendance_percentage"] == 100.0

    listing = {r["team_code"]: r for r in client.get("/api/admin/attendance", headers=admin_headers).get_json()["voters"]}
    assert listing["PLR1"]["matches_present"] == 1
    assert listing["PLR1"]["total_matches"] == 1
    assert listing["PLR1"]["attendance_percentage"] == 100.0


def test_increment_player_attendance_accumulates(client, make_user, admin_headers):
    p1 = make_user("player", "PLR1", "plr1", matches_present=13, total_matches=17)
    for _ in range(2):
        res = client.post(f"/api/admin/players/{p1['_id']}/attendance/increment", headers=admin_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body["matches_present"] == 15
    assert body["total_matches"] == 19
    assert body["attendance_percentage"] == round(15 / 19 * 100, 2)


def test_increment_captain_attendance_uses_captain_endpoint(client, make_user, admin_headers):
    cap = make_user("captain", "CAP1", "cap1")
    res = client.post(f"/api/admin/captains/{cap['_id']}/attendance/increment", headers=admin_headers)
    assert res.status_code == 200
    assert res.get_json()["matches_present"] == 1

    # Wrong endpoint for the role 404s rather than silently succeeding.
    res = client.post(f"/api/admin/players/{cap['_id']}/attendance/increment", headers=admin_headers)
    assert res.status_code == 404


def test_increment_attendance_is_independent_per_player(client, make_user, admin_headers):
    """No shared 'a match happened' event — incrementing one player must not
    move anyone else's numbers."""
    p1 = make_user("player", "PLR1", "plr1")
    p2 = make_user("player", "PLR2", "plr2")

    client.post(f"/api/admin/players/{p1['_id']}/attendance/increment", headers=admin_headers)
    client.post(f"/api/admin/players/{p1['_id']}/attendance/increment", headers=admin_headers)

    listing = {r["team_code"]: r for r in client.get("/api/admin/attendance", headers=admin_headers).get_json()["voters"]}
    assert listing["PLR1"]["matches_present"] == 2
    assert listing["PLR1"]["total_matches"] == 2
    assert listing["PLR2"]["matches_present"] is None
    assert listing["PLR2"]["total_matches"] is None
    assert listing["PLR2"]["attendance_percentage"] is None


def test_increment_attendance_rejects_unknown_player(client, admin_headers):
    res = client.post("/api/admin/players/64b000000000000000000000/attendance/increment", headers=admin_headers)
    assert res.status_code == 404
