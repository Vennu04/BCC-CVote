"""
Email/SMS/WhatsApp channels (alongside existing Web Push) — every channel
must safely no-op when its own env vars aren't set, exactly like
VAPID_PRIVATE_KEY already does for push.
"""
from unittest.mock import patch

from app.services import notifications


class TestChannelsNoOpWhenUnconfigured:
    def test_send_email_noop_without_smtp_config(self):
        result = notifications.send_email(["a@example.com"], "Subject", "Body")
        assert result == {"sent": 0, "skipped": True}

    def test_send_sms_noop_without_twilio_config(self):
        result = notifications.send_sms(["+15551234567"], "Body")
        assert result == {"sent": 0, "skipped": True}

    def test_send_whatsapp_noop_without_twilio_config(self):
        result = notifications.send_whatsapp(["+15551234567"], "Body")
        assert result == {"sent": 0, "skipped": True}

    def test_send_email_noop_with_no_recipients(self):
        with patch.object(notifications, "SMTP_HOST", "smtp.example.com"), \
             patch.object(notifications, "SMTP_USER", "u"), \
             patch.object(notifications, "SMTP_PASSWORD", "p"):
            assert notifications.send_email([], "Subject", "Body") == {"sent": 0, "skipped": True}


class TestNotifyEvent:
    def test_unknown_event_returns_empty_and_does_not_raise(self, app):
        with app.app_context():
            result = notifications.notify_event("not_a_real_event", [])
            assert result == {}

    def test_always_attempts_push(self, app, make_user):
        user = make_user("player", "NOTIF1", "notif1pass")
        with app.app_context(), patch.object(notifications, "send_push_to_user_ids") as mock_push:
            mock_push.return_value = {"sent": 0, "failed": 0, "skipped": False}
            result = notifications.notify_event("voting_window_open", [user["_id"]], {"label": "Sat Morning"})
            mock_push.assert_called_once()
            assert result["push"]["skipped"] is False

    def test_skips_email_and_sms_when_user_has_no_contact_info(self, app, make_user):
        user = make_user("player", "NOTIF2", "notif2pass")  # no email/phone field
        with app.app_context(), patch.object(notifications, "send_push_to_user_ids") as mock_push, \
             patch.object(notifications, "send_email") as mock_email, \
             patch.object(notifications, "send_sms") as mock_sms, \
             patch.object(notifications, "send_whatsapp") as mock_wa:
            mock_push.return_value = {"skipped": False}
            notifications.notify_event("auction_started", [user["_id"]], {"label": "Sat Morning"})
            mock_email.assert_not_called()
            mock_sms.assert_not_called()
            mock_wa.assert_not_called()

    def test_reaches_email_and_phone_channels_when_user_has_contact_info(self, app, make_user):
        user = make_user("player", "NOTIF3", "notif3pass", email="p@example.com", phone="+15551234567")
        with app.app_context(), patch.object(notifications, "send_push_to_user_ids") as mock_push, \
             patch.object(notifications, "send_email") as mock_email, \
             patch.object(notifications, "send_sms") as mock_sms, \
             patch.object(notifications, "send_whatsapp") as mock_wa:
            mock_push.return_value = {"skipped": False}
            mock_email.return_value = {"sent": 1, "skipped": False}
            mock_sms.return_value = {"sent": 1, "skipped": False}
            mock_wa.return_value = {"sent": 1, "skipped": False}
            notifications.notify_event("player_sold", [user["_id"]], {"player_name": "X", "team_name": "Y"})
            mock_email.assert_called_once_with(["p@example.com"], "🏏 Player sold!", "X was sold to Y.")
            mock_sms.assert_called_once()
            mock_wa.assert_called_once()


class TestPlayerContactFields:
    def test_admin_can_set_player_email_and_phone(self, client, admin_headers, make_user):
        from app import mongo
        player = make_user("player", "NOTIF4", "notif4pass")
        resp = client.put(
            f"/api/admin/players/{player['_id']}",
            json={"email": "p4@example.com", "phone": "+15559998888"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        updated = mongo.db.users.find_one({"_id": player["_id"]})
        assert updated["email"] == "p4@example.com"
        assert updated["phone"] == "+15559998888"

    def test_admin_can_set_captain_email_and_phone(self, client, admin_headers, make_user):
        from app import mongo
        captain = make_user("captain", "NOTIF5", "notif5pass")
        resp = client.put(
            f"/api/admin/captains/{captain['_id']}",
            json={"email": "c5@example.com", "phone": "+15557776666"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        updated = mongo.db.users.find_one({"_id": captain["_id"]})
        assert updated["email"] == "c5@example.com"
        assert updated["phone"] == "+15557776666"
