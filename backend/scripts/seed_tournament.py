"""
One-time loader for the BCC The Dominators Cup 2026 teams + group fixtures
(from the tournament flyer). Idempotent — safe to re-run; skips any team
(matched by name+group) or fixture (matched by group+match_number) that
already exists, so it can also be used to top up newly-added entries later.

Usage:
  MONGODB_URI=<uri> python -m scripts.seed_tournament
  OR docker exec <container> python scripts/seed_tournament.py
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import datetime
from pymongo import MongoClient
from app.indexes import ensure_indexes

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/bcc_cvote")
client = MongoClient(MONGO_URI)
db = client.get_default_database()

TEAMS = {
    "A": [
        "Abhi11", "Aggressive Fighters", "Blaze Strikers", "Blue Wings", "Century Hitters",
        "Dalam", "DS Warriors", "Dravid Dependables", "Game Changers",
    ],
    "B": [
        "Kannappa Warriors", "KK Elevens", "King Kohli Warriors", "Monster", "Nanda Unbeatable",
        "Nirup Ninjas", "PRM Warriors", "Rohit 45", "Super Kings",
    ],
    "C": [
        "The Invincibles Cricket Team", "Team Dawat", "Team Shakti Man", "The 11 Bulls",
        "The Bomb Squad", "Viking Warriors", "Yuvi Sixers", "3NOT9", "PTG Warriors",
    ],
}

# (match_number, team1, team2) — each team plays exactly 2 matches, per group.
FIXTURES = {
    "A": [
        (1, "Abhi11", "Aggressive Fighters"),
        (2, "Blaze Strikers", "Blue Wings"),
        (3, "Century Hitters", "Dalam"),
        (4, "DS Warriors", "Dravid Dependables"),
        (5, "Game Changers", "Abhi11"),
        (6, "Aggressive Fighters", "Blaze Strikers"),
        (7, "Blue Wings", "Century Hitters"),
        (8, "Dalam", "DS Warriors"),
        (9, "Dravid Dependables", "Game Changers"),
    ],
    "B": [
        (1, "Kannappa Warriors", "KK Elevens"),
        (2, "King Kohli Warriors", "Monster"),
        (3, "Nanda Unbeatable", "Nirup Ninjas"),
        (4, "PRM Warriors", "Rohit 45"),
        (5, "Super Kings", "Kannappa Warriors"),
        (6, "KK Elevens", "King Kohli Warriors"),
        (7, "Monster", "Nanda Unbeatable"),
        (8, "Nirup Ninjas", "PRM Warriors"),
        (9, "Rohit 45", "Super Kings"),
    ],
    "C": [
        (1, "The Invincibles Cricket Team", "Team Dawat"),
        (2, "Team Shakti Man", "The 11 Bulls"),
        (3, "The Bomb Squad", "Viking Warriors"),
        (4, "Yuvi Sixers", "3NOT9"),
        (5, "PTG Warriors", "The Invincibles Cricket Team"),
        (6, "Team Dawat", "Team Shakti Man"),
        (7, "The 11 Bulls", "The Bomb Squad"),
        (8, "Viking Warriors", "Yuvi Sixers"),
        (9, "3NOT9", "PTG Warriors"),
    ],
}


def seed():
    print("🏆 Seeding BCC The Dominators Cup 2026 tournament data...")

    team_ids = {}  # (group, name) -> _id
    inserted_teams = 0
    for group, names in TEAMS.items():
        for name in names:
            existing = db.tournament_teams.find_one({"name": name, "group": group})
            if existing:
                team_ids[(group, name)] = existing["_id"]
                continue
            doc = {"name": name, "group": group, "created_at": datetime.utcnow()}
            team_ids[(group, name)] = db.tournament_teams.insert_one(doc).inserted_id
            inserted_teams += 1
    print(f"  ✅ Teams: {inserted_teams} inserted, {sum(len(v) for v in TEAMS.values()) - inserted_teams} already existed")

    inserted_fixtures = 0
    for group, matches in FIXTURES.items():
        for match_number, team1_name, team2_name in matches:
            if db.tournament_fixtures.find_one({"group": group, "match_number": match_number}):
                continue
            doc = {
                "group": group,
                "match_number": match_number,
                "team1_id": team_ids[(group, team1_name)],
                "team2_id": team_ids[(group, team2_name)],
                "date": None,
                "time": None,
                "venue": None,
                "result": None,
                "created_at": datetime.utcnow(),
            }
            db.tournament_fixtures.insert_one(doc)
            inserted_fixtures += 1
    total_fixtures = sum(len(v) for v in FIXTURES.values())
    print(f"  ✅ Fixtures: {inserted_fixtures} inserted, {total_fixtures - inserted_fixtures} already existed")

    ensure_indexes(db)
    print("  ✅ Indexes ensured")
    print("🏏 Tournament seed complete!")


if __name__ == "__main__":
    seed()
