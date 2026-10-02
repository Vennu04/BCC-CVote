"""
Control Centre overview — per-match progress steps and the derived to-do list.
"""
from datetime import timedelta

import pytest

from app import mongo
from app.utils.time_utils import now_ist, utcnow


def _saturday(weeks_ahead=1):
    today = now_ist().date()
    return today + timedelta(days=(5 - today.weekday()) % 7 + 7 * weeks_ahead)


@pytest.fixture()
def match(app):
    def _make(match_date, open_window=True, cancelled=False, **extra):
        slot_id = str(mongo.db.match_slots.insert_one({
            "slot_number": mongo.db.match_slots.count_documents({}) + 1,
            "day": match_date.strftime("%A"), "time_of_day": "Morning", "match_time": "06:15 AM",
            "is_adhoc": True, "match_date": match_date.isoformat(), "is_active": True,
            "team_a_name": "Hawks", "team_b_name": "Royals", "group": "C", "created_at": utcnow(), **extra,
        }).inserted_id)
        window_id = str(mongo.db.voting_windows.insert_one({
            "slot_id": slot_id, "is_active": True, "is_cancelled": cancelled, "created_at": utcnow(),
            "opens_at": utcnow() - timedelta(days=1),
            "closes_at": utcnow() + (timedelta(days=1) if open_window else -timedelta(hours=1)),
        }).inserted_id)
        return slot_id, window_id
    return _make


def _vote(uid, slot_id, window_id, availability="available"):
    mongo.db.votes.insert_one({"captain_id": str(uid), "slot_id": slot_id, "window_id": window_id,
                               "availability": availability, "voted_at": utcnow()})


def _get(client, headers):
    resp = client.get("/api/admin/overview", headers=headers)
    assert resp.status_code == 200
    return resp.get_json()


def test_players_cannot_open_it(client, auth_header, make_user):
    player = make_user("player", "P1", "pw")
    assert client.get("/api/admin/overview", headers=auth_header(player)).status_code == 403


def test_counts_and_open_voting_step(client, admin_headers, make_user, match):
    slot_id, window_id = match(_saturday())
    a = make_user("player", "PA", "pw", auction_category="power")
    b = make_user("player", "PB", "pw", auction_category="power")
    c = make_user("player", "PC", "pw", auction_category="classic")
    make_user("player", "PD", "pw")  # hasn't voted
    _vote(a["_id"], slot_id, window_id)
    _vote(b["_id"], slot_id, window_id)
    _vote(c["_id"], slot_id, window_id, "not_available")
    m = _get(client, admin_headers)["matches"][0]
    assert m["label"] == "Hawks vs Royals"
    assert m["voting"]["state"] == "open"
    assert m["counts"]["available"] == 2 and m["counts"]["not_available"] == 1 and m["counts"]["yet_to_vote"] == 1
    assert m["odd_groups"] == []
    assert [s["state"] for s in m["steps"]] == ["current", "todo", "todo", "todo"]


def test_closed_voting_flags_odd_groups_small_pool_and_attendance(client, admin_headers, make_user, match):
    slot_id, window_id = match(_saturday(), open_window=False)
    p = make_user("player", "PX", "pw", auction_category="power")
    _vote(p["_id"], slot_id, window_id)
    data = _get(client, admin_headers)
    m = data["matches"][0]
    assert m["odd_groups"] == ["power"]
    assert [s["state"] for s in m["steps"]] == ["done", "current", "todo", "todo"]
    titles = [t["title"] for t in data["todos"]]
    assert any(t.startswith("Odd numbers: Power (1)") for t in titles)
    assert any("an auction needs 20" in t for t in titles)
    assert "Credit attendance" in titles
    assert data["todos"][0]["level"] == "red"


def test_attendance_step_done_once_everyone_credited(client, admin_headers, make_user, match):
    slot_id, window_id = match(_saturday(), open_window=False)
    for code in ("A1", "A2"):
        u = make_user("player", code, "pw", auction_category="classic")
        _vote(u["_id"], slot_id, window_id)
        mongo.db.attendance_credits.insert_one({"user_id": str(u["_id"]), "slot_id": slot_id, "window_id": window_id})
    data = _get(client, admin_headers)
    assert [s["state"] for s in data["matches"][0]["steps"]] == ["done", "done", "done", "current"]
    assert "Credit attendance" not in [t["title"] for t in data["todos"]]


def test_no_duty_confirmation_todos(client, admin_headers, match):
    # Any admin can run the auction, so nobody is nagged to pick a Lead/Backup.
    match(_saturday(weeks_ahead=0))
    titles = [t["title"] for t in _get(client, admin_headers)["todos"]]
    assert not any("Lead" in t or "Backup" in t for t in titles)


def test_completed_auction_needs_nothing(client, admin_headers, make_user, match):
    slot_id, window_id = match(_saturday(), open_window=False)
    mongo.db.auctions.insert_one({"window_id": window_id, "status": "completed", "created_at": utcnow()})
    data = _get(client, admin_headers)
    assert data["todos"] == []
    assert all(s["state"] == "done" for s in data["matches"][0]["steps"])


def test_cancelled_test_and_past_matches_are_left_out(client, admin_headers, match):
    match(_saturday(), cancelled=True)
    match(_saturday(), is_test=True)
    match(now_ist().date() - timedelta(days=2))
    assert _get(client, admin_headers)["matches"] == []


def test_match_captains_are_left_out_of_every_group(client, admin_headers, make_user, match):
    # Hawks' and Royals' captains voted available but run the draft, so the
    # groups are judged without them: 2 power, 2 classic — nothing odd.
    slot_id, window_id = match(_saturday())
    cap_a = make_user("captain", "CHA", "pw", team_name="HAWKS", is_player=True, auction_category="power")
    cap_b = make_user("captain", "CHB", "pw", team_name="royals ", is_player=True, auction_category="classic")
    players = [make_user("player", f"P{i}", "pw", auction_category=cat)
               for i, cat in enumerate(["power", "power", "classic", "classic"])]
    for u in [cap_a, cap_b, *players]:
        _vote(u["_id"], slot_id, window_id)

    m = _get(client, admin_headers)["matches"][0]
    assert m["counts"]["available"] == 6
    assert m["counts"]["by_group"]["power"] == 2
    assert m["counts"]["by_group"]["classic"] == 2
    assert m["odd_groups"] == []
    assert {c["name"] for c in m["captains"]} == {cap_a["name"], cap_b["name"]}

    resp = client.get(f"/api/admin/auction/preview?slot_id={slot_id}", headers=admin_headers)
    body = resp.get_json()
    assert resp.status_code == 200 and body["is_balanced"] is True
    assert body["total_voters"] == 4
    assert {c["id"] for c in body["captains_excluded"]} == {str(cap_a["_id"]), str(cap_b["_id"])}


def test_two_captains_claiming_one_team_are_not_guessed(client, admin_headers, make_user, match):
    slot_id, window_id = match(_saturday())
    a = make_user("captain", "CA1", "pw", team_name="Hawks", is_player=True, auction_category="power")
    b = make_user("captain", "CA2", "pw", team_name="Hawks", is_player=True, auction_category="power")
    for u in (a, b):
        _vote(u["_id"], slot_id, window_id)
    m = _get(client, admin_headers)["matches"][0]
    assert m["captains"] == []
    assert m["counts"]["by_group"]["power"] == 2
