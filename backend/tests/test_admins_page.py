"""Admins page — any full admin can give or take admin rights, no DB edits."""


def test_make_and_remove_an_admin(client, admin_headers, auth_header, make_user):
    p = make_user("player", "NEWADM", "pw", name="New Admin")
    assert client.put(f"/api/admin/admins/{p['_id']}", headers=admin_headers, json={"is_admin": True}).status_code == 200
    names = [a["name"] for a in client.get("/api/admin/admins", headers=admin_headers).get_json()]
    assert "New Admin" in names
    # the new admin can now use admin pages, and remove themselves
    assert client.get("/api/admin/admins", headers=auth_header(p)).status_code == 200
    assert client.put(f"/api/admin/admins/{p['_id']}", headers=admin_headers, json={"is_admin": False}).status_code == 200
    assert client.get("/api/admin/admins", headers=auth_header(p)).status_code == 403


def test_organiser_login_stays_and_last_admin_is_kept(client, admin_user, admin_headers, make_user):
    res = client.put(f"/api/admin/admins/{admin_user['_id']}", headers=admin_headers, json={"is_admin": False})
    assert res.status_code == 400
    assert client.put(f"/api/admin/admins/{admin_user['_id']}", headers=admin_headers, json={"is_admin": "yes"}).status_code == 400


def test_players_cannot_change_admins(client, auth_header, make_user):
    p = make_user("player", "PLAIN", "pw")
    assert client.put(f"/api/admin/admins/{p['_id']}", headers=auth_header(p), json={"is_admin": True}).status_code == 403
