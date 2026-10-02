"""All tools › Settings — admins edit the auction rules without a new build."""
from app import mongo


def _create(client, headers, setup):
    return client.post("/api/admin/auction", headers=headers, json={
        "slot_id": setup["slot_id"],
        "captain_a_id": str(setup["captain_a"]["_id"]),
        "captain_b_id": str(setup["captain_b"]["_id"]),
    })


def test_defaults_then_edit_and_new_auction_uses_them(client, admin_headers, make_auction_setup):
    rules = client.get("/api/settings/auction-rules", headers=admin_headers).get_json()["rules"]
    assert rules == {"points_budget": 17, "starting_price": 8.5, "session_minutes": 25,
                     "release_timeout_seconds": 30, "min_pool_size": 20, "max_per_side": 14}

    res = client.put("/api/admin/settings/auction-rules", headers=admin_headers,
                     json={"points_budget": 20, "starting_price": 9, "min_pool_size": 22, "session_minutes": 30})
    assert res.status_code == 200

    # 22 players clears the new minimum; auction carries the new purse/base.
    setup = make_auction_setup([("classic", None, None)] * 22)
    res = _create(client, admin_headers, setup)
    assert res.status_code == 201, res.get_json()
    auction_id = res.get_json()["auction_id"]
    auction = mongo.db.auctions.find_one({})
    assert auction["points_budget"] == 20 and auction["starting_price"] == 9

    # Starting copies the clock; a later rule change doesn't touch it.
    assert client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers).status_code == 200
    client.put("/api/admin/settings/auction-rules", headers=admin_headers, json={"session_minutes": 40})
    body = client.get(f"/api/auction/{auction_id}", headers=admin_headers).get_json()
    assert body["session_minutes"] == 30


def test_pool_smaller_than_the_new_minimum_is_refused(client, admin_headers, make_auction_setup):
    client.put("/api/admin/settings/auction-rules", headers=admin_headers, json={"min_pool_size": 24})
    setup = make_auction_setup([("classic", None, None)] * 22)
    res = _create(client, admin_headers, setup)
    assert res.status_code == 400 and "24" in res.get_json()["error"]


def test_bad_values_and_non_admins_are_refused(client, admin_headers, auth_header, make_user):
    for body in ({"points_budget": 0}, {"session_minutes": 2.5}, {"bogus": 1}, {"points_budget": "x"},
                 {"min_pool_size": 40, "max_per_side": 10}):
        assert client.put("/api/admin/settings/auction-rules", headers=admin_headers, json=body).status_code == 400
    p = make_user("player", "PLR", "pw")
    assert client.put("/api/admin/settings/auction-rules", headers=auth_header(p), json={"points_budget": 5}).status_code == 403
    assert client.get("/api/settings/auction-rules", headers=auth_header(p)).status_code == 200
