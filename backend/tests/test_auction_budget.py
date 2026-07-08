"""Regression test for a reported live-prod bug: a captain's total spend
appeared to exceed the 17-point budget across multiple players. Code review
of _captain_points_remaining/place_bid found the enforcement itself correct
(only the base-price-vs-budget-points display was confusing, fixed
separately in the frontend) — this proves it end-to-end against the actual
deployed logic rather than relying on that code review alone."""
from bson import ObjectId

from app import mongo


def _create(client, headers, setup):
    return client.post("/api/admin/auction", json={
        "slot_id": setup["slot_id"],
        "captain_a_id": str(setup["captain_a"]["_id"]),
        "captain_b_id": str(setup["captain_b"]["_id"]),
    }, headers=headers)


def test_captain_total_spend_never_exceeds_budget_across_multiple_players(
    client, admin_headers, auth_header, make_auction_setup
):
    # 6-player "power" category, quota = 3 per captain — plenty of headroom
    # so neither captain hits quota mid-test.
    setup = make_auction_setup([("power", None, None)] * 6)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers)

    players = list(mongo.db.auction_players.find({"auction_id": auction_id, "category": "power"}))
    p1, p2 = str(players[0]["_id"]), str(players[1]["_id"])

    # Player 1: captain A wins at extra=10 (bid 18.5). Remaining budget: 17-10=7.
    client.post(f"/api/admin/auction/{auction_id}/release", json={"player_id": p1}, headers=admin_headers)
    client.post(f"/api/auction/{auction_id}/bid", json={"amount": 18.5}, headers=a_headers)
    client.post(f"/api/auction/{auction_id}/drop", headers=b_headers)

    mid_state = client.get(f"/api/auction/{auction_id}", headers=admin_headers).get_json()
    assert mid_state["captain_a"]["points_remaining"] == 7

    # Player 2: captain A tries to bid extra=10 again (18.5) — only 7 remain,
    # so this must be rejected outright, not silently allowed to overspend.
    client.post(f"/api/admin/auction/{auction_id}/release", json={"player_id": p2}, headers=admin_headers)
    overbid = client.post(f"/api/auction/{auction_id}/bid", json={"amount": 18.5}, headers=a_headers)
    assert overbid.status_code == 400
    assert "remaining" in overbid.get_json()["error"]

    # Bidding exactly the remaining budget (extra=7, bid=15.5) must succeed.
    exact_bid = client.post(f"/api/auction/{auction_id}/bid", json={"amount": 15.5}, headers=a_headers)
    assert exact_bid.status_code == 200
    client.post(f"/api/auction/{auction_id}/drop", headers=b_headers)

    final_state = client.get(f"/api/auction/{auction_id}", headers=admin_headers).get_json()
    assert final_state["captain_a"]["points_remaining"] == 0
    assert final_state["captain_a"]["is_drained"] is True

    # Directly verify against the raw records too: sum of (price - base) across
    # every player this captain actually won must equal exactly 17, never more.
    captain_a_id = str(setup["captain_a"]["_id"])
    sold_to_a = list(mongo.db.auction_players.find({"auction_id": auction_id, "sold_to": captain_a_id}))
    total_extra_spent = sum(p["sold_price"] - 8.5 for p in sold_to_a)
    assert total_extra_spent == 17
    assert len(sold_to_a) == 2
    # And the *total price paid* (base + extra) is naturally higher than 17 —
    # this is expected, not a bug: 8.5 base x 2 players + 17 extra = 34.
    total_price_paid = sum(p["sold_price"] for p in sold_to_a)
    assert total_price_paid == 34.0


def test_bid_rejected_the_instant_it_would_exceed_remaining_budget(
    client, admin_headers, auth_header, make_auction_setup
):
    setup = make_auction_setup([("classic", None, None)] * 4)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers)

    player = mongo.db.auction_players.find_one({"auction_id": auction_id, "category": "classic"})
    client.post(f"/api/admin/auction/{auction_id}/release",
                json={"player_id": str(player["_id"])}, headers=admin_headers)

    # A single bid asking for more than the full 17-point budget as extra
    # (base 8.5 + extra 17.5 = 26) must be rejected outright.
    res = client.post(f"/api/auction/{auction_id}/bid", json={"amount": 26}, headers=a_headers)
    assert res.status_code == 400
    assert "remaining" in res.get_json()["error"]
