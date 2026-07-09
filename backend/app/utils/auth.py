from functools import wraps
from flask import jsonify
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity, get_jwt
from bson import ObjectId
from .. import mongo


def _token_version_matches(user):
    """A token embeds the token_version that was current at login. Bumping
    the DB value (on any password change) makes every token issued before
    that moment fail this check instantly — the app's only session-revocation
    mechanism, since JWTs are otherwise stateless and there's no blocklist."""
    return get_jwt().get("token_version", 0) == user.get("token_version", 0)


def captain_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        identity = get_jwt_identity()
        user = mongo.db.users.find_one({"_id": ObjectId(identity), "is_active": True})
        if not user or not _token_version_matches(user):
            return jsonify({"error": "Access denied"}), 403
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        identity = get_jwt_identity()
        user = mongo.db.users.find_one({"_id": ObjectId(identity), "role": "admin", "is_active": True})
        if not user or not _token_version_matches(user):
            return jsonify({"error": "Admin access required"}), 403
        return fn(*args, **kwargs)
    return wrapper


def get_current_user():
    identity = get_jwt_identity()
    user = mongo.db.users.find_one({"_id": ObjectId(identity)})
    if not user or not _token_version_matches(user):
        return None
    return user
