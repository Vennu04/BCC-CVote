"""Requirement #6 (forced password reset) and #3/#4 (device lock + admin reset)."""
from app import mongo


def test_login_rejects_wrong_password(client, make_user):
    make_user("captain", "CAP1", "correctpw")
    res = client.post("/api/auth/login", json={"team_code": "CAP1", "password": "wrongpw"})
    assert res.status_code == 401


def test_login_surfaces_must_change_password_flag(client, make_user):
    make_user("captain", "CAP1", "cap1", must_change_password=True)
    res = client.post("/api/auth/login", json={"team_code": "CAP1", "password": "cap1"})
    assert res.status_code == 200
    assert res.get_json()["user"]["must_change_password"] is True


def test_change_password_rejects_wrong_current_password(client, make_user, auth_header):
    user = make_user("captain", "CAP1", "cap1", must_change_password=True)
    res = client.post(
        "/api/auth/change-password",
        json={"current_password": "not-it", "new_password": "newpw1"},
        headers=auth_header(user),
    )
    assert res.status_code == 401


def test_change_password_rejects_same_as_current(client, make_user, auth_header):
    user = make_user("captain", "CAP1", "cap1", must_change_password=True)
    res = client.post(
        "/api/auth/change-password",
        json={"current_password": "cap1", "new_password": "cap1"},
        headers=auth_header(user),
    )
    assert res.status_code == 400


def test_change_password_success_clears_forced_flag_and_allows_new_login(client, make_user, auth_header):
    user = make_user("captain", "CAP1", "cap1", must_change_password=True)
    res = client.post(
        "/api/auth/change-password",
        json={"current_password": "cap1", "new_password": "newpw123"},
        headers=auth_header(user),
    )
    assert res.status_code == 200

    # Changing the password bumps token_version — the request's own (now-stale)
    # token no longer passes _token_version_matches, same as any other session
    # that was already open elsewhere. The response carries a fresh token for
    # exactly this reason (see auth.py's change_password); use that one, the
    # same way the frontend's AuthContext.updateToken does.
    new_token = res.get_json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {new_token}"})
    assert me.get_json()["must_change_password"] is False

    # And the *old* token (what auth_header(user) still produces here, since
    # it has no way to know the DB's token_version moved) must now be rejected.
    stale = client.get("/api/auth/me", headers=auth_header(user))
    assert stale.status_code == 404

    relogin = client.post("/api/auth/login", json={"team_code": "CAP1", "password": "newpw123"})
    assert relogin.status_code == 200
    assert relogin.get_json()["user"]["must_change_password"] is False


def test_first_login_binds_device(client, make_user):
    make_user("captain", "CAP1", "cap1")
    res = client.post("/api/auth/login", json={"team_code": "CAP1", "password": "cap1", "device_id": "device-A"})
    assert res.status_code == 200

    second = client.post("/api/auth/login", json={"team_code": "CAP1", "password": "cap1", "device_id": "device-A"})
    assert second.status_code == 200


def test_login_from_different_device_is_rejected(client, make_user):
    make_user("captain", "CAP1", "cap1")
    client.post("/api/auth/login", json={"team_code": "CAP1", "password": "cap1", "device_id": "device-A"})

    res = client.post("/api/auth/login", json={"team_code": "CAP1", "password": "cap1", "device_id": "device-B"})
    assert res.status_code == 403


def test_device_lock_disabled_allows_switching_devices_freely(client, make_user, app):
    # Temporary escape hatch (DEVICE_LOCK_ENABLED=false) for e.g. players
    # testing across multiple devices — see config.py.
    app.config["DEVICE_LOCK_ENABLED"] = False
    try:
        make_user("captain", "CAP1", "cap1")
        client.post("/api/auth/login", json={"team_code": "CAP1", "password": "cap1", "device_id": "device-A"})

        res = client.post("/api/auth/login", json={"team_code": "CAP1", "password": "cap1", "device_id": "device-B"})
        assert res.status_code == 200

        # Still quietly tracks the latest device rather than leaving the
        # very first one bound forever, so re-enabling later locks onto
        # whichever device is actually in use at that point.
        user = mongo.db.users.find_one({"team_code": "CAP1"})
        assert user["device_id"] == "device-B"
    finally:
        app.config["DEVICE_LOCK_ENABLED"] = True


def test_admin_login_is_exempt_from_device_lock(client, make_user):
    make_user("admin", "ADMIN", "adminpw")
    client.post("/api/auth/login", json={"team_code": "ADMIN", "password": "adminpw", "device_id": "device-A"})

    res = client.post("/api/auth/login", json={"team_code": "ADMIN", "password": "adminpw", "device_id": "device-B"})
    assert res.status_code == 200


def test_admin_reset_device_unblocks_a_new_device(client, make_user, admin_headers):
    captain = make_user("captain", "CAP1", "cap1", device_id="device-A")

    blocked = client.post("/api/auth/login", json={"team_code": "CAP1", "password": "cap1", "device_id": "device-B"})
    assert blocked.status_code == 403

    reset = client.post(f"/api/admin/captains/{captain['_id']}/reset-device", headers=admin_headers)
    assert reset.status_code == 200

    res = client.post("/api/auth/login", json={"team_code": "CAP1", "password": "cap1", "device_id": "device-B"})
    assert res.status_code == 200
