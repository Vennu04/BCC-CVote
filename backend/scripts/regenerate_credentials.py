"""
One-off migration: regenerate login credentials for every active captain and
player (never admin accounts) — a fresh random 4-letter team_code plus a
fresh random 8-character password, replacing whatever each account had
before. Also sets must_change_password=True (same mechanism the admin-driven
single-account reset already uses), so nobody can touch the app beyond the
forced "set your own password" screen until they've done so, and unsets
device_id — a stale binding from before the login changed would otherwise
lock out whatever phone someone tries first.

The generated passwords are never stored anywhere except this run's STDOUT —
password_hash is all that ends up in the database, same as every other
password path in this app. That makes STDOUT the one and only place the
plaintext exists, so redirect it straight into the file you're going to
distribute from:

  docker exec bcc-backend python scripts/regenerate_credentials.py > credentials.csv

Progress and the final confirmation go to STDERR instead, so they show up on
screen without polluting the CSV.

Usage:
  docker exec bcc-backend python scripts/regenerate_credentials.py > credentials.csv
"""
import csv
import os
import secrets
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from pymongo import MongoClient
from werkzeug.security import generate_password_hash

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/bcc_cvote")
client = MongoClient(MONGO_URI)
db = client.get_default_database()

CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
# Same alphabet passwords.py's generate_temp_password() uses — excludes
# visually ambiguous characters (0/O, 1/l/I) since these get read off a
# screen and typed on a phone, not read aloud, but ambiguity is still the
# real risk at 8 random characters.
PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789"


def _unique_code(existing_codes):
    while True:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(4))
        if code not in existing_codes:
            existing_codes.add(code)
            return code


def _generate_password(length=8):
    return "".join(secrets.choice(PASSWORD_ALPHABET) for _ in range(length))


def regenerate():
    # Snapshot every team_code in use right now — including admins', who are
    # never touched — so a newly generated code can never collide with
    # anything already in the unique index, before or after this run.
    existing_codes = {u["team_code"] for u in db.users.find({}, {"team_code": 1})}
    targets = list(db.users.find({"role": {"$in": ["captain", "player"]}, "is_active": True}))

    print(f"Regenerating credentials for {len(targets)} active captain/player account(s)...", file=sys.stderr)

    rows = []
    for user in targets:
        new_code = _unique_code(existing_codes)
        new_password = _generate_password()
        db.users.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "team_code": new_code,
                    "password_hash": generate_password_hash(new_password),
                    "must_change_password": True,
                },
                "$inc": {"token_version": 1},
                "$unset": {"device_id": ""},
            },
        )
        rows.append({
            "name": user["name"],
            "role": user["role"],
            "team_name": user.get("team_name", ""),
            "login": new_code,
            "password": new_password,
        })

    writer = csv.DictWriter(sys.stdout, fieldnames=["name", "role", "team_name", "login", "password"])
    writer.writeheader()
    writer.writerows(rows)
    sys.stdout.flush()

    print(
        f"Done — {len(rows)} account(s) regenerated. must_change_password is set on all of "
        f"them and every existing session/device binding has been invalidated, so the forced "
        f"reset screen is active before anyone can vote. Safe to start distributing the CSV "
        f"above now — this is the only place these passwords will ever be shown.",
        file=sys.stderr,
    )


if __name__ == "__main__":
    regenerate()
