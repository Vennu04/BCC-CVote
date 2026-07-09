"""Requirement #7: release order within a category is driven by batting/bowling
average, never admin's manual pick — tested directly against the ranking
function so the ordering logic is verified independent of the bid/quota/
leftover machinery around it (that composition is covered in
test_auction_lifecycle.py)."""
import pytest
from bson import ObjectId

from app import mongo
from app.routes.auction import _next_release_candidate, _release_rank_score


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


def test_power_and_classic_rank_by_batting_average_descending(app, fake_auction):
    low = _add_user("Low", batting_average=10)
    mid = _add_user("Mid", batting_average=20)
    high = _add_user("High", batting_average=30)
    for uid in (low, mid, high):
        _add_player(fake_auction, "classic", uid)

    users_map = {str(u): mongo.db.users.find_one({"_id": u}) for u in (low, mid, high)}
    order = []
    for _ in range(3):
        p = _next_release_candidate(fake_auction, "classic", users_map)
        order.append(users_map[p["user_id"]]["name"])
        mongo.db.auction_players.update_one({"_id": p["_id"]}, {"$set": {"status": "sold"}})

    assert order == ["High", "Mid", "Low"]


def test_extra_power_batsman_uses_batting_average_only(app, fake_auction):
    uid = _add_user("Batter", batting_average=15, bowling_average=999)
    _add_player(fake_auction, "extra_power_batsman", uid)
    users_map = {str(uid): mongo.db.users.find_one({"_id": uid})}
    assert _release_rank_score(mongo.db.auction_players.find_one({"user_id": str(uid)}), users_map) == 15


def test_extra_power_allrounder_averages_both_stats(app, fake_auction):
    uid = _add_user("Allrounder", batting_average=20, bowling_average=10)
    _add_player(fake_auction, "extra_power_allrounder", uid)
    users_map = {str(uid): mongo.db.users.find_one({"_id": uid})}
    assert _release_rank_score(mongo.db.auction_players.find_one({"user_id": str(uid)}), users_map) == 15


def test_players_without_average_sort_after_scored_players_by_name(app, fake_auction):
    scored = _add_user("Zeta", batting_average=5)
    unscored_a = _add_user("Beta")
    unscored_b = _add_user("Alpha")
    for uid in (scored, unscored_a, unscored_b):
        _add_player(fake_auction, "classic", uid)

    users_map = {str(u): mongo.db.users.find_one({"_id": u}) for u in (scored, unscored_a, unscored_b)}
    order = []
    for _ in range(3):
        p = _next_release_candidate(fake_auction, "classic", users_map)
        order.append(users_map[p["user_id"]]["name"])
        mongo.db.auction_players.update_one({"_id": p["_id"]}, {"$set": {"status": "sold"}})

    # "Zeta" has a real average so it goes first despite alphabetical order;
    # the two unscored players then follow, sorted by name (Alpha before Beta).
    assert order == ["Zeta", "Alpha", "Beta"]


def test_deprioritized_players_are_held_back_to_the_end_of_the_queue(app, fake_auction):
    normal = _add_user("Normal", batting_average=1)  # lowest average, would go last on merit
    held_back = _add_user("HeldBack", batting_average=99)  # highest average, but deprioritized
    _add_player(fake_auction, "classic", normal)
    _add_player(fake_auction, "classic", held_back, deprioritized=True)

    users_map = {str(u): mongo.db.users.find_one({"_id": u}) for u in (normal, held_back)}
    first = _next_release_candidate(fake_auction, "classic", users_map)
    assert users_map[first["user_id"]]["name"] == "Normal"

    mongo.db.auction_players.update_one({"_id": first["_id"]}, {"$set": {"status": "sold"}})
    second = _next_release_candidate(fake_auction, "classic", users_map)
    assert users_map[second["user_id"]]["name"] == "HeldBack"


def test_no_candidates_returns_none(app, fake_auction):
    assert _next_release_candidate(fake_auction, "classic", {}) is None
