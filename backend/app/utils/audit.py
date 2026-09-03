"""
Unified audit trail — additive, not a replacement for the existing
specialized trails (vote_overrides, auction_release_log, admin proxy-bid/drop
notes in auction.py's _log_proxy_note). Those stay exactly as they are; this
just also gives every mutation a single collection to query across entity
types, which none of the specialized trails do individually.

Deliberately fire-and-forget: a logging failure must never fail the request
it's describing, same "swallow and continue" convention indexes.py already
uses for index creation.
"""
import logging

from .. import mongo
from .time_utils import utcnow

logger = logging.getLogger(__name__)


def log_action(user_id, action, entity_type, entity_id, old_value=None, new_value=None):
    """user_id/entity_id are stored as plain strings (not ObjectId) — this
    collection is written far more often than queried, and every caller
    already has these as strings from route params or str(_id), so keeping
    them as-is avoids a round-trip conversion at every call site."""
    try:
        mongo.db.audit_logs.insert_one({
            "user_id": str(user_id) if user_id is not None else None,
            "action": action,
            "entity_type": entity_type,
            "entity_id": str(entity_id) if entity_id is not None else None,
            "old_value": old_value,
            "new_value": new_value,
            "timestamp": utcnow(),
        })
    except Exception:
        logger.exception("log_action: failed to write audit log for action=%s entity_type=%s entity_id=%s",
                          action, entity_type, entity_id)
