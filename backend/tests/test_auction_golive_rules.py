"""Go-live checklist items for the auction feature:
1. An admin linked to one of the two chosen captains (conflict of interest)
   cannot create that auction — someone else from the admin team must.
2. Auction creation rejects pools that would give either side more than 15
   players — orthogonal to the unchanged 17-point-per-captain budget.
3. Auction creation requires at least 22 total voters (11 a side).
4. A captain can drop/pass a player at the base price (no bid placed at all
   yet) in any category, not just some — already-working behavior, tested
   explicitly here as a go-live regression guard."""
from bson import ObjectId

from app import mongo


def _create(client, headers, setup):
    return client.post("/api/admin/auction", json={
        "slot_id": setup["slot_id"],
        "captain_a_id": str(setup["captain_a"]["_id"]),
        "captain_b_id": str(setup["captain_b"]["_id"]),
    }, headers=headers)


def test_admin_linked_to_a_chosen_captain_cannot_create_the_auction(
    client, make_user, auth_header, make_auction_setup
):
    setup = make_auction_setup([("classic", None, None)] * 22)
    linked_admin = make_user(
        "admin", "LINKEDADMIN", "pw", linked_captain_id=str(setup["captain_a"]["_id"])
    )
    res = _create(client, auth_header(linked_admin), setup)
    assert res.status_code == 403
    assert "someone else" in res.get_json()["error"].lower()


def test_admin_linked_to_an_unrelated_captain_can_still_create_it(
    client, make_user, auth_header, make_auction_setup
):
    setup = make_auction_setup([("classic", None, None)] * 22)
    unrelated_captain = make_user("captain", "OTHERCAP", "pw")
    linked_admin = make_user(
        "admin", "LINKEDADMIN2", "pw", linked_captain_id=str(unrelated_captain["_id"])
    )
    res = _create(client, auth_header(linked_admin), setup)
    assert res.status_code == 201


def test_plain_admin_with_no_link_is_unaffected(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    res = _create(client, admin_headers, setup)
    assert res.status_code == 201


def test_auction_rejects_pool_giving_either_side_more_than_15_players(
    client, admin_headers, make_auction_setup
):
    # 32 classic players -> quota 16 per side, one over the 15 cap.
    setup = make_auction_setup([("classic", None, None)] * 32)
    res = _create(client, admin_headers, setup)
    assert res.status_code == 400
    assert "15" in res.get_json()["error"]


def test_auction_allows_exactly_15_players_per_side(client, admin_headers, make_auction_setup):
    # 30 classic players -> quota 15 per side, right at the cap.
    setup = make_auction_setup([("classic", None, None)] * 30)
    res = _create(client, admin_headers, setup)
    assert res.status_code == 201
    assert res.get_json()["group_counts"]["classic"] == 30


def test_auction_rejects_pool_smaller_than_22(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 20)
    res = _create(client, admin_headers, setup)
    assert res.status_code == 400
    assert "22" in res.get_json()["error"]


def test_auction_allows_exactly_22_players(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    res = _create(client, admin_headers, setup)
    assert res.status_code == 201


def test_captain_can_drop_at_base_price_with_no_bid_in_any_category(
    client, admin_headers, auth_header, make_auction_setup
):
    setup = make_auction_setup([
        ("extra_power_allrounder", None, None), ("extra_power_allrounder", None, None),
        ("extra_power_batsman", None, None), ("extra_power_batsman", None, None),
        ("power", None, None), ("power", None, None),
        ("classic", None, None), ("classic", None, None),
    ] + [("classic", None, None)] * 14)  # pad to hit the 22-player minimum
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers)  # auto-releases extra_power_allrounder's first player
    # Full manual control for the rest of this loop -- auto-release would
    # otherwise keep claiming whatever's next the instant each slot frees up,
    # fighting the loop's own explicit per-category /release calls below.
    client.post(f"/api/admin/auction/{auction_id}/pause", headers=admin_headers)

    for i, category in enumerate(("extra_power_allrounder", "extra_power_batsman", "power", "classic")):
        if i > 0:  # Start's own auto-release already covers the first category
            client.post(f"/api/admin/auction/{auction_id}/release",
                        json={"category": category}, headers=admin_headers)
        # No bid placed at all — straight to drop, at the 8.5 base price.
        res = client.post(f"/api/auction/{auction_id}/drop", headers=a_headers)
        assert res.status_code == 200
        assert res.get_json()["message"] == "Dropped"
        # A lone single-captain drop with no bid never resolves the player by
        # itself (both captains have to act for that) -- free the slot
        # directly so the next loop iteration can release a fresh category.
        # This test is only about the "Dropped" response itself, not the
        # full both-captains-pass resolution flow (covered elsewhere).
        mongo.db.auctions.update_one({"_id": ObjectId(auction_id)}, {"$set": {"current_player_id": None}})
