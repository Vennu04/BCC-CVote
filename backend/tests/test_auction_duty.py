"""
Auction Duty roster — weekend matches get an evening-before auction slot that
full admins volunteer for; weekday matches are the Organiser's and aren't
rostered.
"""
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from app import mongo
from app.routes import duty
from app.utils.time_utils import now_ist, utcnow


def _next_saturday(weeks_ahead=1):
    today = now_ist().date()
    return today + timedelta(days=(5 - today.weekday()) % 7 + 7 * weeks_ahead)


@pytest.fixture()
def make_match(app):
    def _make(match_date, team_a="Hawks", team_b="Royals", cancelled=False, **extra):
        slot = {
            "slot_number": mongo.db.match_slots.count_documents({}) + 1,
            "day": match_date.strftime("%A"), "time_of_day": "Morning",
            "match_time": "06:15 AM", "start_time": "06:15", "description": "",
            "is_adhoc": True, "match_date": match_date.isoformat(), "is_active": True,
            "team_a_name": team_a, "team_b_name": team_b, "group": "A",
            "created_at": utcnow(), **extra,
        }
        slot_id = mongo.db.match_slots.insert_one(slot).inserted_id
        mongo.db.voting_windows.insert_one({
            "slot_id": str(slot_id), "opens_at": utcnow() - timedelta(hours=1),
            "closes_at": utcnow() + timedelta(days=5), "is_active": True,
            "is_cancelled": cancelled, "created_at": utcnow(),
        })
        return str(slot_id)
    return _make


@pytest.fixture()
def admins(make_user, admin_user):
    """The real-world shape: one plain admin account plus captains who carry
    is_admin — both count as full admins."""
    return {
        "organiser": admin_user,
        "shashi": make_user("captain", "SHSH", "pw", name="Shashi", is_admin=True),
        "suresh": make_user("captain", "SUMD", "pw", name="Suresh", is_admin=True),
        "srikanth": make_user("captain", "SRKM", "pw", name="Srikanth M", is_admin=True),
    }


def _evening(client, headers, slot_id):
    body = client.get("/api/admin/duty", headers=headers).get_json()
    return next(e for e in body["evenings"] if e["slot_id"] == slot_id)


def _answer(client, auth_header, user, slot_id, slots=(), captain=False):
    return client.put(f"/api/admin/duty/{slot_id}/me", headers=auth_header(user),
                      json={"slots": list(slots), "captain": captain})


class TestAccess:
    def test_full_admins_including_is_admin_captains_can_open_it(self, client, auth_header, admins):
        for user in admins.values():
            assert client.get("/api/admin/duty", headers=auth_header(user)).status_code == 200

    def test_organizer_role_and_plain_captain_are_refused(self, client, auth_header, make_user):
        organizer = make_user("organizer", "ORG1", "pw")
        captain = make_user("captain", "CAP1", "pw")
        assert client.get("/api/admin/duty", headers=auth_header(organizer)).status_code == 403
        assert client.get("/api/admin/duty", headers=auth_header(captain)).status_code == 403

    def test_admin_list_is_full_admins_only(self, client, admin_headers, admins, make_user):
        make_user("captain", "CAP2", "pw", name="Not An Admin")
        names = [a["name"] for a in client.get("/api/admin/duty", headers=admin_headers).get_json()["admins"]]
        assert "Not An Admin" not in names
        assert {"Shashi", "Suresh", "Srikanth M"} <= set(names)


class TestEvenings:
    def test_auction_evening_is_the_day_before_the_match(self, client, admin_headers, make_match):
        saturday = _next_saturday()
        slot_id = make_match(saturday)
        e = _evening(client, admin_headers, slot_id)
        assert e["match_date"] == saturday.isoformat()
        assert e["auction_date"] == (saturday - timedelta(days=1)).isoformat()
        assert e["auction_day"] == "Friday"
        assert e["is_weekend"] is True
        assert e["match_label"] == "Hawks vs Royals"
        assert e["coverage"] == "nobody"

    def test_weekday_match_is_listed_for_the_organiser_not_rostered(self, client, admin_headers, auth_header,
                                                                    admins, make_match):
        tuesday = _next_saturday() + timedelta(days=3)
        slot_id = make_match(tuesday)
        e = _evening(client, admin_headers, slot_id)
        assert e["is_weekend"] is False and e["coverage"] == "organiser"
        assert _answer(client, auth_header, admins["shashi"], slot_id, ["19:30"]).status_code == 400

    def test_cancelled_and_test_matches_are_hidden(self, client, admin_headers, make_match):
        saturday = _next_saturday()
        cancelled = make_match(saturday, cancelled=True)
        practice = make_match(saturday + timedelta(days=1), is_test=True)
        ids = [e["slot_id"] for e in client.get("/api/admin/duty", headers=admin_headers).get_json()["evenings"]]
        assert cancelled not in ids and practice not in ids

    def test_moving_a_match_does_not_carry_answers_to_the_new_evening(self, client, admin_headers, auth_header,
                                                                        admins, make_match):
        saturday = _next_saturday()
        slot_id = make_match(saturday)
        _answer(client, auth_header, admins["shashi"], slot_id, ["19:30"])
        mongo.db.match_slots.update_one({}, {"$set": {"match_date": (saturday + timedelta(days=1)).isoformat()}})
        assert _evening(client, admin_headers, slot_id)["responses"] == {}


class TestAnswersAndSuggestion:
    def test_answer_is_saved_in_slot_order(self, client, admin_headers, auth_header, admins, make_match):
        slot_id = make_match(_next_saturday())
        resp = _answer(client, auth_header, admins["shashi"], slot_id, ["21:30", "19:30"])
        assert resp.status_code == 200
        mine = _evening(client, admin_headers, slot_id)["responses"][str(admins["shashi"]["_id"])]
        assert mine["slots"] == ["19:30", "21:30"] and mine["captain"] is False

    def test_rejects_unknown_slot_codes(self, client, auth_header, admins, make_match):
        slot_id = make_match(_next_saturday())
        assert _answer(client, auth_header, admins["shashi"], slot_id, ["18:00"]).status_code == 400

    def test_captain_flag_clears_slots_and_excludes_from_suggestion(self, client, admin_headers, auth_header,
                                                                     admins, make_match):
        slot_id = make_match(_next_saturday())
        _answer(client, auth_header, admins["shashi"], slot_id, ["19:30"], captain=True)
        _answer(client, auth_header, admins["suresh"], slot_id, ["19:30"])
        e = _evening(client, admin_headers, slot_id)
        assert e["responses"][str(admins["shashi"]["_id"])]["slots"] == []
        assert e["suggestion"] == {"start_slot": "19:30", "lead_id": str(admins["suresh"]["_id"]), "backup_id": None}
        assert e["coverage"] == "to_confirm"

    def test_suggestion_prefers_a_slot_with_two_admins_so_backup_overlaps(self, client, admin_headers,
                                                                          auth_header, admins, make_match):
        slot_id = make_match(_next_saturday())
        _answer(client, auth_header, admins["shashi"], slot_id, ["19:30", "20:30"])
        _answer(client, auth_header, admins["suresh"], slot_id, ["20:30"])
        s = _evening(client, admin_headers, slot_id)["suggestion"]
        assert s["start_slot"] == "20:30"
        assert {s["lead_id"], s["backup_id"]} == {str(admins["shashi"]["_id"]), str(admins["suresh"]["_id"])}

    def test_suggestion_rotates_toward_whoever_has_done_fewer_duties(self, client, admin_headers,
                                                                     auth_header, admins, make_match):
        first = make_match(_next_saturday())
        second = make_match(_next_saturday() + timedelta(days=1), team_a="Lions", team_b="Bulls")
        for slot_id in (first, second):
            _answer(client, auth_header, admins["shashi"], slot_id, ["19:30"])
            _answer(client, auth_header, admins["suresh"], slot_id, ["19:30"])
        shashi, suresh = str(admins["shashi"]["_id"]), str(admins["suresh"]["_id"])
        client.put(f"/api/admin/duty/{first}/assignment", headers=admin_headers,
                   json={"lead_id": shashi, "backup_id": suresh, "start_slot": "19:30"})
        mongo.db.auction_duty.update_one({"slot_id": first}, {"$set": {"backup_id": None}})
        # Shashi now has one duty, Suresh none -> Suresh leads next time.
        assert _evening(client, admin_headers, second)["suggestion"]["lead_id"] == suresh


class TestAssignment:
    def _setup(self, client, auth_header, admins, make_match):
        slot_id = make_match(_next_saturday())
        _answer(client, auth_header, admins["shashi"], slot_id, ["19:30", "20:30"])
        _answer(client, auth_header, admins["suresh"], slot_id, ["19:30"])
        _answer(client, auth_header, admins["srikanth"], slot_id, [], captain=True)
        return slot_id

    def test_confirming_lead_and_backup_marks_it_covered(self, client, admin_headers, auth_header, admins,
                                                         make_match):
        slot_id = self._setup(client, auth_header, admins, make_match)
        shashi, suresh = str(admins["shashi"]["_id"]), str(admins["suresh"]["_id"])
        with patch.object(duty, "notify_event") as notify:
            resp = client.put(f"/api/admin/duty/{slot_id}/assignment", headers=admin_headers,
                              json={"lead_id": shashi, "backup_id": suresh, "start_slot": "19:30"})
        assert resp.status_code == 200
        e = _evening(client, admin_headers, slot_id)
        assert (e["lead_id"], e["backup_id"], e["start_slot"], e["coverage"]) == (shashi, suresh, "19:30", "covered")
        assert e["assigned_by"] == admins["organiser"]["name"]
        notify.assert_called_once()
        assert notify.call_args.args[0] == "auction_duty_assigned"
        assert {str(i) for i in notify.call_args.args[1]} == {shashi, suresh}
        assert mongo.db.audit_logs.find_one({"action": "duty_assignment"})

    def test_assigner_is_not_notified_about_their_own_duty(self, client, auth_header, admins, make_match):
        slot_id = self._setup(client, auth_header, admins, make_match)
        shashi, suresh = str(admins["shashi"]["_id"]), str(admins["suresh"]["_id"])
        with patch.object(duty, "notify_event") as notify:
            client.put(f"/api/admin/duty/{slot_id}/assignment", headers=auth_header(admins["shashi"]),
                       json={"lead_id": shashi, "backup_id": suresh, "start_slot": "19:30"})
        assert [str(i) for i in notify.call_args.args[1]] == [suresh]

    def test_rejects_a_captain(self, client, admin_headers, auth_header, admins, make_match):
        slot_id = self._setup(client, auth_header, admins, make_match)
        resp = client.put(f"/api/admin/duty/{slot_id}/assignment", headers=admin_headers,
                          json={"lead_id": str(admins["srikanth"]["_id"]), "start_slot": "19:30"})
        assert resp.status_code == 400 and "captain" in resp.get_json()["error"]

    def test_rejects_someone_who_has_not_ticked_that_slot(self, client, admin_headers, auth_header, admins,
                                                          make_match):
        slot_id = self._setup(client, auth_header, admins, make_match)
        resp = client.put(f"/api/admin/duty/{slot_id}/assignment", headers=admin_headers,
                          json={"lead_id": str(admins["shashi"]["_id"]),
                                "backup_id": str(admins["suresh"]["_id"]), "start_slot": "20:30"})
        assert resp.status_code == 400 and "Suresh" in resp.get_json()["error"]

    def test_rejects_same_person_twice_and_non_admins(self, client, admin_headers, auth_header, admins,
                                                      make_match, make_user):
        slot_id = self._setup(client, auth_header, admins, make_match)
        shashi = str(admins["shashi"]["_id"])
        same = client.put(f"/api/admin/duty/{slot_id}/assignment", headers=admin_headers,
                          json={"lead_id": shashi, "backup_id": shashi, "start_slot": "19:30"})
        assert same.status_code == 400
        outsider = make_user("captain", "CAPX", "pw")
        resp = client.put(f"/api/admin/duty/{slot_id}/assignment", headers=admin_headers,
                          json={"lead_id": str(outsider["_id"]), "start_slot": "19:30"})
        assert resp.status_code == 400

    def test_clearing_the_assignment(self, client, admin_headers, auth_header, admins, make_match):
        slot_id = self._setup(client, auth_header, admins, make_match)
        client.put(f"/api/admin/duty/{slot_id}/assignment", headers=admin_headers,
                   json={"lead_id": str(admins["shashi"]["_id"]), "start_slot": "19:30"})
        client.put(f"/api/admin/duty/{slot_id}/assignment", headers=admin_headers, json={"lead_id": None})
        e = _evening(client, admin_headers, slot_id)
        assert e["lead_id"] is None and e["coverage"] == "to_confirm"

    def test_unticking_your_duty_slot_takes_you_off_the_roster(self, client, admin_headers, auth_header, admins,
                                                               make_match):
        slot_id = self._setup(client, auth_header, admins, make_match)
        shashi, suresh = str(admins["shashi"]["_id"]), str(admins["suresh"]["_id"])
        client.put(f"/api/admin/duty/{slot_id}/assignment", headers=admin_headers,
                   json={"lead_id": shashi, "backup_id": suresh, "start_slot": "19:30"})
        resp = _answer(client, auth_header, admins["shashi"], slot_id, ["20:30"])
        assert resp.get_json()["removed_from"] == "Lead"
        e = _evening(client, admin_headers, slot_id)
        assert e["lead_id"] is None and e["backup_id"] == suresh  # Backup not silently promoted
        # Still-free-at-start answers leave the roster alone.
        assert _answer(client, auth_header, admins["suresh"], slot_id, ["19:30", "21:30"]).get_json()["removed_from"] is None


class TestReminder:
    def _assigned(self, client, admin_headers, auth_header, admins, make_match):
        saturday = _next_saturday()
        slot_id = make_match(saturday)
        _answer(client, auth_header, admins["shashi"], slot_id, ["20:30"])
        _answer(client, auth_header, admins["suresh"], slot_id, ["20:30"])
        client.put(f"/api/admin/duty/{slot_id}/assignment", headers=admin_headers,
                   json={"lead_id": str(admins["shashi"]["_id"]), "backup_id": str(admins["suresh"]["_id"]),
                         "start_slot": "20:30"})
        return duty._slot_start_utc(saturday - timedelta(days=1), "20:30")

    def test_sends_once_within_the_hour_before_start(self, client, admin_headers, auth_header, admins, make_match):
        start = self._assigned(client, admin_headers, auth_header, admins, make_match)
        with patch.object(duty, "utcnow", return_value=start - timedelta(minutes=30)), \
             patch.object(duty, "notify_event") as notify:
            duty.send_due_duty_reminders()
            duty.send_due_duty_reminders()
        notify.assert_called_once()
        assert notify.call_args.args[0] == "auction_duty_reminder"
        assert len(notify.call_args.args[1]) == 2

    def test_not_sent_too_early(self, client, admin_headers, auth_header, admins, make_match):
        start = self._assigned(client, admin_headers, auth_header, admins, make_match)
        with patch.object(duty, "utcnow", return_value=start - timedelta(hours=3)), \
             patch.object(duty, "notify_event") as notify:
            duty.send_due_duty_reminders()
        notify.assert_not_called()

    def test_slot_start_is_ist(self):
        # 20:30 IST == 15:00 UTC
        assert duty._slot_start_utc(datetime(2026, 9, 25).date(), "20:30") == datetime(2026, 9, 25, 15, 0)
