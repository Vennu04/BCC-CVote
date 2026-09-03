from app import mongo
from app.utils.time_utils import utcnow


def test_insights_shape_with_no_data(client, admin_headers):
    resp = client.get("/api/admin/dashboard/insights", headers=admin_headers)
    assert resp.status_code == 200
    body = resp.get_json()
    assert body == {
        "attendance_trend": [],
        "auction_spend_by_category": {},
        "participation_trend": [],
    }


def test_attendance_trend_reflects_league_matches(client, admin_headers):
    mongo.db.league_matches.insert_one({
        "label": "Week 1", "match_date": "2026-01-01",
        "attendee_ids": ["a", "b", "c"], "created_at": utcnow(),
    })
    resp = client.get("/api/admin/dashboard/insights", headers=admin_headers)
    trend = resp.get_json()["attendance_trend"]
    assert len(trend) == 1
    assert trend[0]["attendee_count"] == 3
    assert trend[0]["label"] == "Week 1"


def test_auction_spend_by_category_sums_sold_only(client, admin_headers):
    mongo.db.auction_players.insert_many([
        {"auction_id": "a1", "category": "power", "status": "sold", "sold_price": 12.5},
        {"auction_id": "a1", "category": "power", "status": "sold", "sold_price": 8.5},
        {"auction_id": "a1", "category": "classic", "status": "sold", "sold_price": 10.0},
        # Excluded: not sold via bidding.
        {"auction_id": "a1", "category": "classic", "status": "free_assigned", "sold_price": 0},
        {"auction_id": "a1", "category": "power", "status": "available", "sold_price": None},
    ])
    resp = client.get("/api/admin/dashboard/insights", headers=admin_headers)
    spend = resp.get_json()["auction_spend_by_category"]
    assert spend == {"power": 21.0, "classic": 10.0}


def test_participation_trend_computes_percentage(client, admin_headers, make_user, make_slot_and_window, make_vote):
    # 4 voters total; one window with 2 votes cast -> 50%.
    make_user("captain", "PART1", "part1pass")
    make_user("captain", "PART2", "part2pass")
    voter_c = make_user("player", "PART3", "part3pass")
    voter_d = make_user("player", "PART4", "part4pass")
    slot_id, window_id = make_slot_and_window()
    make_vote(voter_c["_id"], slot_id, window_id, "available")
    make_vote(voter_d["_id"], slot_id, window_id, "not_available")

    resp = client.get("/api/admin/dashboard/insights", headers=admin_headers)
    trend = resp.get_json()["participation_trend"]
    assert len(trend) == 1
    assert trend[0]["votes_cast"] == 2
    assert trend[0]["participation_pct"] == 50.0


def test_insights_requires_admin(client, make_user, auth_header):
    voter = make_user("player", "PART5", "part5pass")
    resp = client.get("/api/admin/dashboard/insights", headers=auth_header(voter))
    assert resp.status_code == 403


def test_insights_allows_organizer(client, make_user, auth_header):
    organizer = make_user("organizer", "ORGINS", "orginspass")
    resp = client.get("/api/admin/dashboard/insights", headers=auth_header(organizer))
    assert resp.status_code == 200
