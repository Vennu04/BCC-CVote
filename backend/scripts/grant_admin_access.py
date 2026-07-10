"""
One-off migration: grant admin capability to specific existing captain/player
accounts, by team_code, without changing their role or touching their login.
Reverse of flag_admin_voters.py (which lets an admin account also vote) — here
a captain/player also gets admin capability, checked by admin_required's
"$or": [{"role": "admin"}, {"is_admin": True}].

No token_version bump needed — admin_required looks the account up fresh on
every request rather than trusting anything baked into the JWT, so this takes
effect on the very next request. An already-open frontend session just won't
see the Admin nav links until it re-fetches /auth/me (reload or re-login).

Usage:
  docker exec bcc-backend python scripts/grant_admin_access.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from pymongo import MongoClient

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/bcc_cvote")
client = MongoClient(MONGO_URI)
db = client.get_default_database()

TEAM_CODES = ["SUMD", "SRKM", "SHSH", "BNC18"]


def grant():
    granted, already_set, missing, wrong_role = [], [], [], []

    for team_code in TEAM_CODES:
        user = db.users.find_one({"team_code": team_code})
        if not user:
            missing.append(team_code)
            continue
        if user["role"] not in ("captain", "player"):
            wrong_role.append((team_code, user["role"]))
            continue
        if user.get("is_admin"):
            already_set.append((team_code, user["name"]))
            continue
        db.users.update_one({"_id": user["_id"]}, {"$set": {"is_admin": True}})
        granted.append((team_code, user["name"]))

    print(f"Granted admin access to {len(granted)}: {granted}")
    if already_set:
        print(f"Already had it (skipped): {already_set}")
    if missing:
        print(f"Not found (skipped): {missing}")
    if wrong_role:
        print(f"Skipped — role not captain/player: {wrong_role}")
    print("Done.")


if __name__ == "__main__":
    grant()
