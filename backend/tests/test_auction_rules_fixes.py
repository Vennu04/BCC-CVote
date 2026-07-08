"""Live-prod bug reports / requested fixes covered here:
1. Both captains passing at base price should hold the player back as a
   "last chance" for admin to release again, not just silently return it to
   the pool at the same priority as everyone else.
2. free_pick had no quota cap, unlike normal bidding — a solvent captain
   could take unlimited players once the opponent was drained, instead of
   just their fair share within quota.
3. free_pick now covers all 4 categories (previously Power/Classic only) —
   once the opponent is drained they can't bid on ANY category, so the same
   free-claim mechanic should apply everywhere, not just two of the four."""
from bson import ObjectId

from app import mongo


def _create(client, headers, setup):
    return client.post("/api/admin/auction", json={
        "slot_id": setup["slot_id"],
        "captain_a_id": str(setup["captain_a"]["_id"]),
        "captain_b_id": str(setup["captain_b"]["_id"]),
    }, headers=headers)


def test_both_captains_passing_marks_player_deprioritized(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers)

    player = mongo.db.auction_players.find_one({"auction_id": auction_id, "category": "classic"})
    client.post(f"/api/admin/auction/{auction_id}/release",
                json={"player_id": str(player["_id"])}, headers=admin_headers)

    client.post(f"/api/auction/{auction_id}/drop", headers=a_headers)
    res = client.post(f"/api/auction/{auction_id}/drop", headers=b_headers)
    assert "last option" in res.get_json()["message"]

    updated = mongo.db.auction_players.find_one({"_id": player["_id"]})
    assert updated["deprioritized"] is True
    assert updated["status"] == "available"  # still releasable, just held back


def test_deprioritized_player_sorts_last_in_available_players(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers)

    players = list(mongo.db.auction_players.find({"auction_id": auction_id, "category": "classic"}))
    first_player_id = str(players[0]["_id"])

    client.post(f"/api/admin/auction/{auction_id}/release",
                json={"player_id": first_player_id}, headers=admin_headers)
    client.post(f"/api/auction/{auction_id}/drop", headers=a_headers)
    client.post(f"/api/auction/{auction_id}/drop", headers=b_headers)

    state = client.get(f"/api/auction/{auction_id}", headers=admin_headers).get_json()
    available = state["available_players"]
    assert available[-1]["id"] == first_player_id
    assert available[-1]["deprioritized"] is True
    assert all(not p["deprioritized"] for p in available[:-1])


def test_free_pick_rejects_a_direct_over_quota_attempt(client, admin_headers, auth_header, make_auction_setup):
    # _check_leftover_award already sweeps every remaining player in a category
    # to the other captain the instant quota is hit (via bid OR free-pick), so
    # a captain can never *organically* reach "count >= quota with a player
    # still available" through sequential play alone — the sweep always beats
    # them to it. The quota check added to free_pick is still real defense in
    # depth (e.g. two near-simultaneous free-pick requests racing each other),
    # so this constructs that boundary state directly rather than relying on
    # the sequential API flow to reach it organically.
    setup = make_auction_setup([("power", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers)
    mongo.db.auctions.update_one({"_id": ObjectId(auction_id)}, {"$set": {"points_budget": 0}})

    players = list(mongo.db.auction_players.find({"auction_id": auction_id, "category": "power"}))
    captain_a_id = str(setup["captain_a"]["_id"])
    quota = len(players) // 2

    # Directly put captain A at quota without going through the sweep.
    for p in players[:quota]:
        mongo.db.auction_players.update_one(
            {"_id": p["_id"]},
            {"$set": {"status": "free_assigned", "sold_to": captain_a_id, "sold_price": 0, "assigned_via": "free_pick"}},
        )

    # One more free-pick attempt, now over quota, must be rejected outright —
    # this is the exact case that had no cap before the fix.
    over_quota_player = players[quota]
    res = client.post(f"/api/auction/{auction_id}/free-pick",
                       json={"player_id": str(over_quota_player["_id"])}, headers=a_headers)
    assert res.status_code == 400
    assert "quota" in res.get_json()["error"]

    # And that player must still be untouched — the rejected attempt must
    # not have gone through.
    untouched = mongo.db.auction_players.find_one({"_id": over_quota_player["_id"]})
    assert untouched["status"] == "available"
    assert untouched["sold_to"] is None


def test_free_pick_leftover_award_still_works_when_quota_hit_via_free_pick(
    client, admin_headers, auth_header, make_auction_setup
):
    # 22-player pool, quota = 11 — confirms the pre-existing leftover-award
    # sweep (unrelated to this fix) still correctly transfers the rest to the
    # other captain once quota is hit exactly via free-picks, not just bids.
    setup = make_auction_setup([("power", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers)
    mongo.db.auctions.update_one({"_id": ObjectId(auction_id)}, {"$set": {"points_budget": 0}})

    players = list(mongo.db.auction_players.find({"auction_id": auction_id, "category": "power"}))
    quota = len(players) // 2
    for p in players[:quota]:
        res = client.post(f"/api/auction/{auction_id}/free-pick",
                           json={"player_id": str(p["_id"])}, headers=a_headers)
        assert res.status_code == 200

    remaining_available = mongo.db.auction_players.find_one(
        {"auction_id": auction_id, "category": "power", "status": "available"}
    )
    assert remaining_available is None  # swept to captain B by leftover-award

    a_count = mongo.db.auction_players.count_documents(
        {"auction_id": auction_id, "category": "power", "sold_to": str(setup["captain_a"]["_id"])}
    )
    assert a_count == quota


def test_free_pick_now_works_for_extra_power_categories_too(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("extra_power_allrounder", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    client.post(f"/api/admin/auction/{auction_id}/start", headers=admin_headers)
    mongo.db.auctions.update_one({"_id": ObjectId(auction_id)}, {"$set": {"points_budget": 0}})

    player = mongo.db.auction_players.find_one({"auction_id": auction_id, "category": "extra_power_allrounder"})
    res = client.post(f"/api/auction/{auction_id}/free-pick",
                       json={"player_id": str(player["_id"])}, headers=a_headers)
    assert res.status_code == 200

    updated = mongo.db.auction_players.find_one({"_id": player["_id"]})
    assert updated["assigned_via"] == "free_pick"
    assert updated["sold_to"] == str(setup["captain_a"]["_id"])
