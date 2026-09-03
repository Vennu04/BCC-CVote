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
        # viewer is a brand-new, read-only role (no existing account has it)
        # — explicitly barred from every voting/auction action gated by this
        # decorator, same as the spec's "no vote/bid rights" requirement.
        if user.get("role") == "viewer":
            return jsonify({"error": "Access denied"}), 403
        return fn(*args, **kwargs)
    return wrapper


# Permission map for staff-only routes. "manage" covers ordinary admin
# operations; "destructive" is the narrow subset the user's improvement plan
# calls out by name (delete captain/player, reset device, close-window-early)
# that organizer accounts must NOT get. Keyed by string so routes read as
# @requires("destructive") rather than importing role tuples directly.
PERMISSIONS = {
    "manage": ("admin", "organizer"),
    "destructive": ("admin",),
}


def requires(perm):
    """Permission-based staff decorator. role=="admin" (or the legacy
    is_admin=True cross-flag — unchanged meaning, still full admin) always
    passes both perms; role=="organizer" passes "manage" only.
    """
    allowed_roles = PERMISSIONS[perm]

    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            identity = get_jwt_identity()
            user = mongo.db.users.find_one({"_id": ObjectId(identity), "is_active": True})
            if not user or not _token_version_matches(user):
                return jsonify({"error": "Admin access required"}), 403
            is_full_admin = user.get("role") == "admin" or user.get("is_admin") is True
            ok = is_full_admin or user.get("role") in allowed_roles
            if not ok:
                return jsonify({"error": "Admin access required"}), 403
            return fn(*args, **kwargs)
        return wrapper
    return decorator


# admin_required is kept as the existing name (used by ~50 routes already)
# so this stays a one-line widening rather than a 50-callsite rename:
# organizer accounts now pass every route that used to be admin-only, except
# the handful re-decorated with admin_only_required below.
admin_required = requires("manage")
admin_only_required = requires("destructive")


def get_current_user():
    identity = get_jwt_identity()
    user = mongo.db.users.find_one({"_id": ObjectId(identity)})
    if not user or not _token_version_matches(user):
        return None
    return user
