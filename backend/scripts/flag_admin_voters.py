"""
One-off migration: let specific admin accounts also vote as themselves.

  - Flags the named admin accounts with is_player=True (no duplicate account —
    one login, dual capability, same pattern sync_players.py already uses for
    captains who are also on the player roster).
  - Does NOT touch auction_category, team_name, or anything else — each admin
    sets their own auction_category afterward via Manage Players, once this
    flag makes their row visible there.

Usage:
  docker exec bcc-backend python scripts/flag_admin_voters.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from pymongo import MongoClient

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/bcc_cvote")
client = MongoClient(MONGO_URI)
db = client.get_default_database()

# Exact team_codes only — never match by name. These 3 admin accounts share
# names with unrelated real captain/player accounts (different team_codes),
# so matching by name would silently flag the wrong row.
ADMIN_VOTER_TEAM_CODES = ["SHASHI", "SURESH", "SRIKANTH"]


def flag():
    print("Flagging admin accounts as voters...")
    flagged, already_set, missing, wrong_role = [], [], [], []

    for team_code in ADMIN_VOTER_TEAM_CODES:
        user = db.users.find_one({"team_code": team_code})
        if not user:
            missing.append(team_code)
            continue
        if user["role"] != "admin":
            wrong_role.append((team_code, user["role"]))
            continue
        if user.get("is_player"):
            already_set.append(team_code)
            continue
        db.users.update_one({"_id": user["_id"]}, {"$set": {"is_player": True}})
        flagged.append(team_code)

    print(f"  Flagged {len(flagged)}: {flagged}")
    if already_set:
        print(f"  Already flagged (skipped): {already_set}")
    if missing:
        print(f"  Not found (skipped): {missing}")
    if wrong_role:
        print(f"  Skipped — not role=='admin': {wrong_role}")

    print("Done.")


if __name__ == "__main__":
    flag()
