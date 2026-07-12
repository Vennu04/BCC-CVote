"""Integration tests against the live HTTP API for auto-release: admin
manually releases only the very first player of the whole auction, then the
system advances through every remaining player on its own once each one's
bidding resolves (sold or unsold) -- including moving on to the NEXT
CATEGORY automatically once the current one runs out, in the fixed
AUCTION_GROUPS sequence, cycling from wherever admin's one manual click
happened to start (see release_player's and _maybe_auto_release_next's
docstrings in app/routes/auction.py). Also covers the computed
auction.is_complete signal and the concurrency-safety (CAS) guarantee
behind both.

Budget/quota edge cases (spec section 4) are regression tests only --
free_pick()/_check_leftover_award() already implement single-captain
drain and per-category quota completion; nothing new was built for them
here, this just confirms they still work under the auto-release flow."""
from bson import ObjectId
from datetime import datetime, timedelta

from app import mongo
from app.routes.auction import AUCTION_GROUPS


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


def _resolve_whatever_is_current(client, auction_id, a_headers, b_headers, winner_is_a):
    """Sell the current player, alternating who wins -- used by the
    drive-to-completion helper below without caring which category or
    player it happens to be."""
    if winner_is_a:
        return _sell(client, auction_id, a_headers, b_headers)
    return _sell(client, auction_id, b_headers, a_headers)


def _drive_to_completion(client, admin_headers, auction_id, a_headers, b_headers, max_steps=200):
    """Resolve players one at a time -- alternating winners -- until
    is_complete flips true or max_steps is exhausted (safety valve against
    an infinite loop if something's actually broken). Returns the ordered
    list of (category, player_id) actually resolved, read from the current
    player before each resolve."""
    resolved = []
    winner_is_a = True
    for _ in range(max_steps):
        state = _get(client, admin_headers, auction_id).get_json()
        if state["is_complete"]:
            return resolved
        cp = state["current_player"]
        assert cp is not None, f"stuck: not complete but no current_player -- {state}"
        resolved.append((cp["category"], cp["id"]))
        _resolve_whatever_is_current(client, auction_id, a_headers, b_headers, winner_is_a)
        winner_is_a = not winner_is_a
    raise AssertionError(f"did not reach completion within {max_steps} steps")


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


# ── 4. Auto-release advances to the next category automatically ─────────────

def test_auto_release_advances_to_next_category_in_fixed_order(client, admin_headers, auth_header, make_auction_setup):
    # 4 players per category (quota 2) so neither category fully resolves
    # on its first sale alone -- real room to observe within-category
    # chaining before the cross-category jump happens.
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

    # Power's 2nd player must come up next -- still within power.
    state = _get(client, admin_headers, auction_id).get_json()
    assert state["current_player"]["category"] == "power"
    assert state["auto_release_category"] == "power"

    # Fully resolve power (alternating sells; the 3rd sale hits quota=2 and
    # leftover-awards the 4th automatically) -- NO manual /release call for
    # classic. Per AUCTION_GROUPS order (extra_power_allrounder,
    # extra_power_batsman, power, classic), classic is the only OTHER
    # category actually present in this pool, so it must auto-start next.
    headers_cycle = [(b_headers, a_headers), (a_headers, b_headers)]
    for i in range(3):
        remaining = mongo.db.auction_players.count_documents(
            {"auction_id": auction_id, "category": "power", "status": "available"}
        )
        if remaining == 0:
            break
        to_headers, other_headers = headers_cycle[i % 2]
        _sell(client, auction_id, to_headers, other_headers)

    after_power = _get(client, admin_headers, auction_id).get_json()
    assert after_power["current_player"] is not None
    assert after_power["current_player"]["category"] == "classic"
    assert after_power["auto_release_category"] == "classic"

    # Drive the rest to completion too -- no manual release call anywhere
    # after the very first one for power. The 12-player
    # extra_power_allrounder filler is a real category with real
    # candidates, so once power and classic are both done, auto-release
    # correctly keeps going into it too rather than stopping early.
    # power's own 4 players were already resolved above (manually, before
    # this helper), so only classic + the filler category remain for
    # _drive_to_completion to pick up from here.
    resolved = _drive_to_completion(client, admin_headers, auction_id, a_headers, b_headers)
    assert all(cat in ("classic", "extra_power_allrounder") for cat, _ in resolved)
    assert {cat for cat, _ in resolved} == {"classic", "extra_power_allrounder"}

    final_state = _get(client, admin_headers, auction_id).get_json()
    assert final_state["is_complete"] is True
    assert final_state["current_player"] is None


def test_auto_release_visits_categories_in_the_exact_AUCTION_GROUPS_order(client, admin_headers, auth_header, make_auction_setup):
    """Full end-to-end: release only the FIRST category by hand, then let
    every remaining player across all 4 categories resolve itself with zero
    further /release calls -- confirming the auto-advance sequence matches
    AUCTION_GROUPS exactly (extra_power_allrounder -> extra_power_batsman ->
    power -> classic), the order this app's admin UI presents them in."""
    assert AUCTION_GROUPS == ("extra_power_allrounder", "extra_power_batsman", "power", "classic")

    # 6 each (24 total) clears MIN_AUCTION_POOL_SIZE (20); 4 each (16) was too small.
    category_sizes = {"extra_power_allrounder": 6, "extra_power_batsman": 6, "power": 6, "classic": 6}
    setup = make_auction_setup(
        [(cat, None, None) for cat, n in category_sizes.items() for _ in range(n)]
    )
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    # The ONE and only manual release call for the entire auction.
    _release(client, admin_headers, auction_id, "extra_power_allrounder")

    resolved = _drive_to_completion(client, admin_headers, auction_id, a_headers, b_headers)

    # The category each resolved player belonged to, in the order it was
    # released, deduped while preserving order, must match AUCTION_GROUPS.
    seen_categories = []
    for cat, _ in resolved:
        if not seen_categories or seen_categories[-1] != cat:
            seen_categories.append(cat)
    assert seen_categories == list(AUCTION_GROUPS)

    final_state = _get(client, admin_headers, auction_id).get_json()
    assert final_state["is_complete"] is True


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

def test_no_completion_signal_while_pool_still_has_players_elsewhere(client, admin_headers, auth_header, make_auction_setup):
    # "power" has just 2 players (quota 1) -- one sale fully resolves it via
    # instant leftover-award. Once that happens, auto-release immediately
    # continues into "classic" (the next category in AUCTION_GROUPS order
    # that's actually present in this pool) -- but the auction as a WHOLE
    # is still not done, since classic's own players haven't resolved yet.
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
    assert state["is_complete"] is False  # classic's own players still unresolved


def test_completion_signal_fires_and_stays_stable_when_both_captains_finish(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 2 + [("classic", None, None)] * 18)
    a_headers = auth_header(setup["captain_a"])
    b_headers = auth_header(setup["captain_b"])
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    _start(client, admin_headers, auction_id)

    # ONE manual release -- power resolves (1 sold, 1 leftover-awarded), then
    # auto-release continues straight into classic with no second /release call.
    _release(client, admin_headers, auction_id, "power")
    _drive_to_completion(client, admin_headers, auction_id, a_headers, b_headers)

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

    # No manual release for classic -- auto-release already continued into
    # it the instant power's leftover-award fired. Just drive it to the end.
    _drive_to_completion(client, admin_headers, auction_id, a_headers, b_headers)

    final_state = _get(client, admin_headers, auction_id).get_json()
    assert final_state["is_complete"] is True


# Test case 11 (concurrent bids at the exact moment of release) is
# pre-existing bid-validation logic (place_bid's last_bid/amount checks),
# unrelated to auto-release itself -- not covered by a new test here.


# ── 12. Post-close export/copy data integrity under auto-driven completion ──

def test_copy_export_returns_complete_data_after_auto_release_driven_completion(client, admin_headers, auth_header, make_auction_setup):
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

    # ONE manual release for the whole auction -- everything else, across
    # all 4 categories, is auto-driven.
    _release(client, admin_headers, auction_id, "power")
    _drive_to_completion(client, admin_headers, auction_id, a_headers, b_headers)

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


# ── Captains from different categories vs. the same category ────────────────

def test_captains_from_different_categories_full_auto_run(client, admin_headers, auth_header, make_auction_setup):
    """Mirrors the real prod dry run: captain_a and captain_b are each part
    of a DIFFERENT auction category's voter pool (as real captains usually
    are), excluded from their own category's pool once picked to run the
    draft. Confirms group_counts already reflects the exclusion correctly
    and the whole auction completes via one manual release."""
    # Raw counts are ODD (7) in each category the captains come from, so
    # excluding exactly 1 captain from each leaves an EVEN auctioned pool
    # (6 + 6) -- create_auction rejects odd splits, so this is deliberate,
    # not arbitrary.
    setup = make_auction_setup(
        [("extra_power_allrounder", None, None)] * 7  # captain_a will be one of these
        + [("power", None, None)] * 7                  # captain_b will be one of these
        + [("classic", None, None)] * 8
    )
    # Re-purpose two of the actual pool voters as the draft-running captains,
    # instead of make_auction_setup's separate dedicated captain_a/captain_b,
    # so their own category is genuinely represented in the pool_spec.
    epa_voter = next(v for v in setup["voters"] if v["auction_category"] == "extra_power_allrounder")
    power_voter = next(v for v in setup["voters"] if v["auction_category"] == "power")
    mongo.db.users.update_many(
        {"_id": {"$in": [epa_voter["_id"], power_voter["_id"]]}}, {"$set": {"role": "captain"}}
    )
    a_headers = auth_header(epa_voter)
    b_headers = auth_header(power_voter)

    res = client.post("/api/admin/auction", json={
        "slot_id": setup["slot_id"],
        "captain_a_id": str(epa_voter["_id"]), "captain_b_id": str(power_voter["_id"]),
    }, headers=admin_headers)
    assert res.status_code == 201
    counts = res.get_json()["group_counts"]
    assert counts["extra_power_allrounder"] == 6  # 7 - the 1 captain drawn from it
    assert counts["power"] == 6                    # 7 - the 1 captain drawn from it
    assert counts["classic"] == 8
    auction_id = res.get_json()["auction_id"]

    _start(client, admin_headers, auction_id)
    _release(client, admin_headers, auction_id, "extra_power_allrounder")
    _drive_to_completion(client, admin_headers, auction_id, a_headers, b_headers)

    final_state = _get(client, admin_headers, auction_id).get_json()
    assert final_state["is_complete"] is True
    assert final_state["status"] == "active"  # not closed yet, just fully resolved


def test_both_captains_from_the_same_category_still_splits_evenly(client, admin_headers, auth_header, make_user, make_slot_and_window, make_vote):
    """The scenario flagged after the real prod dry run: what if BOTH
    draft-running captains happen to share the same auction_category,
    instead of one from each? create_auction excludes captain_a_id/
    captain_b_id by user ID, not by category, so this should just mean that
    ONE category's raw pool shrinks by 2 instead of two different
    categories each shrinking by 1 -- as long as what's left is still even,
    nothing about the mechanism should care. Built from the low-level
    fixtures directly (not make_auction_setup) since that fixture always
    creates captain_a/captain_b as separate dedicated users outside the
    voted pool, which can't represent this scenario."""
    slot_id, window_id = make_slot_and_window()

    # 6 "power" voters -- 2 of them will run the draft, leaving 4 (even) auctioned.
    power_users = []
    for i in range(6):
        u = make_user("captain" if i < 2 else "player", f"PWR{i}", f"pwr{i}",
                       name=f"PowerPerson{i}", auction_category="power",
                       batting_average=None, bowling_average=None)
        make_vote(u["_id"], slot_id, window_id, "available")
        power_users.append(u)
    captain_a, captain_b = power_users[0], power_users[1]

    # 16 "classic" filler so the total pool clears MIN_AUCTION_POOL_SIZE (20)
    # even after excluding the 2 same-category captains (4 + 16 = 20).
    for i in range(16):
        u = make_user("player", f"CLS{i}", f"cls{i}", name=f"ClassicPerson{i}",
                       auction_category="classic", batting_average=None, bowling_average=None)
        make_vote(u["_id"], slot_id, window_id, "available")

    res = client.post("/api/admin/auction", json={
        "slot_id": slot_id,
        "captain_a_id": str(captain_a["_id"]), "captain_b_id": str(captain_b["_id"]),
    }, headers=admin_headers)
    assert res.status_code == 201
    assert res.get_json()["group_counts"]["power"] == 4  # 6 - both captains
    assert res.get_json()["group_counts"]["classic"] == 16

    auction_id = res.get_json()["auction_id"]
    a_headers = auth_header(captain_a)
    b_headers = auth_header(captain_b)

    _start(client, admin_headers, auction_id)
    _release(client, admin_headers, auction_id, "power")  # the one manual click
    resolved = _drive_to_completion(client, admin_headers, auction_id, a_headers, b_headers)
    assert {cat for cat, _ in resolved} == {"power", "classic"}

    final_state = _get(client, admin_headers, auction_id).get_json()
    assert final_state["is_complete"] is True
    assert final_state["captain_a"]["roster_count"] == final_state["captain_b"]["roster_count"] == 10  # (4+16)/2 each
