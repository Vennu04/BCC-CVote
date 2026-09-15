"""If a released player sits with NEITHER captain placing a single bid NOR a
single drop for PLAYER_RELEASE_TIMEOUT_SECONDS, they're auto-dropped the same
way an explicit mutual pass already works: stays "available", deprioritized
(held to the bottom of their category's release queue), and the auction
auto-advances to the next player -- see _maybe_timeout_current_player in
app/routes/auction.py.

Checked lazily from GET /auction/<id>, same pattern as the existing 25-minute
whole-session timeout (_apply_timeout_fallback) -- these tests simulate
elapsed time the same way that feature's own tests do: backdating the
relevant timestamp directly in Mongo rather than actually sleeping."""
from bson import ObjectId
from datetime import timedelta

from app import mongo
from app.routes.auction import PLAYER_RELEASE_TIMEOUT_SECONDS
from app.utils.time_utils import utcnow


def _create(client, headers, setup):
    return client.post("/api/admin/auction", json={
        "slot_id": setup["slot_id"],
        "captain_a_id": str(setup["captain_a"]["_id"]),
        "captain_b_id": str(setup["captain_b"]["_id"]),
    }, headers=headers)


def _start(client, headers, auction_id):
    return client.post(f"/api/admin/auction/{auction_id}/start", headers=headers)


def _get(client, headers, auction_id):
    return client.get(f"/api/auction/{auction_id}", headers=headers)


def _expire_current_release(auction_id, seconds_ago=None):
    """Backdates current_player_released_at past the timeout threshold --
    the same technique test_whole_auction_timeout_takes_precedence_over_
    pending_auto_release uses for ends_at."""
    seconds_ago = seconds_ago or (PLAYER_RELEASE_TIMEOUT_SECONDS + 5)
    mongo.db.auctions.update_one(
        {"_id": ObjectId(auction_id)},
        {"$set": {"current_player_released_at": utcnow() - timedelta(seconds=seconds_ago)}},
    )


def test_no_activity_past_the_timeout_auto_drops_and_advances(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 20)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)  # auto-releases the first player

    before = _get(client, admin_headers, auction_id).get_json()
    first_player_id = before["current_player"]["id"]
    assert before["current_player"]["deprioritized"] is False

    _expire_current_release(auction_id)
    after = _get(client, admin_headers, auction_id).get_json()

    assert after["current_player"] is not None
    assert after["current_player"]["id"] != first_player_id

    first_player_doc = mongo.db.auction_players.find_one({"_id": ObjectId(first_player_id)})
    assert first_player_doc["status"] == "available"
    assert first_player_doc["deprioritized"] is True


def test_timeout_does_not_fire_before_the_threshold(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 20)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    before = _get(client, admin_headers, auction_id).get_json()
    first_player_id = before["current_player"]["id"]

    _expire_current_release(auction_id, seconds_ago=PLAYER_RELEASE_TIMEOUT_SECONDS - 5)
    after = _get(client, admin_headers, auction_id).get_json()

    assert after["current_player"]["id"] == first_player_id
    assert after["current_player"]["deprioritized"] is False


def test_a_single_bid_prevents_the_timeout(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 20)
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    before = _get(client, admin_headers, auction_id).get_json()
    first_player_id = before["current_player"]["id"]

    _expire_current_release(auction_id)
    # Placed AFTER the backdated released_at, so it's real activity "this round".
    bid = client.post(f"/api/auction/{auction_id}/bid", json={"amount": 8.5}, headers=a_headers)
    assert bid.status_code == 200

    after = _get(client, admin_headers, auction_id).get_json()
    assert after["current_player"]["id"] == first_player_id
    assert after["current_player"]["deprioritized"] is False


def test_a_single_drop_from_one_captain_prevents_the_timeout(client, admin_headers, auth_header, make_auction_setup):
    # A lone drop with the other captain silent is a different, already-
    # handled case (see _drop_core) -- the timeout must leave it alone, not
    # treat "one side acted" the same as "neither side acted".
    setup = make_auction_setup([("power", None, None)] * 20)
    a_headers = auth_header(setup["captain_a"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    before = _get(client, admin_headers, auction_id).get_json()
    first_player_id = before["current_player"]["id"]

    _expire_current_release(auction_id)
    drop = client.post(f"/api/auction/{auction_id}/drop", headers=a_headers)
    assert drop.status_code == 200
    assert drop.get_json()["message"] == "Dropped"

    after = _get(client, admin_headers, auction_id).get_json()
    assert after["current_player"]["id"] == first_player_id
    assert after["current_player"]["deprioritized"] is False


# A timed-out player queuing "at the bottom of the category" is the exact
# same held-back-until-last behavior _next_release_candidate already gives
# any deprioritized player, regardless of how that flag got set -- already
# proven generically by test_release_order.py's own
# test_deprioritized_players_are_held_back_to_the_end_of_the_queue. Trying
# to re-prove it here end-to-end over HTTP hits an unrelated wrinkle instead
# (quota filling and leftover-award sweeping the remaining pool before the
# timed-out player's individual turn comes back around, in a 20-player/
# quota-10 pool) -- not a bug, just the wrong tool for what's already
# covered elsewhere. test_no_activity_past_the_timeout_auto_drops_and_
# advances above is what actually needs proving here: that a timeout sets
# deprioritized=True in the first place.


def test_timeout_respects_a_paused_auction(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 20)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    first_player_id = _get(client, admin_headers, auction_id).get_json()["current_player"]["id"]
    client.post(f"/api/admin/auction/{auction_id}/pause", headers=admin_headers)
    _expire_current_release(auction_id)

    after = _get(client, admin_headers, auction_id).get_json()
    assert after["current_player"]["id"] == first_player_id
    assert after["current_player"]["deprioritized"] is False


def test_timeout_writes_a_system_attributed_bid_feed_entry(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 20)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    first_player_id = _get(client, admin_headers, auction_id).get_json()["current_player"]["id"]
    _expire_current_release(auction_id)
    state = _get(client, admin_headers, auction_id).get_json()

    entries = [b for b in state["bid_feed"] if b["action"] == "timeout_drop"]
    assert len(entries) == 1
    assert entries[0]["captain_name"] == "Auto-drop"
    assert entries[0]["player_name"] == "Player0"

    bid_doc = mongo.db.auction_bids.find_one({"auction_id": auction_id, "action": "timeout_drop"})
    assert bid_doc["player_id"] == first_player_id
    assert bid_doc["captain_id"] is None
