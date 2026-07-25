"""Ad-hoc slot start_time/end_time -- these exist so a real "start – end"
range can be shown (match_time, the display headline) without breaking
match_datetime_for_slot's parsing, which now reads start_time (a clean 24h
"HH:MM") instead of match_time itself. See admin.py's add_slot and
time_utils.py's match_datetime_for_slot."""
from app.utils.time_utils import match_datetime_for_slot


def _add_slot(client, admin_headers, **overrides):
    payload = {
        "match_date": "2026-08-15", "day": "Independence Day", "time_of_day": "Morning",
    }
    payload.update(overrides)
    return client.post("/api/admin/slots", json=payload, headers=admin_headers)


def test_start_and_end_time_compose_a_display_range(client, admin_headers):
    res = _add_slot(client, admin_headers, start_time="14:30", end_time="18:30")
    assert res.status_code == 201
    slot = res.get_json()["slot"]
    assert slot["match_time"] == "02:30 PM – 06:30 PM"


def test_start_time_alone_is_the_display_string(client, admin_headers):
    res = _add_slot(client, admin_headers, start_time="06:15")
    assert res.status_code == 201
    assert res.get_json()["slot"]["match_time"] == "06:15 AM"


def test_no_start_time_falls_back_to_description(client, admin_headers):
    res = _add_slot(client, admin_headers, description="Independence Day Match")
    assert res.status_code == 201
    assert res.get_json()["slot"]["match_time"] == "Independence Day Match"


def test_no_start_time_and_no_description_falls_back_to_time_of_day(client, admin_headers):
    res = _add_slot(client, admin_headers, time_of_day="Evening")
    assert res.status_code == 201
    assert res.get_json()["slot"]["match_time"] == "Evening"


def test_match_datetime_for_slot_parses_start_time_not_the_display_range():
    # The exact bug this feature fixes: match_time is a range ("02:30 PM –
    # 06:30 PM") that datetime.strptime can't parse at all, so
    # match_datetime_for_slot must read start_time instead, not match_time.
    slot = {
        "match_date": "2026-08-15", "time_of_day": "Evening", "is_adhoc": True,
        "match_time": "02:30 PM – 06:30 PM", "start_time": "14:30",
    }
    dt = match_datetime_for_slot(slot)
    assert dt is not None
    assert (dt.hour, dt.minute) == (9, 0)  # 14:30 IST == 09:00 UTC


def test_match_datetime_for_slot_falls_back_to_match_time_for_older_slots_without_start_time():
    # Pre-existing ad-hoc slots created before start_time existed only ever
    # had a single parseable match_time -- must keep working unchanged.
    slot = {"match_date": "2026-08-15", "time_of_day": "Morning", "is_adhoc": True, "match_time": "06:15 AM"}
    dt = match_datetime_for_slot(slot)
    assert dt is not None
    assert (dt.hour, dt.minute) == (0, 45)  # 06:15 IST == 00:45 UTC
