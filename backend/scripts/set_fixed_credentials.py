"""
One-off migration: assign the real, admin-approved userid to every active
captain/player (never admin) from a fixed name -> code mapping, plus one
shared default password for everyone's first login. Unlike
regenerate_credentials.py, this does NOT generate anything — the codes below
are exactly what admin already checked for duplicates and is about to
distribute, verbatim.

Sets must_change_password=True (same mechanism the admin-driven single-account
reset already uses) so nobody can touch the app beyond the forced "set your
own password" screen until they've done so, and unsets device_id — a stale
binding from before the login changed would otherwise lock out whatever phone
someone tries first.

The shared default password is only ever this one value, so unlike
regenerate_credentials.py there's no per-user secret to protect via STDOUT-only
output — the userid list is printed directly since it's not sensitive on its
own (the shared password is what's confidential, not the codes).

Usage:
  docker exec bcc-backend python scripts/set_fixed_credentials.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from pymongo import MongoClient
from werkzeug.security import generate_password_hash

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/bcc_cvote")
client = MongoClient(MONGO_URI)
db = client.get_default_database()

DEFAULT_PASSWORD = "Welcome123"

# name (lowercase) -> new userid, exactly as admin pre-approved.
NAME_TO_CODE = {
    "abhi": "ABHI",
    "arogyaraju": "ARAJU",
    "bablu": "BBLU",
    "bharath": "BHTH",
    "bhimesh": "BHEM",
    "bunny": "BUNY",
    "chaitanya": "KCRJ",
    "hardik": "HARD",
    "kalyan": "KLYN",
    "madhu": "MDHU",
    "mallesh": "THLA",
    "mani": "MANI",
    "nagendra": "BABU",
    "naidu": "NIDU",
    "naidu p": "NIDP",
    "narasimha": "NSMA",
    "narayana": "BNC18",
    "neeraj": "NEEJ",
    "nirup": "NIRP",
    "p raju": "PRAJ",
    "pandu": "PNDU",
    "pavan": "PAVN",
    "phanikumar": "PHNI",
    "prasath": "PRSH",
    "praveen reddy": "PREDY",
    "punny": "PUNY",
    "raghavendra": "RGVN",
    "rahul": "RHUL",
    "rajesh": "RJSH",
    "rajesh new": "NRJS",
    "ram prasad": "PRSD",
    "ramesh d": "RMSD",
    "ramu kuna": "KUNA",
    "ramu patel": "RPTL",
    "ravi": "RAVI",
    "sadanand": "SADA",
    "saireddy": "SAIR",
    "satya prakash": "SPSH",
    "shankar": "THALA2",
    "shareef": "SHAR",
    "shashi": "SHSH",
    "shekar sri": "SHRI",
    "shivudu": "SHVA",
    "shoyeb": "SHOY",
    "sridhar": "SRDH",
    "srikanth k": "SRKK",
    "srikanth m": "SRKM",
    "srinu": "SRNU",
    "sudhakar": "SUKR",
    "suresh": "SUMD",
    "vasu": "VASU",
    "venkat": "VNKT",
    "venkataramana": "VRNA",
    "vinod": "VNOD",
}


def apply():
    codes = list(NAME_TO_CODE.values())
    dupes = {c for c in codes if codes.count(c) > 1}
    if dupes:
        print(f"ABORTING — duplicate codes within the mapping itself: {sorted(dupes)}")
        return

    targets = list(db.users.find({"role": {"$in": ["captain", "player"]}, "is_active": True}))
    print(f"{len(targets)} active captain/player account(s) found in the database.")

    matched_names = set()
    unmatched_db = []
    for user in targets:
        key = user["name"].strip().lower()
        if key in NAME_TO_CODE:
            matched_names.add(key)
        else:
            unmatched_db.append(user["name"])

    unmatched_mapping = [name for name in NAME_TO_CODE if name not in matched_names]

    if unmatched_db:
        print(f"WARNING — {len(unmatched_db)} active account(s) have no code in the mapping, "
              f"left untouched: {unmatched_db}")
    if unmatched_mapping:
        print(f"WARNING — {len(unmatched_mapping)} name(s) in the mapping matched no active account, "
              f"skipped: {unmatched_mapping}")

    updated = []
    for user in targets:
        key = user["name"].strip().lower()
        code = NAME_TO_CODE.get(key)
        if not code:
            continue
        db.users.update_one(
            {"_id": user["_id"]},
            {
                "$set": {
                    "team_code": code,
                    "password_hash": generate_password_hash(DEFAULT_PASSWORD),
                    "must_change_password": True,
                },
                "$inc": {"token_version": 1},
                "$unset": {"device_id": ""},
            },
        )
        updated.append((user["name"], code))

    print(f"\nDone — {len(updated)} account(s) updated with their assigned userid and the shared "
          f"default password '{DEFAULT_PASSWORD}'. must_change_password is set on all of them and "
          f"every existing session/device binding has been invalidated, so the forced reset screen "
          f"is active before anyone can vote. Safe to distribute the userid list below, alongside "
          f"'{DEFAULT_PASSWORD}', to everyone ahead of tomorrow's first match vote.")
    print("\nUserid list:")
    for name, code in sorted(updated, key=lambda x: x[0]):
        print(f"  {name}: {code}")


if __name__ == "__main__":
    apply()
