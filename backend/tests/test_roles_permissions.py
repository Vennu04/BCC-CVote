"""
Access-boundary tests for the two new staff roles (organizer, viewer) added
alongside admin/captain/player — see utils/auth.py's PERMISSIONS map.

organizer: full admin-console access EXCEPT the "destructive" subset
           (delete captain/player, reset-device, close-window-early).
viewer:    no admin-console access, no vote/bid rights.
"""
from app.utils.auth import PERMISSIONS


def test_permissions_map_shape():
    # Locks in the exact contract the rest of this file (and the route
    # decorators) depend on — a future edit that widens/narrows either set
    # should have to consciously touch this test too.
    assert set(PERMISSIONS["manage"]) == {"admin", "organizer"}
    assert set(PERMISSIONS["destructive"]) == {"admin"}


class TestOrganizerAccess:
    def test_organizer_can_add_player(self, client, make_user, auth_header):
        organizer = make_user("organizer", "ORG1", "orgpass1")
        resp = client.post(
            "/api/admin/players",
            json={"name": "New Player", "team_code": "NEWP"},
            headers=auth_header(organizer),
        )
        assert resp.status_code == 201

    def test_organizer_can_view_dashboard(self, client, make_user, auth_header):
        organizer = make_user("organizer", "ORG2", "orgpass1")
        resp = client.get("/api/admin/dashboard", headers=auth_header(organizer))
        assert resp.status_code == 200

    def test_organizer_cannot_delete_player(self, client, make_user, auth_header):
        organizer = make_user("organizer", "ORG3", "orgpass1")
        player = make_user("player", "PLR1", "plr1pass")
        resp = client.delete(
            f"/api/admin/players/{player['_id']}", headers=auth_header(organizer)
        )
        assert resp.status_code == 403

    def test_organizer_cannot_delete_captain(self, client, make_user, auth_header):
        organizer = make_user("organizer", "ORG4", "orgpass1")
        captain = make_user("captain", "CAP1", "cap1pass")
        resp = client.delete(
            f"/api/admin/captains/{captain['_id']}", headers=auth_header(organizer)
        )
        assert resp.status_code == 403

    def test_organizer_cannot_reset_player_device(self, client, make_user, auth_header):
        organizer = make_user("organizer", "ORG5", "orgpass1")
        player = make_user("player", "PLR2", "plr2pass")
        resp = client.post(
            f"/api/admin/players/{player['_id']}/reset-device",
            headers=auth_header(organizer),
        )
        assert resp.status_code == 403

    def test_organizer_cannot_close_window_early(self, client, make_user, auth_header, make_slot_and_window):
        organizer = make_user("organizer", "ORG6", "orgpass1")
        slot_id, _ = make_slot_and_window()
        resp = client.post(
            "/api/admin/window/close", json={"slot_id": slot_id}, headers=auth_header(organizer)
        )
        assert resp.status_code == 403

    def test_organizer_can_reset_player_password(self, client, make_user, auth_header):
        # reset-password is deliberately NOT in the destructive set — only
        # reset-DEVICE is (per the user's spec).
        organizer = make_user("organizer", "ORG7", "orgpass1")
        player = make_user("player", "PLR3", "plr3pass")
        resp = client.post(
            f"/api/admin/players/{player['_id']}/reset-password",
            headers=auth_header(organizer),
        )
        assert resp.status_code == 200


class TestViewerAccess:
    def test_viewer_cannot_access_admin_dashboard(self, client, make_user, auth_header):
        viewer = make_user("viewer", "VIEW1", "viewpass1")
        resp = client.get("/api/admin/dashboard", headers=auth_header(viewer))
        assert resp.status_code == 403

    def test_viewer_cannot_add_player(self, client, make_user, auth_header):
        viewer = make_user("viewer", "VIEW2", "viewpass1")
        resp = client.post(
            "/api/admin/players",
            json={"name": "Nope", "team_code": "NOPE"},
            headers=auth_header(viewer),
        )
        assert resp.status_code == 403

    def test_viewer_cannot_vote(self, client, make_user, auth_header, make_slot_and_window):
        viewer = make_user("viewer", "VIEW3", "viewpass1")
        slot_id, _ = make_slot_and_window()
        resp = client.post(
            "/api/votes",
            json={"slot_id": slot_id, "availability": "available"},
            headers=auth_header(viewer),
        )
        assert resp.status_code == 403

    def test_viewer_can_still_authenticate_and_see_own_profile(self, client, make_user, auth_header):
        # viewer is unprivileged, not unauthenticated — /auth/me must still work.
        viewer = make_user("viewer", "VIEW4", "viewpass1")
        resp = client.get("/api/auth/me", headers=auth_header(viewer))
        assert resp.status_code == 200
        assert resp.get_json()["role"] == "viewer"
