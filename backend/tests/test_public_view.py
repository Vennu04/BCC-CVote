"""
Phase 5 — read-only public/viewer-facing surface. Chosen over a fully
unauthenticated public page: reuses the existing JWT/RBAC auth boundary
(the new viewer role from Phase 1) rather than opening new unauthenticated
endpoints, so the diff is small and there's no new unauthenticated attack
surface — just a read-only role that already can't vote/bid/manage anything.
"""
from app import mongo


class TestAttendanceLeaderboard:
    def test_ranks_by_attendance_descending(self, client, admin_headers, make_user):
        low = make_user("player", "LB1", "lb1pass")
        high = make_user("player", "LB2", "lb2pass")
        mongo.db.league_matches.insert_many([
            {"label": "M1", "attendee_ids": [str(high["_id"])], "created_at": None},
            {"label": "M2", "attendee_ids": [str(high["_id"]), str(low["_id"])], "created_at": None},
        ])
        resp = client.get("/api/attendance/leaderboard", headers=admin_headers)
        assert resp.status_code == 200
        board = resp.get_json()["leaderboard"]
        names_in_order = [e["name"] for e in board if e["name"] in (low["name"], high["name"])]
        assert names_in_order.index(high["name"]) < names_in_order.index(low["name"])
        entry = next(e for e in board if e["name"] == high["name"])
        assert entry["attendance_count"] == 2

    def test_accessible_to_viewer_role(self, client, make_user, auth_header):
        viewer = make_user("viewer", "LBVIEW", "lbviewpass")
        resp = client.get("/api/attendance/leaderboard", headers=auth_header(viewer))
        assert resp.status_code == 200

    def test_accessible_to_ordinary_player(self, client, make_user, auth_header):
        player = make_user("player", "LBPLR", "lbplrpass")
        resp = client.get("/api/attendance/leaderboard", headers=auth_header(player))
        assert resp.status_code == 200

    def test_requires_auth(self, client):
        resp = client.get("/api/attendance/leaderboard")
        assert resp.status_code == 401


class TestViewerReachesResults:
    def test_viewer_can_read_vote_summary(self, client, make_user, auth_header):
        viewer = make_user("viewer", "RESVIEW", "resviewpass")
        resp = client.get("/api/votes/summary", headers=auth_header(viewer))
        assert resp.status_code == 200

    def test_ranks_by_attendance_percentage_and_marks_me(self, client, make_user, auth_header):
        me = make_user("player", "LBME", "pw", matches_present=6, total_matches=8, attendance_percentage=75.0)
        make_user("player", "LBTOP", "pw", matches_present=8, total_matches=8, attendance_percentage=100.0)
        board = client.get("/api/attendance/leaderboard", headers=auth_header(me)).get_json()["leaderboard"]
        assert [e["name"] for e in board[:2]] == ["Lbtop", "Lbme"]
        mine = next(e for e in board if e["is_me"])
        assert (mine["name"], mine["matches_present"], mine["total_matches"], mine["attendance_percentage"]) == ("Lbme", 6, 8, 75.0)
        assert sum(e["is_me"] for e in board) == 1
