"""
Run once to seed initial data:
  - 1 admin user
  - 4 fixed match slots
  - Sample captains (optional)

Usage:
  MONGODB_URI=<uri> python -m scripts.seed
  OR docker exec <container> python scripts/seed.py
"""
import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from werkzeug.security import generate_password_hash
from datetime import datetime
from pymongo import MongoClient

MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/bcc_cvote")
client = MongoClient(MONGO_URI)
db = client.get_default_database()

# ── Slots ──────────────────────────────────────────────────────────────────────
SLOTS = [
    {"slot_number": 1, "day": "Saturday", "time_of_day": "Morning",  "description": "Sat 7:00 AM – 11:00 AM"},
    {"slot_number": 2, "day": "Saturday", "time_of_day": "Evening",  "description": "Sat 3:00 PM – 7:00 PM"},
    {"slot_number": 3, "day": "Sunday",   "time_of_day": "Morning",  "description": "Sun 7:00 AM – 11:00 AM"},
    {"slot_number": 4, "day": "Sunday",   "time_of_day": "Evening",  "description": "Sun 3:00 PM – 7:00 PM"},
]

# ── Admin user ─────────────────────────────────────────────────────────────────
ADMIN = {
    "name": "BCC Organizer",
    "team_code": "ADMIN",
    "password_hash": generate_password_hash("admin@bcc2024"),
    "role": "admin",
    "is_active": True,
    "created_at": datetime.utcnow(),
}

# ── Sample captains (remove or extend as needed) ───────────────────────────────
SAMPLE_CAPTAINS = [
    {"name": "Rohit Sharma",    "team_code": "RHT"},
    {"name": "Virat Kohli",     "team_code": "VRT"},
    {"name": "MS Dhoni",        "team_code": "MSD"},
    {"name": "KL Rahul",        "team_code": "KLR"},
    {"name": "Hardik Pandya",   "team_code": "HRD"},
    {"name": "Jasprit Bumrah",  "team_code": "JSB"},
    {"name": "Shubman Gill",    "team_code": "SHG"},
    {"name": "Suryakumar Yadav","team_code": "SKY"},
    {"name": "Ravindra Jadeja", "team_code": "RVJ"},
    {"name": "Axar Patel",      "team_code": "AXR"},
]


def seed():
    print("🌱 Seeding BCC-CVote database...")

    # Slots
    if db.match_slots.count_documents({}) == 0:
        db.match_slots.insert_many(SLOTS)
        print(f"  ✅ Inserted {len(SLOTS)} match slots")
    else:
        print("  ⏭️  Slots already exist — skipping")

    # Admin
    if not db.users.find_one({"role": "admin"}):
        db.users.insert_one(ADMIN)
        print("  ✅ Admin user created (team_code: ADMIN, password: admin@bcc2024)")
    else:
        print("  ⏭️  Admin already exists — skipping")

    # Sample captains
    inserted = 0
    for captain in SAMPLE_CAPTAINS:
        if not db.users.find_one({"team_code": captain["team_code"]}):
            captain.update({
                "password_hash": generate_password_hash(captain["team_code"].lower()),
                "role": "captain",
                "is_active": True,
                "created_at": datetime.utcnow(),
            })
            db.users.insert_one(captain)
            inserted += 1

    if inserted:
        print(f"  ✅ Inserted {inserted} sample captains (default password = team_code lowercase)")
    else:
        print("  ⏭️  Sample captains already exist — skipping")

    # Indexes
    db.users.create_index("team_code", unique=True)
    db.votes.create_index([("captain_id", 1), ("slot_id", 1), ("window_id", 1)])
    db.voting_windows.create_index([("slot_id", 1), ("is_active", 1)])
    db.weather_cache.create_index([("slot_id", 1), ("target_date", 1)], unique=True)
    db.password_resets.create_index([("target_user_id", 1), ("reset_at", -1)])
    print("  ✅ Indexes ensured")
    print("🏏 Seed complete!")


if __name__ == "__main__":
    seed()
