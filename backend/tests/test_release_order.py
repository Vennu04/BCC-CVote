"""Requirement #7 (updated): release order within a category is driven by
batting/bowling stats, never admin's manual pick.

Each category has its own admin-specified index formula:
  - extra_power_batsman: Batting Avg x Strike Rate (bowling never enters)
  - extra_power_allrounder: (Batting Avg x Strike Rate) x
    (1000 / (Bowling Avg x Economy)) -- multiplicative; missing/zero
    bowling stats drop that multiplier rather than zeroing the score
  - power: (Batting Avg x Strike Rate / 100) + (1000 / (Bowling Avg x
    Economy)) -- additive; a pure batsman or pure bowler gets their side
    credited standalone
  - classic: ((Batting Avg + Strike Rate) - (Bowling Avg + Economy)) x
    (Attendance% / 100) -- attendance multiplies the whole index, so a
    player with no attendance on record scores 0 here regardless of stats

Tie-break chain (only reached on an exact index tie): Strike Rate /
Economy descending, then Attendance% descending, then name A-Z. A
totally stat-less player still gets a real score (0) rather than falling
into a separate "unscored" bucket, so it's sorted by the same tie-break
chain as everyone else.

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


# ── extra_power_allrounder: (bat x sr) x (1000 / (bowl x econ)) ────────────

def test_allrounder_index_is_multiplicative_bowling_can_outweigh_batting():
    # StrongBat: (30x100) x (1000/(25x8)) = 3000 x 5.0    = 15000
    # Balanced:  (20x100) x (1000/(10x8)) = 2000 x 12.5   = 25000  -> wins despite lower batting
    strong_bat = {"name": "StrongBat", "batting_average": 30, "strike_rate": 100, "bowling_average": 25, "economy": 8}
    balanced = {"name": "Balanced", "batting_average": 20, "strike_rate": 100, "bowling_average": 10, "economy": 8}
    users_map = {"1": strong_bat, "2": balanced}
    candidates = [_candidate("extra_power_allrounder", "1"), _candidate("extra_power_allrounder", "2")]
    winner = get_next_player_in_category(candidates, "extra_power_allrounder", users_map)
    assert users_map[winner["user_id"]]["name"] == "Balanced"


def test_allrounder_missing_bowling_drops_the_multiplier_instead_of_zeroing_score():
    # A multiplicative formula can't "default a factor to 0" the way an
    # additive one can (0 x anything = 0, wiping out the whole score) -- a
    # player missing bowling stats gets just (bat x sr) standalone instead.
    specialist = {"name": "Specialist", "batting_average": 40, "strike_rate": 200}  # bat*sr = 8000, no bowling
    weak_allrounder = {
        "name": "WeakAllrounder", "batting_average": 10, "strike_rate": 100,
        "bowling_average": 50, "economy": 12,
    }  # (10x100) x (1000/(50x12)) = 1000 x 1.67 = 1667
    users_map = {"1": specialist, "2": weak_allrounder}
    candidates = [_candidate("extra_power_allrounder", "1"), _candidate("extra_power_allrounder", "2")]
    winner = get_next_player_in_category(candidates, "extra_power_allrounder", users_map)
    assert users_map[winner["user_id"]]["name"] == "Specialist"


# ── power: (bat x sr / 100) + (1000 / (bowl x econ)) ───────────────────────

def test_power_index_credits_pure_batsmen_and_pure_bowlers_standalone():
    # Pure batsman: (25x140/100) + 0 (no bowling) = 35.0
    # Pure bowler:  0 (no batting) + (1000/(15x9)) = 7.4
    # Batsman's side alone already beats the bowler's side alone here.
    pure_batsman = {"name": "PureBatsman", "batting_average": 25, "strike_rate": 140}
    pure_bowler = {"name": "PureBowler", "bowling_average": 15, "economy": 9}
    users_map = {"1": pure_batsman, "2": pure_bowler}
    candidates = [_candidate("power", "1"), _candidate("power", "2")]
    winner = get_next_player_in_category(candidates, "power", users_map)
    assert users_map[winner["user_id"]]["name"] == "PureBatsman"


def test_power_index_lets_a_strong_pure_bowler_outrank_a_weak_batsman():
    # Weak batsman: (12x90/100) + 0                = 10.8
    # Strong pure bowler: 0 + (1000/(8x6.5))        = 19.2  -> wins
    weak_batsman = {"name": "WeakBatsman", "batting_average": 12, "strike_rate": 90}
    strong_bowler = {"name": "StrongBowler", "bowling_average": 8, "economy": 6.5}
    users_map = {"1": weak_batsman, "2": strong_bowler}
    candidates = [_candidate("power", "1"), _candidate("power", "2")]
    winner = get_next_player_in_category(candidates, "power", users_map)
    assert users_map[winner["user_id"]]["name"] == "StrongBowler"


# ── classic: ((bat + sr) - (bowl + econ)) x (attendance% / 100) ───────────

def test_classic_index_scales_by_attendance_percentage():
    # Same raw (bat+sr)-(bowl+econ) = 100 for both; attendance scales it.
    frequent = {"name": "Frequent", "batting_average": 20, "strike_rate": 100, "bowling_average": 10, "economy": 10, "attendance_percentage": 90}
    rare = {"name": "Rare", "batting_average": 20, "strike_rate": 100, "bowling_average": 10, "economy": 10, "attendance_percentage": 20}
    users_map = {"1": frequent, "2": rare}
    candidates = [_candidate("classic", "1"), _candidate("classic", "2")]
    winner = get_next_player_in_category(candidates, "classic", users_map)
    assert users_map[winner["user_id"]]["name"] == "Frequent"


def test_classic_index_is_zero_with_no_attendance_on_record_regardless_of_stats():
    # Attendance multiplies the WHOLE index here, not just a tie-break --
    # a great player with no attendance record scores exactly 0, same as
    # a player with no stats at all.
    great_no_attendance = {"name": "GreatNoAttendance", "batting_average": 50, "strike_rate": 200, "bowling_average": 5, "economy": 4}
    modest_with_attendance = {"name": "ModestWithAttendance", "batting_average": 10, "strike_rate": 80, "bowling_average": 15, "economy": 8, "attendance_percentage": 50}
    users_map = {"1": great_no_attendance, "2": modest_with_attendance}
    candidates = [_candidate("classic", "1"), _candidate("classic", "2")]
    winner = get_next_player_in_category(candidates, "classic", users_map)
    assert users_map[winner["user_id"]]["name"] == "ModestWithAttendance"


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


# ── Missing stats: treated as 0, not a disqualifying "unscored" bucket ─────

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
