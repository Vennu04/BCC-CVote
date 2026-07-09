"""Password-security work: validation rules, session invalidation via
token_version on any password change, and admin-assisted reset (including
its audit log)."""
from app import mongo


def test_change_password_rejects_short_password(client, make_user, auth_header):
    user = make_user("captain", "CAP1", "cap1", must_change_password=True)
    res = client.post(
        "/api/auth/change-password",
        json={"current_password": "cap1", "new_password": "abc12"},
        headers=auth_header(user),
    )
    assert res.status_code == 400
    assert "6 characters" in res.get_json()["error"]


def test_change_password_rejects_all_numeric_password(client, make_user, auth_header):
    user = make_user("captain", "CAP1", "cap1", must_change_password=True)
    res = client.post(
        "/api/auth/change-password",
        json={"current_password": "cap1", "new_password": "123456"},
        headers=auth_header(user),
    )
    assert res.status_code == 400
    assert "all numbers" in res.get_json()["error"]


def test_admin_reset_password_generates_temp_password_and_forces_change(
    client, make_user, admin_headers
):
    captain = make_user("captain", "CAP1", "cap1")
    res = client.post(f"/api/admin/captains/{captain['_id']}/reset-password", headers=admin_headers)
    assert res.status_code == 200
    temp_password = res.get_json()["temp_password"]
    assert len(temp_password) >= 6
    assert not temp_password.isdigit()

    # Old password no longer works; the new temp one does, and it forces a change.
    old_login = client.post("/api/auth/login", json={"team_code": "CAP1", "password": "cap1"})
    assert old_login.status_code == 401

    new_login = client.post("/api/auth/login", json={"team_code": "CAP1", "password": temp_password})
    assert new_login.status_code == 200
    assert new_login.get_json()["user"]["must_change_password"] is True


def test_admin_reset_password_invalidates_existing_session(client, make_user, auth_header, admin_headers):
    captain = make_user("captain", "CAP1", "cap1")
    stale_token = auth_header(captain)  # a token minted before the reset below

    res = client.post(f"/api/admin/captains/{captain['_id']}/reset-password", headers=admin_headers)
    assert res.status_code == 200

    # The captain's session from before the reset must now be dead — this is
    # the whole point of an admin-assisted reset for e.g. a lost phone.
    me = client.get("/api/auth/me", headers=stale_token)
    assert me.status_code == 404


def test_admin_reset_password_is_logged(client, make_user, admin_headers, admin_user):
    captain = make_user("captain", "CAP1", "cap1")
    res = client.post(f"/api/admin/captains/{captain['_id']}/reset-password", headers=admin_headers)
    assert res.status_code == 200

    log_entry = mongo.db.password_resets.find_one({"target_user_id": str(captain["_id"])})
    assert log_entry is not None
    assert log_entry["admin_id"] == str(admin_user["_id"])
    assert log_entry["target_user_name"] == captain["name"]
    assert log_entry["target_role"] == "captain"
    assert log_entry["reset_at"] is not None


def test_admin_reset_password_requires_admin(client, make_user, auth_header):
    captain = make_user("captain", "CAP1", "cap1")
    other_captain = make_user("captain", "CAP2", "cap2")
    res = client.post(
        f"/api/admin/captains/{captain['_id']}/reset-password",
        headers=auth_header(other_captain),
    )
    assert res.status_code == 403


def test_admin_reset_password_rejects_wrong_role(client, make_user, admin_headers):
    # A player id posted to the *captain* reset-password route shouldn't work,
    # and vice versa — _reset_password filters by exact role match.
    player = make_user("player", "PLR1", "plr1")
    res = client.post(f"/api/admin/captains/{player['_id']}/reset-password", headers=admin_headers)
    assert res.status_code == 404


def test_admin_generic_update_also_validates_and_invalidates_sessions(
    client, make_user, auth_header, admin_headers
):
    captain = make_user("captain", "CAP1", "cap1")
    stale_token = auth_header(captain)

    # Weak password rejected the same way the dedicated reset endpoint would.
    weak = client.put(f"/api/admin/captains/{captain['_id']}", json={"password": "111111"}, headers=admin_headers)
    assert weak.status_code == 400

    good = client.put(f"/api/admin/captains/{captain['_id']}", json={"password": "newpass1"}, headers=admin_headers)
    assert good.status_code == 200

    me = client.get("/api/auth/me", headers=stale_token)
    assert me.status_code == 404
