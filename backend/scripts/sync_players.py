"""
One-off migration: reconcile the real player roster against existing accounts.

  - Deactivates the leftover demo/IPL captain accounts.
  - Flags existing captains who are also on the player roster with is_player=True
    (no duplicate account — one login, dual capability).
  - Creates new role="player" accounts for roster names with no existing account.

Usage:
  docker exec bcc-backend python scripts/sync_players.py
"""
import os
import sys
import re
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from werkzeug.security import generate_password_hash
from datetime import datetime
from pymongo import MongoClient

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/bcc_cvote")
client = MongoClient(MONGO_URI)
db = client.get_default_database()

# ── Demo/IPL captain accounts to retire ─────────────────────────────────────────
DEMO_CAPTAIN_CODES = ["RHT", "VRT", "MSD", "KLR", "HRD", "JSB", "SHG", "SKY", "RVJ", "AXR"]

# ── Full player roster ───────────────────────────────────────────────────────────
PLAYERS = [
    "Rajesh", "Abhi", "Srinu", "Mallesh", "Shashi", "Bablu", "Narasimha", "Prasath",
    "Sadanand", "Raghavendra", "Phanikumar", "Ram Prasad", "Suresh", "Naidu", "Shoyeb",
    "Bunny", "Ravi", "Vasu", "Vinod", "P Raju", "Nagendra", "Nirup", "Ramu Patel",
    "Satya Prakash", "Pandu", "Pavan", "Venkat", "Shankar", "Kalyan", "Shivudu",
    "Narayana", "Shekar Sri", "Saireddy", "Ramu Kuna", "Srikanth K", "Bhimesh",
    "Srikanth M", "Chaitanya", "Naidu P", "Mani", "Hardik", "Punny", "Arogyaraju",
    "Bharath", "Sudhakar", "Rahul", "Sridhar", "Ramesh D", "Venkataramana", "Madhu",
    "Praveen Reddy", "Shareef", "Neeraj", "Rajesh New",
]


def make_unique_code(name, existing_codes):
    first_word = re.sub(r"[^A-Za-z]", "", name.split()[0]).upper()
    last_word = re.sub(r"[^A-Za-z]", "", name.split()[-1]).upper()
    candidates = [first_word[:3]]
    if last_word != first_word:
        candidates.append((first_word[:2] + last_word[:1]).upper())
    candidates.append(first_word[:4])
    # Discard candidates shorter than 3 chars (e.g. single-letter names) — not descriptive enough
    candidates = [c for c in candidates if len(c) >= 3] or candidates
    for c in candidates:
        if c and c not in existing_codes:
            return c
    base = (first_word[:3] or first_word or "PLY")
    n = 2
    while f"{base}{n}" in existing_codes:
        n += 1
    return f"{base}{n}"


def sync():
    print("Syncing player roster...")

    # 1. Deactivate demo captains
    result = db.users.update_many(
        {"team_code": {"$in": DEMO_CAPTAIN_CODES}},
        {"$set": {"is_active": False}},
    )
    print(f"  Deactivated {result.modified_count} demo captain account(s)")

    existing_codes = {u["team_code"] for u in db.users.find({}, {"team_code": 1})}
    active_users = list(db.users.find({"role": {"$in": ["captain", "player"]}, "is_active": True}))
    by_name = {u["name"].strip().lower(): u for u in active_users}

    flagged, created, skipped = [], [], []
    for name in PLAYERS:
        key = name.strip().lower()
        existing = by_name.get(key)
        if existing:
            if existing["role"] == "player":
                skipped.append((name, existing["team_code"]))
                continue
            if not existing.get("is_player"):
                db.users.update_one({"_id": existing["_id"]}, {"$set": {"is_player": True}})
            flagged.append((name, existing["team_code"]))
            continue

        code = make_unique_code(name, existing_codes)
        existing_codes.add(code)
        db.users.insert_one({
            "name": name,
            "team_code": code,
            "password_hash": generate_password_hash(code.lower()),
            "role": "player",
            "is_player": True,
            "is_active": True,
            "created_at": datetime.utcnow(),
        })
        created.append((name, code))

    print(f"  Flagged {len(flagged)} existing captain(s) as players:")
    for name, code in flagged:
        print(f"    - {name} ({code})")

    print(f"  Created {len(created)} new player account(s):")
    for name, code in created:
        print(f"    - {name} -> {code} / password: {code.lower()}")

    if skipped:
        print(f"  Skipped {len(skipped)} already-synced player account(s)")

    print(f"Done. {len(flagged) + len(created) + len(skipped)} total voters on the roster.")


if __name__ == "__main__":
    sync()
