"""Regression tests for the live-auction stall on 2026-10-09 (Team Dawat vs
SKY11). With two players in the first category, the first sale fills the
winner's quota, so the second player goes to the other captain for free. A
poll served by the other gunicorn worker put that second player up for
bidding in the few milliseconds between the sale and the hand-over; he was
then given away while still marked as "up for bidding". Bids on him were
rejected, auto-release waited on him forever, and the 30s idle timeout never
fired -- the auction had to be closed and run by hand."""
from datetime import timedelta

from bson import ObjectId

from app import mongo
from app.routes import auction as auction_routes


def _create_and_start(client, admin_headers, setup):
    auction_id = client.post("/api/admin/auction", json={
        "slot_id": setup["slot_id"],
        "captain_a_id": str(setup["captain_a"]["_id"]),
        "captain_b_id": str(setup["captain_b"]["_id"]),
    }, headers=admin_headers).get_json()["auction_id"]
    client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers)
    return auction_id


def _get(client, headers, auction_id):
    return client.get(f"/api/auction/{auction_id}", headers=headers).get_json()


def _pool():
    # Same shape as the real night: 2 in the first category, then the rest.
    return ([("extra_power_allrounder", 40, 10), ("extra_power_allrounder", 30, 10)]
            + [("extra_power_batsman", 20, 10)] * 2 + [("power", 10, 10)] * 10 + [("classic", None, None)] * 6)


def test_a_poll_racing_the_leftover_award_cannot_put_up_a_player_being_given_away(
        client, admin_headers, auth_header, make_auction_setup, monkeypatch):
    setup = make_auction_setup(_pool())
    a_headers, b_headers = auth_header(setup["captain_a"]), auth_header(setup["captain_b"])
    auction_id = _create_and_start(client, admin_headers, setup)

    # Stand-in for the other worker: a poll's auto-release lands at the exact
    # moment the leftover award is about to run.
    real_award = auction_routes._check_leftover_award

    def award_with_a_poll_sneaking_in(auction, group):
        auction_routes._maybe_auto_release_next(str(auction["_id"]))
        return real_award(auction, group)

    monkeypatch.setattr(auction_routes, "_check_leftover_award", award_with_a_poll_sneaking_in)

    client.post(f"/api/auction/{auction_id}/bid", json={"amount": 8.5}, headers=b_headers)
    sold = client.post(f"/api/auction/{auction_id}/drop", headers=a_headers)
    assert sold.get_json()["sold_to"] == str(setup["captain_b"]["_id"])

    state = _get(client, admin_headers, auction_id)
    current = mongo.db.auction_players.find_one({"_id": ObjectId(state["current_player"]["id"])})
    assert current["status"] == "available"
    assert current["category"] == "extra_power_batsman"  # moved on to the next category

    # ...and the auction is genuinely usable: the next player can be bid on.
    bid = client.post(f"/api/auction/{auction_id}/bid", json={"amount": 8.5}, headers=a_headers)
    assert bid.status_code == 200, bid.get_json()

    names = [e["category"] for e in client.get(
        f"/api/auction/{auction_id}/release-log", headers=admin_headers).get_json()["entries"]]
    assert names == ["extra_power_allrounder", "extra_power_batsman"]


def test_an_auction_already_stuck_on_a_given_away_player_heals_on_the_next_poll(
        client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup(_pool())
    a_headers, b_headers = auth_header(setup["captain_a"]), auth_header(setup["captain_b"])
    auction_id = _create_and_start(client, admin_headers, setup)

    # Recreate the exact stuck state from the night: the player who is "up
    # for bidding" has already been handed to a captain for free.
    first = _get(client, admin_headers, auction_id)["current_player"]["id"]
    mongo.db.auction_players.update_one({"_id": ObjectId(first)}, {"$set": {
        "status": "free_assigned", "sold_to": str(setup["captain_a"]["_id"]),
        "sold_price": 0, "assigned_via": "leftover_free",
        "sold_at": auction_routes.utcnow() - timedelta(seconds=30)}})
    mongo.db.auction_bids.insert_one({
        "auction_id": auction_id, "player_id": first, "captain_id": str(setup["captain_a"]["_id"]),
        "action": "leftover_free", "amount": 0, "created_at": auction_routes.utcnow()})

    state = _get(client, a_headers, auction_id)  # any ordinary poll, from anyone
    assert state["current_player"]["id"] != first
    current = mongo.db.auction_players.find_one({"_id": ObjectId(state["current_player"]["id"])})
    assert current["status"] == "available"
    bid = client.post(f"/api/auction/{auction_id}/bid", json={"amount": 8.5}, headers=b_headers)
    assert bid.status_code == 200, bid.get_json()


def test_a_live_current_player_is_never_cleared_by_the_safety_net(
        client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup(_pool())
    auction_id = _create_and_start(client, admin_headers, setup)
    first = _get(client, admin_headers, auction_id)["current_player"]["id"]
    for _ in range(5):
        assert _get(client, admin_headers, auction_id)["current_player"]["id"] == first
    assert mongo.db.auction_release_log.count_documents({"auction_id": auction_id}) == 1
