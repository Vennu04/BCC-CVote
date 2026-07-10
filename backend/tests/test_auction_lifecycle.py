"""Integration tests against the live HTTP API for the auction rules that only
make sense as a composed flow: creation validation, the category-only release
contract (req #2), the full bid/drop/sell → quota → leftover-award → both-
captains-decline composition (req #1, #7, pre-existing quota logic), bid
validation, free-pick, and post-completion confidentiality (req #9)."""
from bson import ObjectId

from app import mongo


def _create(client, headers, setup):
    return client.post("/api/admin/auction", json={
        "slot_id": setup["slot_id"],
        "captain_a_id": str(setup["captain_a"]["_id"]),
        "captain_b_id": str(setup["captain_b"]["_id"]),
    }, headers=headers)


def _start(client, headers, auction_id):
    return client.post(f"/api/admin/auction/{auction_id}/start", headers=headers)


def _release(client, headers, auction_id, category):
    return client.post(f"/api/admin/auction/{auction_id}/release", json={"category": category}, headers=headers)


def _get(client, headers, auction_id):
    return client.get(f"/api/auction/{auction_id}", headers=headers)


# ── Creation validation ──────────────────────────────────────────────────────

def test_create_auction_requires_an_active_voting_window(client, admin_headers, make_user, make_slot_and_window):
    slot_id, window_id = make_slot_and_window()
    mongo.db.voting_windows.update_one({}, {"$set": {"is_active": False}})
    captain_a = make_user("captain", "CAPA", "capa")
    captain_b = make_user("captain", "CAPB", "capb")

    res = client.post("/api/admin/auction", json={
        "slot_id": slot_id,
        "captain_a_id": str(captain_a["_id"]), "captain_b_id": str(captain_b["_id"]),
    }, headers=admin_headers)
    assert res.status_code == 400
    assert "voting window" in res.get_json()["error"]


def test_create_auction_rejects_odd_category_split(client, admin_headers, make_auction_setup):
    # 3 classic voters can't be split evenly between two captains.
    setup = make_auction_setup([("classic", 10, None)] * 3)
    res = _create(client, admin_headers, setup)
    assert res.status_code == 400
    assert "classic" in res.get_json()["error"]


def test_create_auction_rejects_when_no_one_voted_available(client, admin_headers, make_user, make_slot_and_window):
    slot_id, _ = make_slot_and_window()
    captain_a = make_user("captain", "CAPA", "capa")
    captain_b = make_user("captain", "CAPB", "capb")
    res = client.post("/api/admin/auction", json={
        "slot_id": slot_id,
        "captain_a_id": str(captain_a["_id"]), "captain_b_id": str(captain_b["_id"]),
    }, headers=admin_headers)
    assert res.status_code == 400


# ── Release contract (req #2 — category only, never a specific player) ──────

def test_release_endpoint_only_accepts_a_category_no_player_selection(client, admin_headers, make_auction_setup):
    # 2 meaningful (scored) players + 20 unscored fillers to hit the 22-player
    # minimum — fillers sort after any scored player (see _next_release_candidate),
    # so they can't interfere with the "highest score released first" assertion.
    # classic ranks on (battingAverage - bowlingAverage); bowling_average held
    # equal (10) for both scored players so batting average alone still decides.
    setup = make_auction_setup([("classic", 10, 10), ("classic", 20, 10)] + [("classic", None, None)] * 20)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    bogus_player_id = str(setup["voters"][0]["_id"])
    res = client.post(
        f"/api/admin/auction/{auction_id}/release",
        json={"category": "classic", "player_id": bogus_player_id},  # player_id must be ignored
        headers=admin_headers,
    )
    assert res.status_code == 200
    released = res.get_json()["player_id"]
    # The higher-average player (20) must come first regardless of the
    # (unsupported, ignored) player_id in the request body.
    highest_avg_voter = setup["voters"][1]
    released_doc = mongo.db.auction_players.find_one({"_id": ObjectId(released)})
    assert released_doc["user_id"] == str(highest_avg_voter["_id"])


def test_release_rejects_invalid_category(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    res = client.post(f"/api/admin/auction/{auction_id}/release", json={"category": "not-a-real-category"}, headers=admin_headers)
    assert res.status_code == 400


def test_cannot_release_while_a_player_is_already_up(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    _release(client, admin_headers, auction_id, "classic")
    res = _release(client, admin_headers, auction_id, "classic")
    assert res.status_code == 400


# ── Full composed lifecycle: release order + bid/drop + quota leftover-award ─

def test_full_lifecycle_release_order_bid_sell_and_quota_leftover_award(client, admin_headers, auth_header, make_auction_setup):
    # 4 classic voters, quota = 2 per captain. classic ranks on
    # (battingAverage - bowlingAverage) — bowling_average held equal (10) for
    # all four so the batting average alone still drives a deterministic
    # order: P1(30-10=20) > P2(20-10=10) > P0(10-10=0) > P3(5-10=-5). Padded
    # with 18 "power" fillers (a different category, so classic's own quota
    # of 2 is unaffected) to hit the 22-player pool minimum.
    setup = make_auction_setup([("classic", 10, 10), ("classic", 30, 10),
                                 ("classic", 20, 10), ("classic", 5, 10)]
                                + [("power", None, None)] * 18)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])

    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    # First release must be the highest average (P1, 30).
    r1 = _release(client, admin_headers, auction_id, "classic").get_json()
    p1_doc = mongo.db.auction_players.find_one({"_id": ObjectId(r1["player_id"])})
    assert p1_doc["user_id"] == str(setup["voters"][1]["_id"])

    # Captain A bids the minimum (base 8.5 + 0.5), captain B drops → sold to A.
    client.post(f"/api/auction/{auction_id}/bid", json={"amount": 9.0}, headers=a_headers)
    sell1 = client.post(f"/api/auction/{auction_id}/drop", headers=b_headers)
    assert sell1.get_json()["sold_to"] == str(setup["captain_a"]["_id"])

    # Second release must be the next-highest average (P2, 20).
    r2 = _release(client, admin_headers, auction_id, "classic").get_json()
    p2_doc = mongo.db.auction_players.find_one({"_id": ObjectId(r2["player_id"])})
    assert p2_doc["user_id"] == str(setup["voters"][2]["_id"])

    # Sell it to captain A too — this is A's 2nd classic player, hitting the
    # quota of 2. The remaining two (P0, P3) must instantly free-transfer to B.
    client.post(f"/api/auction/{auction_id}/bid", json={"amount": 9.0}, headers=a_headers)
    client.post(f"/api/auction/{auction_id}/drop", headers=b_headers)

    remaining = list(mongo.db.auction_players.find({"auction_id": auction_id, "category": "classic"}))
    a_count = sum(1 for p in remaining if p["sold_to"] == str(setup["captain_a"]["_id"]))
    b_count = sum(1 for p in remaining if p["sold_to"] == str(setup["captain_b"]["_id"]))
    assert a_count == 2
    assert b_count == 2
    leftover = [p for p in remaining if p["assigned_via"] == "leftover_free"]
    assert len(leftover) == 2
    assert all(p["sold_price"] == 0 for p in leftover)
    assert all(p["sold_to"] == str(setup["captain_b"]["_id"]) for p in leftover)

    # No player should be left "available" — the category is fully resolved.
    still_available = [p for p in remaining if p["status"] == "available"]
    assert still_available == []


def test_both_captains_declining_marks_player_deprioritized_and_held_back(client, admin_headers, auth_header, make_auction_setup):
    # 6-player power category (quota 3) so resolving the other 5 players
    # doesn't hit quota before we can observe deprioritized players being
    # skipped by explicit releases.
    #
    # Note: with an ODD number of non-deprioritized players in a category,
    # the quota-leftover rule always fires on the very last normal sale (pigeon-
    # hole: two captains can't both stay under quota once you've split an odd
    # total between them) — sweeping any remaining deprioritized player before
    # a direct release ever reaches it. So to prove release() *itself* can
    # surface a deprioritized player, this test produces TWO deprioritized
    # players (leaving an EVEN number of normal ones, 4, split 2-2 without
    # tripping quota=3).
    # Padded with 16 "classic" fillers (a different category, so power's own
    # quota of 3 is unaffected) to hit the 22-player pool minimum.
    setup = make_auction_setup([("power", None, None)] * 6 + [("classic", None, None)] * 16)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    def _both_pass():
        release = _release(client, admin_headers, auction_id, "power").get_json()
        client.post(f"/api/auction/{auction_id}/drop", headers=a_headers)
        passed = client.post(f"/api/auction/{auction_id}/drop", headers=b_headers)
        assert "last option" in passed.get_json()["message"]
        return release["player_id"]

    def _sell(to_headers, other_headers):
        release = _release(client, admin_headers, auction_id, "power").get_json()
        client.post(f"/api/auction/{auction_id}/bid", json={"amount": 9.0}, headers=to_headers)
        client.post(f"/api/auction/{auction_id}/drop", headers=other_headers)
        return release["player_id"]

    deprioritized_ids = {_both_pass(), _both_pass()}
    for pid in deprioritized_ids:
        doc = mongo.db.auction_players.find_one({"_id": ObjectId(pid)})
        assert doc["deprioritized"] is True
        assert doc["status"] == "available"  # still up for grabs, just held back

    # Sell all 4 remaining normal players, 2-2, without either captain hitting
    # quota (3) — none of these should ever be a deprioritized player.
    sold_ids = set()
    for to_headers, other_headers in [(a_headers, b_headers), (b_headers, a_headers),
                                       (a_headers, b_headers), (b_headers, a_headers)]:
        pid = _sell(to_headers, other_headers)
        assert pid not in deprioritized_ids
        sold_ids.add(pid)
    assert len(sold_ids) == 4

    # Only the two deprioritized players remain — release must now surface
    # one of them directly (no quota sweep has happened for either captain).
    r_next = _release(client, admin_headers, auction_id, "power").get_json()
    assert r_next["player_id"] in deprioritized_ids


# ── Bid validation ────────────────────────────────────────────────────────────

def test_bid_below_minimum_is_rejected(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    _release(client, admin_headers, auction_id, "classic")

    res = client.post(f"/api/auction/{auction_id}/bid", json={"amount": 8.5}, headers=a_headers)
    assert res.status_code == 400


def test_bid_must_be_in_half_point_increments(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    _release(client, admin_headers, auction_id, "classic")

    res = client.post(f"/api/auction/{auction_id}/bid", json={"amount": 9.3}, headers=a_headers)
    assert res.status_code == 400


def test_captain_cannot_outbid_themselves(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    _release(client, admin_headers, auction_id, "classic")

    client.post(f"/api/auction/{auction_id}/bid", json={"amount": 9.0}, headers=a_headers)
    res = client.post(f"/api/auction/{auction_id}/bid", json={"amount": 9.5}, headers=a_headers)
    assert res.status_code == 400
    assert "highest bid" in res.get_json()["error"]


def test_bidder_with_highest_bid_cannot_drop(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    _release(client, admin_headers, auction_id, "classic")

    client.post(f"/api/auction/{auction_id}/bid", json={"amount": 9.0}, headers=a_headers)
    res = client.post(f"/api/auction/{auction_id}/drop", headers=a_headers)
    assert res.status_code == 400


# ── Free pick ────────────────────────────────────────────────────────────────

def test_free_pick_rejected_while_opponent_still_has_points(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    target = mongo.db.auction_players.find_one({"auction_id": auction_id, "category": "power"})

    res = client.post(f"/api/auction/{auction_id}/free-pick", json={"player_id": str(target["_id"])}, headers=a_headers)
    assert res.status_code == 400
    assert "drained" in res.get_json()["error"]


def test_free_pick_succeeds_once_opponent_is_drained(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    mongo.db.auctions.update_one({"_id": ObjectId(auction_id)}, {"$set": {"points_budget": 0}})
    target = mongo.db.auction_players.find_one({"auction_id": auction_id, "category": "power"})

    res = client.post(f"/api/auction/{auction_id}/free-pick", json={"player_id": str(target["_id"])}, headers=a_headers)
    assert res.status_code == 200
    updated = mongo.db.auction_players.find_one({"_id": target["_id"]})
    assert updated["assigned_via"] == "free_pick"
    assert updated["sold_price"] == 0
    assert updated["sold_to"] == str(setup["captain_a"]["_id"])


# Note: free-pick's category restriction (Power/Classic only) from this
# branch's original design was superseded on main by a fix extending it to
# all 4 categories with a quota cap instead (see
# test_auction_rules_fixes.py::test_free_pick_now_works_for_extra_power_categories_too)
# — that fix is what's kept, so the old restriction is no longer tested here.


# ── Confidentiality after completion (req #9) ────────────────────────────────

def test_completed_auction_hides_prices_and_bid_feed(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 22)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    _release(client, admin_headers, auction_id, "classic")
    client.post(f"/api/auction/{auction_id}/bid", json={"amount": 9.0}, headers=a_headers)
    client.post(f"/api/auction/{auction_id}/drop", headers=b_headers)

    while_active = _get(client, admin_headers, auction_id).get_json()
    assert while_active["captain_a"]["points_remaining"] is not None
    assert any(p["price"] is not None for p in while_active["captain_a"]["roster"])
    assert while_active["bid_feed"] != []

    client.post(f"/api/admin/auction/{auction_id}/close", headers=admin_headers)
    after_close = _get(client, admin_headers, auction_id).get_json()
    assert after_close["status"] == "completed"
    assert after_close["captain_a"]["points_remaining"] is None
    assert after_close["captain_a"]["is_drained"] is None
    assert after_close["bid_feed"] == []
    for team in ("captain_a", "captain_b"):
        for player in after_close[team]["roster"]:
            assert player["price"] is None
            assert player["assigned_via"] is None
            assert player["name"]  # names must still be visible
