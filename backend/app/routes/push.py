from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import jwt_required

from .. import mongo
from ..utils.auth import get_current_user
from ..utils.time_utils import utcnow

push_bp = Blueprint("push", __name__)


@push_bp.route("/push/vapid-public-key", methods=["GET"])
def vapid_public_key():
    # Public by design — this is meant to be embedded in client JS, same as
    # any VAPID application server key.
    return jsonify({"key": current_app.config.get("VAPID_PUBLIC_KEY", "")})


@push_bp.route("/push/subscribe", methods=["POST"])
@jwt_required()
def subscribe():
    user = get_current_user()
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json(silent=True) or {}
    endpoint = data.get("endpoint")
    keys = data.get("keys") or {}
    if not endpoint or not keys.get("p256dh") or not keys.get("auth"):
        return jsonify({"error": "endpoint and keys.p256dh/keys.auth are required"}), 400

    # Keyed on endpoint, not user — the same browser subscription can only
    # ever belong to one user at a time, but a user may have several
    # (phone + laptop), so upsert-by-endpoint rather than one row per user.
    mongo.db.push_subscriptions.update_one(
        {"endpoint": endpoint},
        {
            "$set": {
                "user_id": user["_id"],
                "endpoint": endpoint,
                "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]},
                "updated_at": utcnow(),
            },
            "$setOnInsert": {"created_at": utcnow()},
        },
        upsert=True,
    )
    return jsonify({"status": "subscribed"}), 200


@push_bp.route("/push/unsubscribe", methods=["POST"])
@jwt_required()
def unsubscribe():
    data = request.get_json(silent=True) or {}
    endpoint = data.get("endpoint")
    if not endpoint:
        return jsonify({"error": "endpoint is required"}), 400
    mongo.db.push_subscriptions.delete_one({"endpoint": endpoint})
    return jsonify({"status": "unsubscribed"}), 200
