import logging

logger = logging.getLogger(__name__)

# Single source of truth for every index this app relies on — audited against
# the real .find()/.find_one()/.update_one() filters in routes/ and services/
# (not guessed), and reconciled with what scripts/seed.py had already
# established independently (team_code and weather_cache's uniqueness in
# particular came from there, not from this audit). seed.py imports and
# calls this same function rather than keeping its own separate list, so the
# two can't drift apart again.
#
# Left uncovered on purpose: match_slots (tiny, only ever filtered by a
# not-very-selective $ne), auctions (every lookup is by _id, already
# indexed automatically), vote_overrides (write-only audit log, never
# queried back).
INDEX_SPECS = [
    ("users", "team_code", {"unique": True}),
    ("voting_windows", [("slot_id", 1), ("is_active", 1)], {}),
    ("votes", [("slot_id", 1), ("window_id", 1), ("captain_id", 1)], {}),
    ("weather_cache", [("slot_id", 1), ("target_date", 1)], {"unique": True}),
    ("password_resets", [("target_user_id", 1), ("reset_at", -1)], {}),
    ("auction_players", "auction_id", {}),
    ("auction_bids", "auction_id", {}),
    ("auction_release_log", "auction_id", {}),
    ("attendance_credits", [("slot_id", 1), ("window_id", 1)], {}),
    ("league_matches", "created_at", {}),
]


def ensure_indexes(db):
    """create_index() is idempotent — an index that already exists with the
    same key spec is a fast no-op — so it's safe to call this on every app
    boot (every gunicorn worker, every pod, every deploy) rather than
    needing a separate one-off migration step this project has no tooling
    for. Each spec is applied independently: a real conflict on one (e.g.
    unique=True on team_code hitting genuine duplicate data) shouldn't also
    block the other nine, unrelated indexes from being created. `db` is a
    plain pymongo Database — works for both flask_pymongo's `mongo.db` and
    scripts/seed.py's plain MongoClient().get_default_database().
    """
    for collection, keys, options in INDEX_SPECS:
        try:
            db[collection].create_index(keys, **options)
        except Exception:
            logger.exception("ensure_indexes: failed on %s%s — continuing with the rest", collection, keys)
