"""
Create an organizer or viewer account (the two new roles added alongside
admin/captain/player). Unlike grant_admin_access.py (which layers is_admin
onto an *existing* captain/player login), organizer/viewer are their own
direct logins with their own team_code — same shape as seed.py's ADMIN doc.

Usage:
  docker exec bcc-backend python scripts/create_staff_account.py \
      --role organizer --name "Match Organizer" --team-code ORG1 --password <temp-password>

  docker exec bcc-backend python scripts/create_staff_account.py \
      --role viewer --name "Public Viewer" --team-code VIEW1 --password <temp-password>

role must be "organizer" or "viewer" — use grant_admin_access.py for full admin.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime import datetime
from pymongo import MongoClient
from werkzeug.security import generate_password_hash

from app.utils.passwords import validate_password

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/bcc_cvote")
client = MongoClient(MONGO_URI)
db = client.get_default_database()


def create(role, name, team_code, password):
    if role not in ("organizer", "viewer"):
        print(f"Refusing: role must be 'organizer' or 'viewer' (got {role!r})")
        return
    team_code = team_code.strip().upper()
    if db.users.find_one({"team_code": team_code}):
        print(f"Refusing: team_code {team_code} already exists")
        return
    password_error = validate_password(password)
    if password_error:
        print(f"Refusing: {password_error}")
        return

    doc = {
        "name": name,
        "team_code": team_code,
        "password_hash": generate_password_hash(password),
        "role": role,
        "is_active": True,
        "must_change_password": True,
        "created_at": datetime.utcnow(),
    }
    db.users.insert_one(doc)
    print(f"Created {role} account: team_code={team_code}, name={name!r}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--role", required=True, choices=["organizer", "viewer"])
    parser.add_argument("--name", required=True)
    parser.add_argument("--team-code", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()
    create(args.role, args.name, args.team_code, args.password)
