"""Integration tests against the live HTTP API for auto-release: admin
manually releases the first player of a category, then the system advances
through that category's remaining players on its own once each one's
bidding resolves (sold or unsold) -- until the category runs out, at which
point admin must manually pick the next category (see release_player's and
_maybe_auto_release_next's docstrings in app/routes/auction.py). Also covers
the computed auction.is_complete signal and the concurrency-safety (CAS)
guarantee behind both.

Budget/quota edge cases (spec section 4) are regression tests only --
free_pick()/_check_leftover_award() already implement single-captain
drain and per-category quota completion; nothing new was built for them
here, this just confirms they still work under the auto-release flow."""
from bson import ObjectId
from datetime import datetime, timedelta

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


def _pause(client, headers, auction_id):
    return client.post(f"/api/admin/auction/{auction_id}/pause", headers=headers)


def _resume(client, headers, auction_id):
    return client.post(f"/api/admin/auction/{auction_id}/resume", headers=headers)


def _get(client, headers, auction_id):
    return client.get(f"/api/auction/{auction_id}", headers=headers)


def _sell(client, auction_id, to_headers, other_headers, amount=9.0):
    """Resolve the current player as sold: to_headers bids, other_headers drops."""
    client.post(f"/api/auction/{auction_id}/bid", json={"amount": amount}, headers=to_headers)
    return client.post(f"/api/auction/{auction_id}/drop", headers=other_headers)


def _both_pass(client, auction_id, a_headers, b_headers):
    """Resolve the current player as unsold: both captains drop with no bids."""
    client.post(f"/api/auction/{auction_id}/drop", headers=a_headers)
    return client.post(f"/api/auction/{auction_id}/drop", headers=b_headers)


# ── 1. First release still requires a manual admin click ────────────────────

def test_first_player_release_still_requires_manual_admin_action(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 20)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    state = _get(client, admin_headers, auction_id).get_json()
    assert state["current_player"] is None
    assert state["auto_release_category"] is None


# ── 2/3. Auto-release fires after sold and after unsold ──────────────────────

def test_auto_release_fires_after_player_resolves_as_sold(client, admin_headers, auth_header, make_auction_setup):
    # 4 power players so quota (4 // 2 = 2) isn't hit by the first sale --
    # otherwise leftover-award would sweep P2 immediately and auto-release
    # would never get a chance to hand it to admin as a real current_player.
    # Ranks on (battingAverage - bowlingAverage); bowling held equal (10) so
    # batting alone decides: P1(40)>P2(30)>P3(20)>P4(10).
    setup = make_auction_setup(
        [("power", 40, 10), ("power", 30, 10), ("power", 20, 10), ("power", 10, 10)]
        + [("classic", None, None)] * 16
    )
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    r1 = _release(client, admin_headers, auction_id, "power").get_json()
    p1_doc = mongo.db.auction_players.find_one({"_id": ObjectId(r1["player_id"])})
    assert p1_doc["user_id"] == str(setup["voters"][0]["_id"])

    sell1 = _sell(client, auction_id, a_headers, b_headers)
    assert sell1.get_json()["sold_to"] == str(setup["captain_a"]["_id"])

    # No second /release call -- auto-release must have already brought P2 up.
    state = _get(client, admin_headers, auction_id).get_json()
    assert state["current_player"] is not None
    p2_doc = mongo.db.auction_players.find_one({"_id": ObjectId(state["current_player"]["id"])})
    assert p2_doc["user_id"] == str(setup["voters"][1]["_id"])

    log = client.get(f"/api/auction/{auction_id}/release-log", headers=admin_headers).get_json()
    assert len(log["entries"]) == 2


def test_auto_release_fires_after_player_resolves_as_unsold_no_bids(client, admin_headers, auth_header, make_auction_setup):
    # Even count required (create_auction rejects odd category splits).
    # P1(40)>P2(30)>P3(20)>P4(10), bowling held equal (10).
    setup = make_auction_setup(
        [("power", 40, 10), ("power", 30, 10), ("power", 20, 10), ("power", 10, 10)]
        + [("classic", None, None)] * 16
    )
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    r1 = _release(client, admin_headers, auction_id, "power").get_json()
    p1_doc = mongo.db.auction_players.find_one({"_id": ObjectId(r1["player_id"])})
    assert p1_doc["user_id"] == str(setup["voters"][0]["_id"])

    passed = _both_pass(client, auction_id, a_headers, b_headers)
    assert "last option" in passed.get_json()["message"]
    assert mongo.db.auction_players.find_one({"_id": p1_doc["_id"]})["deprioritized"] is True

    # Auto-release must surface P2 next, NOT re-offer the just-deprioritized P1.
    state = _get(client, admin_headers, auction_id).get_json()
    assert state["current_player"] is not None
    p2_doc = mongo.db.auction_players.find_one({"_id": ObjectId(state["current_player"]["id"])})
    assert p2_doc["user_id"] == str(setup["voters"][1]["_id"])


# ── 4. Auto-release never jumps categories ───────────────────────────────────

def test_auto_release_never_jumps_categories(client, admin_headers, auth_header, make_auction_setup):
    # 4 players per category (quota 2) so power doesn't fully resolve on the
    # very first sale -- gives auto-release real room to chain within it.
    setup = make_auction_setup(
        [("power", None, None)] * 4 + [("classic", None, None)] * 4
        + [("extra_power_allrounder", None, None)] * 12
    )
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    _release(client, admin_headers, auction_id, "power")
    _sell(client, auction_id, a_headers, b_headers)

    # Power's 2nd player must come up next -- classic must NOT auto-start
    # even though it also has players waiting.
    state = _get(client, admin_headers, auction_id).get_json()
    assert state["current_player"]["category"] == "power"
    assert state["auto_release_category"] == "power"

    # Fully resolve power (alternating sells; the 3rd sale hits quota=2 and
    # leftover-awards the 4th automatically) -- the chain must stop there,
    # not spill into classic.
    headers_cycle = [(b_headers, a_headers), (a_headers, b_headers)]
    for i in range(3):
        remaining = mongo.db.auction_players.count_documents(
            {"auction_id": auction_id, "category": "power", "status": "available"}
        )
        if remaining == 0:
            break
        to_headers, other_headers = headers_cycle[i % 2]
        _sell(client, auction_id, to_headers, other_headers)

    final_state = _get(client, admin_headers, auction_id).get_json()
    assert final_state["current_player"] is None
    assert final_state["auto_release_category"] is None
    # classic's players are still sitting untouched, available.
    classic_available = mongo.db.auction_players.count_documents(
        {"auction_id": auction_id, "category": "classic", "status": "available"}
    )
    assert classic_available == 4


# ── 5. Whole-auction timeout takes precedence over pending auto-release ─────

def test_whole_auction_timeout_takes_precedence_over_pending_auto_release(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 20)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)
    _release(client, admin_headers, auction_id, "power")

    log_before = client.get(f"/api/auction/{auction_id}/release-log", headers=admin_headers).get_json()
    assert len(log_before["entries"]) == 1

    # Force the whole-session timer into the past directly -- same technique
    # as _apply_timeout_fallback expects (naive UTC datetime on ends_at).
    mongo.db.auctions.update_one(
        {"_id": ObjectId(auction_id)},
        {"$set": {"ends_at": datetime.utcnow() - timedelta(minutes=1)}},
    )

    state = _get(client, admin_headers, auction_id).get_json()
    assert state["status"] == "completed"
    assert state["current_player"] is None

    # Auto-release must not have sneaked in one more release in this same request.
    log_after = client.get(f"/api/auction/{auction_id}/release-log", headers=admin_headers).get_json()
    assert len(log_after["entries"]) == 1


# ── 6. Manual pause halts auto-release; resume continues it ─────────────────

def test_admin_pause_halts_auto_release_and_resume_continues_it(client, admin_headers, auth_header, make_auction_setup):
    # 4 players (quota 2) so selling P1 doesn't fully resolve the category
    # via leftover-award -- P2 must genuinely still be waiting to be
    # auto-released once resumed.
    setup = make_auction_setup(
        [("power", 40, 10), ("power", 30, 10), ("power", 20, 10), ("power", 10, 10)]
        + [("classic", None, None)] * 16
    )
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    _release(client, admin_headers, auction_id, "power")
    assert _pause(client, admin_headers, auction_id).status_code == 200
    _sell(client, auction_id, a_headers, b_headers)

    # Paused: current_player must stay None across several polls, not advance.
    for _ in range(3):
        state = _get(client, admin_headers, auction_id).get_json()
        assert state["current_player"] is None
        assert state["is_paused"] is True

    resume_res = _resume(client, admin_headers, auction_id)
    assert resume_res.status_code == 200
    state = _get(client, admin_headers, auction_id).get_json()
    assert state["is_paused"] is False
    assert state["current_player"] is not None
    p2_doc = mongo.db.auction_players.find_one({"_id": ObjectId(state["current_player"]["id"])})
    assert p2_doc["user_id"] == str(setup["voters"][1]["_id"])


# ── 7/8. Completion signal: not until BOTH captains are fully done, once ────

def test_no_completion_signal_while_one_captain_finishes_early(client, admin_headers, auth_header, make_auction_setup):
    # "power" has just 2 players (quota 1) -- one sale fully resolves it via
    # instant leftover-award. "classic" has 2 untouched players left over.
    # Filler uses a THIRD distinct category so it doesn't inflate power's own
    # count and push its quota above 1.
    setup = make_auction_setup(
        [("power", None, None)] * 2 + [("classic", None, None)] * 2
        + [("extra_power_allrounder", None, None)] * 16
    )
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    _release(client, admin_headers, auction_id, "power")
    _sell(client, auction_id, a_headers, b_headers)

    power_available = mongo.db.auction_players.count_documents(
        {"auction_id": auction_id, "category": "power", "status": "available"}
    )
    assert power_available == 0  # power fully resolved (sale + leftover-award)

    state = _get(client, admin_headers, auction_id).get_json()
    assert state["is_complete"] is False  # classic still has players waiting


def test_completion_signal_fires_and_stays_stable_when_both_captains_finish(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 2 + [("classic", None, None)] * 18)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    _release(client, admin_headers, auction_id, "power")
    _sell(client, auction_id, a_headers, b_headers)  # 1 sold, 1 leftover-awarded -> power empty
    _release(client, admin_headers, auction_id, "classic")
    # Resolve all 18 classic players via alternating sells so nobody hits
    # quota (9) before the pool's naturally exhausted, then check stability.
    headers_cycle = [(a_headers, b_headers), (b_headers, a_headers)]
    for i in range(18):
        remaining = mongo.db.auction_players.count_documents(
            {"auction_id": auction_id, "category": "classic", "status": "available"}
        )
        if remaining == 0:
            break
        to_headers, other_headers = headers_cycle[i % 2]
        _sell(client, auction_id, to_headers, other_headers)

    counts_before = (
        mongo.db.auction_players.count_documents({"auction_id": auction_id, "status": "available"}),
        client.get(f"/api/auction/{auction_id}/release-log", headers=admin_headers).get_json()["entries"],
    )
    assert counts_before[0] == 0

    for _ in range(3):
        state = _get(client, admin_headers, auction_id).get_json()
        assert state["is_complete"] is True

    # Repeated polling of an already-complete auction must not mutate anything.
    log_after = client.get(f"/api/auction/{auction_id}/release-log", headers=admin_headers).get_json()
    assert len(log_after["entries"]) == len(counts_before[1])


# ── 9. Repeated polling never skips, duplicates, or re-releases ─────────────

def test_repeated_polling_never_skips_duplicates_or_re_releases_a_player(client, admin_headers, auth_header, make_auction_setup):
    # 4 players (quota 2) so selling P1 leaves P2 genuinely available for
    # auto-release to claim, rather than leftover-award resolving it first.
    setup = make_auction_setup(
        [("power", 40, 10), ("power", 30, 10), ("power", 20, 10), ("power", 10, 10)]
        + [("classic", None, None)] * 16
    )
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    _release(client, admin_headers, auction_id, "power")
    _sell(client, auction_id, a_headers, b_headers)  # drop_player's own tail already auto-releases P2

    first_state = _get(client, admin_headers, auction_id).get_json()
    current_id = first_state["current_player"]["id"]

    for _ in range(3):
        state = _get(client, admin_headers, auction_id).get_json()
        assert state["current_player"]["id"] == current_id

    log = client.get(f"/api/auction/{auction_id}/release-log", headers=admin_headers).get_json()
    assert len(log["entries"]) == 2  # exactly P1 + P2, not 3+ from repeated polling


# ── 10a/10b. Budget/quota edge cases -- regression only, not new logic ──────

def test_single_captain_budget_exhaustion_does_not_affect_the_other_captain(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("classic", None, None)] * 2 + [("power", None, None)] * 20)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    # Drain captain_a's full 17-point purse directly, independent of classic
    # -- simulates them having already spent everything earlier in the auction.
    drained_marker = mongo.db.auction_players.find_one({"auction_id": auction_id, "category": "power"})
    mongo.db.auction_players.update_one(
        {"_id": drained_marker["_id"]},
        {"$set": {"status": "sold", "sold_to": str(setup["captain_a"]["_id"]),
                  "sold_price": 25.5, "assigned_via": "bid"}},  # 25.5 - 8.5 base = 17 pts spent
    )

    _release(client, admin_headers, auction_id, "classic")
    state = _get(client, admin_headers, auction_id).get_json()
    assert state["captain_a"]["points_remaining"] == 0
    assert state["captain_b"]["points_remaining"] == 17  # fully unaffected

    rejected = client.post(f"/api/auction/{auction_id}/bid", json={"amount": 9.0}, headers=a_headers)
    assert rejected.status_code == 400
    assert "no points left" in rejected.get_json()["error"]

    # captain_b's own bidding continues completely normally.
    sold = _sell(client, auction_id, b_headers, a_headers)
    assert sold.get_json()["sold_to"] == str(setup["captain_b"]["_id"])


def test_quota_completion_with_points_remaining_still_triggers_free_pick_and_completion(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 2 + [("classic", None, None)] * 18)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    _release(client, admin_headers, auction_id, "power")
    _sell(client, auction_id, a_headers, b_headers, amount=9.0)  # cheap win, quota (1) hit with plenty of points left

    state = _get(client, admin_headers, auction_id).get_json()
    assert state["captain_a"]["points_remaining"] == 16.5  # quota stopped it, not budget
    power_docs = list(mongo.db.auction_players.find({"auction_id": auction_id, "category": "power"}))
    leftover = [p for p in power_docs if p["assigned_via"] == "leftover_free"]
    assert len(leftover) == 1
    assert leftover[0]["sold_to"] == str(setup["captain_b"]["_id"])

    # Resolve classic too so the whole pool empties, confirming completion
    # still fires correctly even though captain_a stopped via quota, not budget.
    _release(client, admin_headers, auction_id, "classic")
    headers_cycle = [(a_headers, b_headers), (b_headers, a_headers)]
    for i in range(18):
        remaining = mongo.db.auction_players.count_documents(
            {"auction_id": auction_id, "category": "classic", "status": "available"}
        )
        if remaining == 0:
            break
        to_headers, other_headers = headers_cycle[i % 2]
        _sell(client, auction_id, to_headers, other_headers)

    final_state = _get(client, admin_headers, auction_id).get_json()
    assert final_state["is_complete"] is True


# Test case 11 (concurrent bids at the exact moment of release) is
# pre-existing bid-validation logic (place_bid's last_bid/amount checks),
# unrelated to auto-release itself -- not covered by a new test here.


# ── 12. Post-close export/copy data integrity under auto-driven completion ──

def test_copy_export_returns_complete_data_after_auto_release_driven_completion(client, admin_headers, auth_header, make_auction_setup):
    # is_complete checks the WHOLE pool, every category -- so every category
    # in this setup must actually be driven to resolution, not just a couple
    # with the rest left as untouched filler.
    category_sizes = {
        "power": 6, "classic": 6, "extra_power_batsman": 4, "extra_power_allrounder": 4,
    }
    setup = make_auction_setup(
        [(cat, None, None) for cat, n in category_sizes.items() for _ in range(n)]
    )
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    # Drive every category via ONE manual release each, letting auto-release
    # chain the rest of each on its own -- not one click per player.
    headers_cycle = [(a_headers, b_headers), (b_headers, a_headers)]
    for category, size in category_sizes.items():
        _release(client, admin_headers, auction_id, category)
        for i in range(size):
            remaining = mongo.db.auction_players.count_documents(
                {"auction_id": auction_id, "category": category, "status": "available"}
            )
            if remaining == 0:
                break
            to_headers, other_headers = headers_cycle[i % 2]
            _sell(client, auction_id, to_headers, other_headers)

    assert _get(client, admin_headers, auction_id).get_json()["is_complete"] is True

    close_res = client.post(f"/api/admin/auction/{auction_id}/close", headers=admin_headers)
    assert close_res.status_code == 200

    after_close = _get(client, admin_headers, auction_id).get_json()
    expected_per_captain = sum(size // 2 for size in category_sizes.values())
    for team in ("captain_a", "captain_b"):
        summary = after_close[team]
        assert summary["roster_count"] == expected_per_captain
        assert len(summary["roster"]) == expected_per_captain
        for player in summary["roster"]:
            assert player["name"]  # names visible
            assert player["price"] is None  # confidential post-close
            assert player["assigned_via"] is None
    assert after_close["status"] == "completed"
