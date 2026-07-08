"""
One-off migration: link each dual-role admin account to the real captain
account it corresponds to, so create_auction can refuse to let that admin
run an auction where they'd also be one of the two participating captains —
a conflict of interest (they'd control release timing/order while also
bidding). Most admin accounts have no such link and the check is a no-op
for them.

Usage:
  docker exec bcc-backend python scripts/link_dual_role_captains.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from pymongo import MongoClient

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/bcc_cvote")
client = MongoClient(MONGO_URI)
db = client.get_default_database()

# admin team_code -> real captain team_code, exact matches only (these 3
# admin accounts share names with unrelated real captain/player accounts
# under different team_codes — never link by name).
ADMIN_TO_CAPTAIN_TEAM_CODES = {
    "SHASHI": "SHI",
    "SURESH": "SUR",
    "SRIKANTH": "SRK",
}


def link():
    print("Linking dual-role admin accounts to their real captain accounts...")
    linked, already_set, missing = [], [], []

    for admin_code, captain_code in ADMIN_TO_CAPTAIN_TEAM_CODES.items():
        admin_user = db.users.find_one({"team_code": admin_code, "role": "admin"})
        captain_user = db.users.find_one({"team_code": captain_code, "role": "captain"})
        if not admin_user or not captain_user:
            missing.append((admin_code, captain_code))
            continue
        if admin_user.get("linked_captain_id") == str(captain_user["_id"]):
            already_set.append(admin_code)
            continue
        db.users.update_one(
            {"_id": admin_user["_id"]},
            {"$set": {"linked_captain_id": str(captain_user["_id"])}},
        )
        linked.append((admin_code, captain_code))

    print(f"  Linked {len(linked)}: {linked}")
    if already_set:
        print(f"  Already linked (skipped): {already_set}")
    if missing:
        print(f"  Not found (skipped, admin_code/captain_code pair): {missing}")

    print("Done.")


if __name__ == "__main__":
    link()
