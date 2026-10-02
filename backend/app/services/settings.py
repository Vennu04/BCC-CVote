"""
Admin-editable auction rules (All tools › Settings), so changing the purse,
base price, clocks or pool limits never needs a developer or a new build.

Stored as one document in `app_settings` ({_id: "auction_rules"}); any rule
not saved there falls back to the default below (the values the app always
used). An auction copies the rules it needs when it is created/started, so
editing a rule never changes an auction that is already under way.
"""
from .. import mongo

RULES_DOC_ID = "auction_rules"

# key: (default, type, min, max, label)
AUCTION_RULES = {
    "points_budget": (17, float, 1, 200, "Purse per captain (points)"),
    "starting_price": (8.5, float, 0, 100, "Base price per player"),
    "session_minutes": (25, int, 5, 180, "Auction clock (minutes)"),
    "release_timeout_seconds": (30, int, 10, 600, "Time to bid or drop a player (seconds)"),
    "min_pool_size": (20, int, 2, 60, "Fewest players needed for an auction"),
    "max_per_side": (14, int, 1, 40, "Most players per side"),
}


def get_auction_rules():
    saved = mongo.db.app_settings.find_one({"_id": RULES_DOC_ID}) or {}
    return {key: saved.get(key, spec[0]) for key, spec in AUCTION_RULES.items()}


def validate_auction_rules(data):
    """Returns (clean_updates, error). Only known keys; each within its range;
    and the minimum pool must fit within the per-side maximum."""
    clean = {}
    for key, value in (data or {}).items():
        if key not in AUCTION_RULES:
            return None, f"Unknown setting: {key}"
        default, kind, lo, hi, label = AUCTION_RULES[key]
        try:
            number = kind(value)
        except (TypeError, ValueError):
            return None, f"{label} must be a number"
        if kind is int and float(value) != number:
            return None, f"{label} must be a whole number"
        if not lo <= number <= hi:
            return None, f"{label} must be between {lo} and {hi}"
        clean[key] = number
    merged = {**get_auction_rules(), **clean}
    if merged["min_pool_size"] > 2 * merged["max_per_side"]:
        return None, "The fewest players needed can't be more than twice the most per side"
    return clean, None


def save_auction_rules(clean):
    mongo.db.app_settings.update_one({"_id": RULES_DOC_ID}, {"$set": clean}, upsert=True)
    return get_auction_rules()
