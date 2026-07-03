from functools import wraps
from flask import jsonify
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
from bson import ObjectId
from .. import mongo


def captain_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        identity = get_jwt_identity()
        user = mongo.db.users.find_one({"_id": ObjectId(identity), "is_active": True})
        if not user:
            return jsonify({"error": "Access denied"}), 403
        return fn(*args, **kwargs)
    return wrapper


def admin_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        verify_jwt_in_request()
        identity = get_jwt_identity()
        user = mongo.db.users.find_one({"_id": ObjectId(identity), "role": "admin", "is_active": True})
        if not user:
            return jsonify({"error": "Admin access required"}), 403
        return fn(*args, **kwargs)
    return wrapper


def get_current_user():
    identity = get_jwt_identity()
    return mongo.db.users.find_one({"_id": ObjectId(identity)})
