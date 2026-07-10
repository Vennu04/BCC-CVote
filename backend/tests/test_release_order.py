"""Requirement #7 (updated): release order within a category is driven by
batting/bowling stats, never admin's manual pick.

extra_power_batsman is graded on batting only (battingAverage desc, then
strikeRate desc — bowling never enters the score). extra_power_allrounder,
power and classic are graded on both skills via a direct signed sum:
(battingAverage - bowlingAverage) desc as primary, (strikeRate - economy)
desc as secondary. Any remaining tie across all four groups is broken by
attendance_percentage descending.

get_next_player_in_category is a pure function (no Mongo access) so the
ranking logic is verified independently of the bid/quota/leftover machinery
around it (that composition is covered in test_auction_lifecycle.py) and
independently of the release_player HTTP action.
"""
import pytest
from bson import ObjectId

from app import mongo
from app.routes.auction import _next_release_candidate, get_next_player_in_category


@pytest.fixture()
def fake_auction(app):
    return {"_id": ObjectId()}


def _add_player(auction, category, user_id, **fields):
    mongo.db.auction_players.insert_one({
        "auction_id": str(auction["_id"]), "user_id": str(user_id), "category": category,
        "status": "available", "sold_to": None, "sold_price": None, "assigned_via": None,
        "deprioritized": False, **fields,
    })


def _add_user(name, **fields):
    uid = mongo.db.users.insert_one({"name": name, **fields}).inserted_id
    return uid


def _candidate(category, user_id, **fields):
    """A bare auction_player-shaped dict, built without touching Mongo — used
    to prove get_next_player_in_category needs no database at all."""
    return {"_id": ObjectId(), "user_id": str(user_id), "category": category,
            "status": "available", "deprioritized": False, **fields}


# ── extra_power_batsman: batting only ───────────────────────────────────────

def test_extra_power_batsman_ranks_by_batting_average_descending(app, fake_auction):
    low = _add_user("Low", batting_average=10, strike_rate=100)
    mid = _add_user("Mid", batting_average=20, strike_rate=100)
    high = _add_user("High", batting_average=30, strike_rate=100)
    for uid in (low, mid, high):
        _add_player(fake_auction, "extra_power_batsman", uid)

    users_map = {str(u): mongo.db.users.find_one({"_id": u}) for u in (low, mid, high)}
    order = []
    for _ in range(3):
        p = _next_release_candidate(fake_auction, "extra_power_batsman", users_map)
        order.append(users_map[p["user_id"]]["name"])
        mongo.db.auction_players.update_one({"_id": p["_id"]}, {"$set": {"status": "sold"}})

    assert order == ["High", "Mid", "Low"]


def test_extra_power_batsman_uses_strike_rate_as_secondary_sort():
    # Same batting average — strike rate decides the order.
    fast = {"name": "Fast", "batting_average": 20, "strike_rate": 150}
    slow = {"name": "Slow", "batting_average": 20, "strike_rate": 90}
    users_map = {"1": fast, "2": slow}
    candidates = [_candidate("extra_power_batsman", "1"), _candidate("extra_power_batsman", "2")]
    winner = get_next_player_in_category(candidates, "extra_power_batsman", users_map)
    assert users_map[winner["user_id"]]["name"] == "Fast"


def test_extra_power_batsman_ignores_bowling_stats_entirely(app, fake_auction):
    uid = _add_user("Batter", batting_average=15, strike_rate=100, bowling_average=999, economy=999)
    users_map = {str(uid): mongo.db.users.find_one({"_id": uid})}
    candidates = [_candidate("extra_power_batsman", uid)]
    winner = get_next_player_in_category(candidates, "extra_power_batsman", users_map)
    assert winner is not None  # a terrible bowling_average must not disqualify a batsman


# ── extra_power_allrounder / power / classic: combined signed-sum ──────────

@pytest.mark.parametrize("category", ["extra_power_allrounder", "power", "classic"])
def test_combined_groups_rank_by_batting_minus_bowling_average(category):
    # Weaker raw batting average but a much better bowling average nets a higher combined score.
    strong_bat = {"name": "StrongBat", "batting_average": 30, "strike_rate": 100, "bowling_average": 25, "economy": 8}
    balanced = {"name": "Balanced", "batting_average": 20, "strike_rate": 100, "bowling_average": 10, "economy": 8}
    # StrongBat: 30-25=5. Balanced: 20-10=10 -> Balanced should win despite the lower raw batting average.
    users_map = {"1": strong_bat, "2": balanced}
    candidates = [_candidate(category, "1"), _candidate(category, "2")]
    winner = get_next_player_in_category(candidates, category, users_map)
    assert users_map[winner["user_id"]]["name"] == "Balanced"


@pytest.mark.parametrize("category", ["extra_power_allrounder", "power", "classic"])
def test_combined_groups_secondary_sort_is_strike_rate_minus_economy(category):
    # Both have battingAverage - bowlingAverage == 10 (tied primary); strikeRate - economy breaks it.
    a = {"name": "A", "batting_average": 20, "bowling_average": 10, "strike_rate": 150, "economy": 8}   # secondary 142
    b = {"name": "B", "batting_average": 25, "bowling_average": 15, "strike_rate": 110, "economy": 10}  # secondary 100
    users_map = {"1": a, "2": b}
    candidates = [_candidate(category, "1"), _candidate(category, "2")]
    winner = get_next_player_in_category(candidates, category, users_map)
    assert users_map[winner["user_id"]]["name"] == "A"


# ── Tie-break: attendance_percentage descending ─────────────────────────────

def test_attendance_percentage_breaks_a_full_tie_on_primary_and_secondary():
    # Identical battingAverage AND strikeRate (extra_power_batsman formula) —
    # only attendance_percentage differs.
    frequent = {"name": "Frequent", "batting_average": 20, "strike_rate": 120, "attendance_percentage": 94.12}
    rare = {"name": "Rare", "batting_average": 20, "strike_rate": 120, "attendance_percentage": 41.18}
    users_map = {"1": frequent, "2": rare}
    candidates = [_candidate("extra_power_batsman", "1"), _candidate("extra_power_batsman", "2")]
    winner = get_next_player_in_category(candidates, "extra_power_batsman", users_map)
    assert users_map[winner["user_id"]]["name"] == "Frequent"


def test_attendance_percentage_tiebreak_also_applies_to_combined_groups():
    a = {"name": "A", "batting_average": 20, "bowling_average": 10, "strike_rate": 100, "economy": 8, "attendance_percentage": 100.0}
    b = {"name": "B", "batting_average": 20, "bowling_average": 10, "strike_rate": 100, "economy": 8, "attendance_percentage": 52.94}
    users_map = {"1": a, "2": b}
    candidates = [_candidate("classic", "1"), _candidate("classic", "2")]
    winner = get_next_player_in_category(candidates, "classic", users_map)
    assert users_map[winner["user_id"]]["name"] == "A"


# ── Missing stats (null, not 0) sort after every scored player ─────────────

def test_players_without_batting_average_sort_after_scored_players_by_name(app, fake_auction):
    scored = _add_user("Zeta", batting_average=5, strike_rate=100)
    unscored_a = _add_user("Beta")
    unscored_b = _add_user("Alpha")
    for uid in (scored, unscored_a, unscored_b):
        _add_player(fake_auction, "extra_power_batsman", uid)

    users_map = {str(u): mongo.db.users.find_one({"_id": u}) for u in (scored, unscored_a, unscored_b)}
    order = []
    for _ in range(3):
        p = _next_release_candidate(fake_auction, "extra_power_batsman", users_map)
        order.append(users_map[p["user_id"]]["name"])
        mongo.db.auction_players.update_one({"_id": p["_id"]}, {"$set": {"status": "sold"}})

    # "Zeta" has a real average so it goes first despite alphabetical order;
    # the two unscored players then follow, sorted by name (Alpha before Beta).
    assert order == ["Zeta", "Alpha", "Beta"]


def test_combined_groups_require_both_batting_and_bowling_average_for_a_score():
    # A pure batting specialist with no bowling record at all falls into the
    # unscored group for a combined category (needs the tie-break rule
    # explicitly, not silently treated as bowling_average=0).
    specialist = {"name": "Specialist", "batting_average": 40, "strike_rate": 200}  # no bowling_average
    allrounder = {"name": "Allrounder", "batting_average": 10, "bowling_average": 20, "strike_rate": 90, "economy": 9}
    users_map = {"1": specialist, "2": allrounder}
    candidates = [_candidate("classic", "1"), _candidate("classic", "2")]
    winner = get_next_player_in_category(candidates, "classic", users_map)
    assert users_map[winner["user_id"]]["name"] == "Allrounder"


# ── Deprioritized queue (unchanged behavior, re-verified against new scoring) ─

def test_deprioritized_players_are_held_back_to_the_end_of_the_queue(app, fake_auction):
    normal = _add_user("Normal", batting_average=1, strike_rate=1)  # lowest score, would go last on merit
    held_back = _add_user("HeldBack", batting_average=99, strike_rate=99)  # highest score, but deprioritized
    _add_player(fake_auction, "extra_power_batsman", normal)
    _add_player(fake_auction, "extra_power_batsman", held_back, deprioritized=True)

    users_map = {str(u): mongo.db.users.find_one({"_id": u}) for u in (normal, held_back)}
    first = _next_release_candidate(fake_auction, "extra_power_batsman", users_map)
    assert users_map[first["user_id"]]["name"] == "Normal"

    mongo.db.auction_players.update_one({"_id": first["_id"]}, {"$set": {"status": "sold"}})
    second = _next_release_candidate(fake_auction, "extra_power_batsman", users_map)
    assert users_map[second["user_id"]]["name"] == "HeldBack"


def test_no_candidates_returns_none(app, fake_auction):
    assert _next_release_candidate(fake_auction, "classic", {}) is None
    assert get_next_player_in_category([], "classic", {}) is None


# ── Real dataset regression: exact stats loaded into prod 2026-07-10 ───────

def test_real_dataset_produces_expected_batsman_release_order():
    """Regression check against 3 real players from the bulk stats load
    (see project memory project_bcc_cvote_player_stats) in extra_power_batsman
    shape: Srinu (28.2 avg) > Naidu (23.6 avg) > Bunny (12.6 avg)."""
    srinu = {"name": "Srinu", "batting_average": 28.2, "strike_rate": 170.8}
    naidu = {"name": "Naidu", "batting_average": 23.6, "strike_rate": 161.9}
    bunny = {"name": "Bunny", "batting_average": 12.6, "strike_rate": 104.9}
    users_map = {"1": srinu, "2": naidu, "3": bunny}
    candidates = [_candidate("extra_power_batsman", "1"),
                  _candidate("extra_power_batsman", "2"),
                  _candidate("extra_power_batsman", "3")]

    order = []
    remaining = candidates
    while remaining:
        winner = get_next_player_in_category(remaining, "extra_power_batsman", users_map)
        order.append(users_map[winner["user_id"]]["name"])
        remaining = [c for c in remaining if c["_id"] != winner["_id"]]

    assert order == ["Srinu", "Naidu", "Bunny"]
