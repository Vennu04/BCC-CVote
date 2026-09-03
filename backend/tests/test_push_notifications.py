from unittest.mock import patch

from app import mongo
from app.services.notification_scheduler import _check_and_notify


def test_subscribe_requires_auth(client):
    res = client.post("/api/push/subscribe", json={"endpoint": "x", "keys": {"p256dh": "a", "auth": "b"}})
    assert res.status_code == 401


def test_subscribe_validates_payload(client, make_user, auth_header):
    user = make_user("player", "PLR1", "plr1")
    res = client.post("/api/push/subscribe", headers=auth_header(user), json={})
    assert res.status_code == 400


def test_subscribe_upserts_by_endpoint(app, client, make_user, auth_header):
    user = make_user("player", "PLR1", "plr1")
    body = {"endpoint": "https://fcm.example/abc", "keys": {"p256dh": "a", "auth": "b"}}

    res = client.post("/api/push/subscribe", headers=auth_header(user), json=body)
    assert res.status_code == 200
    assert mongo.db.push_subscriptions.count_documents({}) == 1

    # Re-subscribing the same endpoint updates in place, not a second row.
    res = client.post("/api/push/subscribe", headers=auth_header(user), json=body)
    assert res.status_code == 200
    assert mongo.db.push_subscriptions.count_documents({}) == 1


def test_unsubscribe_removes_row(app, client, make_user, auth_header):
    user = make_user("player", "PLR1", "plr1")
    body = {"endpoint": "https://fcm.example/abc", "keys": {"p256dh": "a", "auth": "b"}}
    client.post("/api/push/subscribe", headers=auth_header(user), json=body)

    res = client.post("/api/push/unsubscribe", headers=auth_header(user), json={"endpoint": body["endpoint"]})
    assert res.status_code == 200
    assert mongo.db.push_subscriptions.count_documents({}) == 0


def test_vapid_public_key_endpoint_is_public(client):
    res = client.get("/api/push/vapid-public-key")
    assert res.status_code == 200
    assert "key" in res.get_json()


def test_check_and_notify_sends_once_for_newly_opened_window(app, make_slot_and_window, make_user):
    slot_id, window_id = make_slot_and_window()
    make_user("player", "PLR1", "plr1")  # eligible voter (VOTER_FILTER)
    make_user("admin", "ADMIN2", "admin2")  # not eligible — excluded from the send

    # notification_scheduler now calls notify_event() (services/notifications.py),
    # which is what actually calls send_push_to_user_ids — patched at its
    # source module so both the push-specific assertions below and the
    # (unconfigured, no-op) email/SMS/WhatsApp channels behave identically to
    # before this refactor.
    with app.app_context(), patch("app.services.notifications.send_push_to_user_ids") as mock_send:
        mock_send.return_value = {"sent": 1, "failed": 0, "skipped": False}
        _check_and_notify()

        assert mock_send.call_count == 1
        sent_user_ids, payload = mock_send.call_args[0]
        assert len(sent_user_ids) == 1  # only the player, not the second admin
        assert "url" in payload and "title" in payload

        window = mongo.db.voting_windows.find_one()
        assert window["notified_at"] is not None

        # Running again must not re-notify — notified_at already set.
        _check_and_notify()
        assert mock_send.call_count == 1


def test_check_and_notify_skips_test_slots(app, make_slot_and_window):
    slot_id, window_id = make_slot_and_window()
    mongo.db.match_slots.update_many({}, {"$set": {"is_test": True}})

    # notification_scheduler now calls notify_event() (services/notifications.py),
    # which is what actually calls send_push_to_user_ids — patched at its
    # source module so both the push-specific assertions below and the
    # (unconfigured, no-op) email/SMS/WhatsApp channels behave identically to
    # before this refactor.
    with app.app_context(), patch("app.services.notifications.send_push_to_user_ids") as mock_send:
        _check_and_notify()
        mock_send.assert_not_called()
        window = mongo.db.voting_windows.find_one()
        # Claimed (notified_at set) so it's never re-checked, but nothing was sent.
        assert window["notified_at"] is not None


def test_check_and_notify_skips_future_windows(app, make_slot_and_window):
    from datetime import timedelta
    from app.utils.time_utils import utcnow

    slot_id, window_id = make_slot_and_window(opens_at=utcnow() + timedelta(hours=1))

    # notification_scheduler now calls notify_event() (services/notifications.py),
    # which is what actually calls send_push_to_user_ids — patched at its
    # source module so both the push-specific assertions below and the
    # (unconfigured, no-op) email/SMS/WhatsApp channels behave identically to
    # before this refactor.
    with app.app_context(), patch("app.services.notifications.send_push_to_user_ids") as mock_send:
        _check_and_notify()
        mock_send.assert_not_called()
        window = mongo.db.voting_windows.find_one()
        assert "notified_at" not in window
