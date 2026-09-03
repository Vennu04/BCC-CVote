"""
Unified audit_logs collection — additive alongside the existing specialized
trails (vote_overrides, auction_release_log, proxy notes), which stay
untouched. These tests check the new collection gets written at a handful of
representative mutation points, not every single route.
"""
from app import mongo


def _actions_for(entity_type, entity_id=None):
    q = {"entity_type": entity_type}
    if entity_id is not None:
        q["entity_id"] = str(entity_id)
    return list(mongo.db.audit_logs.find(q))


class TestPlayerCaptainCrudAudit:
    def test_add_player_is_logged(self, client, admin_headers):
        resp = client.post(
            "/api/admin/players", json={"name": "New Player", "team_code": "AUD1"},
            headers=admin_headers,
        )
        assert resp.status_code == 201
        player_id = resp.get_json()["player"]["id"]
        logs = _actions_for("player", player_id)
        assert len(logs) == 1
        assert logs[0]["action"] == "create"
        assert logs[0]["new_value"]["team_code"] == "AUD1"

    def test_update_player_is_logged_with_old_and_new(self, client, admin_headers, make_user):
        player = make_user("player", "AUD2", "aud2pass")
        resp = client.put(
            f"/api/admin/players/{player['_id']}", json={"name": "Renamed"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        logs = _actions_for("player", player["_id"])
        assert any(l["action"] == "update" and l["new_value"] == {"name": "Renamed"}
                   and l["old_value"] == {"name": "Aud2"} for l in logs)

    def test_delete_player_is_logged(self, client, admin_headers, make_user):
        player = make_user("player", "AUD3", "aud3pass")
        resp = client.delete(f"/api/admin/players/{player['_id']}", headers=admin_headers)
        assert resp.status_code == 200
        logs = _actions_for("player", player["_id"])
        assert any(l["action"] == "delete" for l in logs)

    def test_add_captain_is_logged(self, client, admin_headers):
        resp = client.post(
            "/api/admin/captains", json={"name": "New Captain", "team_code": "AUD4"},
            headers=admin_headers,
        )
        assert resp.status_code == 201
        captain_id = resp.get_json()["captain"]["id"]
        logs = _actions_for("captain", captain_id)
        assert any(l["action"] == "create" for l in logs)


class TestVoteOverrideAudit:
    def test_admin_set_vote_is_logged(self, client, admin_headers, make_user, make_slot_and_window):
        captain = make_user("captain", "AUD5", "aud5pass")
        slot_id, _ = make_slot_and_window()
        resp = client.post(
            "/api/admin/votes",
            json={"user_id": str(captain["_id"]), "slot_id": slot_id, "availability": "available"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        logs = _actions_for("vote", f"{slot_id}:{captain['_id']}")
        assert any(l["action"] == "vote_override_set" for l in logs)


class TestAuditLogFieldsShape:
    def test_every_entry_has_required_fields(self, client, admin_headers):
        client.post("/api/admin/players", json={"name": "Shape Check", "team_code": "AUD6"},
                    headers=admin_headers)
        entry = mongo.db.audit_logs.find_one({"entity_type": "player", "action": "create",
                                               "new_value.team_code": "AUD6"})
        assert entry is not None
        for field in ("user_id", "action", "entity_type", "entity_id", "timestamp"):
            assert field in entry
