"""Admin proxy bid/drop — for captains who bid out loud / over chat instead
of operating the bidding UI themselves. Admin records the action on a named
captain's behalf via /admin/auction/<id>/proxy-bid and /proxy-drop, which
must enforce every rule a real captain click would (quota, remaining points,
must-be-higher-than-last-bid) since they share _bid_core/_drop_core with the
captain-facing endpoints — not a parallel, potentially-drifting rule set."""
from bson import ObjectId

from app import mongo


def _create(client, headers, setup):
    return client.post("/api/admin/auction", json={
        "slot_id": setup["slot_id"],
        "captain_a_id": str(setup["captain_a"]["_id"]),
        "captain_b_id": str(setup["captain_b"]["_id"]),
    }, headers=headers)


def _start(client, admin_headers, auction_id):
    return client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers)


def test_proxy_bid_happy_path_records_bid_and_logs_chat_note(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 22)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    captain_a_id = str(setup["captain_a"]["_id"])

    res = client.post(
        f"/api/admin/auction/{auction_id}/proxy-bid",
        json={"captain_id": captain_a_id, "amount": 12.5},
        headers=admin_headers,
    )
    assert res.status_code == 200
    assert res.get_json()["amount"] == 12.5

    state = client.get(f"/api/auction/{auction_id}", headers=admin_headers).get_json()
    assert state["current_player"]["current_high_bid"] == 12.5
    assert state["current_player"]["current_high_bidder"] == "Captain A"

    # A confirming note lands in the shared chat both captains watch.
    assert any("Captain A bids 12.5" in m["message"] for m in state["chat_feed"])
    assert any(m["sender_role"] == "admin" for m in state["chat_feed"])


def test_proxy_drop_awards_sale_to_the_other_captain(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 22)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    captain_a_id = str(setup["captain_a"]["_id"])
    captain_b_id = str(setup["captain_b"]["_id"])

    client.post(
        f"/api/admin/auction/{auction_id}/proxy-bid",
        json={"captain_id": captain_a_id, "amount": 11.0},
        headers=admin_headers,
    )
    res = client.post(
        f"/api/admin/auction/{auction_id}/proxy-drop",
        json={"captain_id": captain_b_id},
        headers=admin_headers,
    )
    assert res.status_code == 200
    assert res.get_json()["sold_to"] == captain_a_id
    assert res.get_json()["sold_price"] == 11.0

    state = client.get(f"/api/auction/{auction_id}", headers=admin_headers).get_json()
    assert state["captain_a"]["roster_count"] == 1
    assert any("Captain B drops" in m["message"] for m in state["chat_feed"])


def test_proxy_bid_rejects_captain_over_their_quota(client, admin_headers, make_auction_setup):
    # In normal play, _check_leftover_award transfers every remaining player
    # in a category the instant a captain hits quota, so there's never a
    # legitimate moment where an "available" player sits in a category a
    # captain is already at/over quota for -- this is purely a defensive
    # check. Construct that (otherwise-unreachable) state directly so the
    # guard itself is proven, the same way the rest of this suite treats
    # _bid_core as a unit worth testing directly, not just through the happy
    # path that's designed to never hit it.
    setup = make_auction_setup([("classic", None, None)] * 22)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    captain_a_id = str(setup["captain_a"]["_id"])

    # Quota=1 power category: one already sold to captain A (at quota),
    # one still "available" and force-set as the current player up for bid.
    mongo.db.auction_players.insert_one({
        "auction_id": auction_id, "user_id": "not-a-real-user-1", "category": "power",
        "status": "sold", "sold_to": captain_a_id, "sold_price": 8.5,
        "assigned_via": "bid", "deprioritized": False,
    })
    extra_player_id = mongo.db.auction_players.insert_one({
        "auction_id": auction_id, "user_id": "not-a-real-user-2", "category": "power",
        "status": "available", "deprioritized": False,
    }).inserted_id
    mongo.db.auctions.update_one(
        {"_id": ObjectId(auction_id)},
        {"$set": {"current_player_id": str(extra_player_id)}},
    )

    res = client.post(
        f"/api/admin/auction/{auction_id}/proxy-bid",
        json={"captain_id": captain_a_id, "amount": 10},
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "quota" in res.get_json()["error"]


def test_proxy_bid_rejects_amount_beyond_remaining_points(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    captain_a_id = str(setup["captain_a"]["_id"])

    res = client.post(
        f"/api/admin/auction/{auction_id}/proxy-bid",
        json={"captain_id": captain_a_id, "amount": 26},
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "remaining" in res.get_json()["error"]


def test_proxy_bid_rejects_unknown_captain_id(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    res = client.post(
        f"/api/admin/auction/{auction_id}/proxy-bid",
        json={"captain_id": "not-a-real-captain", "amount": 10},
        headers=admin_headers,
    )
    assert res.status_code == 400
    assert "captain_id" in res.get_json()["error"]


def test_proxy_endpoints_reject_non_admin_callers(client, auth_header, make_auction_setup, admin_headers):
    setup = make_auction_setup([("classic", None, None)] * 22)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    captain_a_id = str(setup["captain_a"]["_id"])
    a_headers = auth_header(setup["captain_a"])

    res = client.post(
        f"/api/admin/auction/{auction_id}/proxy-bid",
        json={"captain_id": captain_a_id, "amount": 10},
        headers=a_headers,
    )
    assert res.status_code == 403
