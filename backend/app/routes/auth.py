from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import check_password_hash, generate_password_hash
from .. import mongo
from ..utils.auth import get_current_user

auth_bp = Blueprint("auth", __name__)


def _user_summary(user):
    summary = {
        "id": str(user["_id"]),
        "name": user["name"],
        "team_code": user["team_code"],
        "role": user["role"],
        "is_player": True if user["role"] == "captain" else user.get("is_player", False),
        "must_change_password": user.get("must_change_password", False),
    }
    if user["role"] == "captain":
        summary.update({
            "team_name": user.get("team_name", ""),
            "matches_scheduled": user.get("matches_scheduled", 0),
            "matches_played": user.get("matches_played", 0),
            "tournament_status": user.get("tournament_status", "not_played"),
        })
    return summary


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    team_code = (data.get("team_code") or "").strip().upper()
    password = data.get("password") or ""
    device_id = (data.get("device_id") or "").strip()

    if not team_code or not password:
        return jsonify({"error": "team_code and password are required"}), 400

    user = mongo.db.users.find_one({"team_code": team_code, "is_active": True})
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid team code or password"}), 401

    # Device lock only applies to captains/players — admin needs to be able to
    # manage the app from any device. First login for an account registers
    # whatever device it's on; every later login must match, or be rejected —
    # ask admin for a reset (e.g. after getting a new phone) rather than a
    # silent bypass.
    if user["role"] != "admin" and device_id:
        bound_device = user.get("device_id")
        if bound_device and bound_device != device_id:
            return jsonify({
                "error": "This account is already registered to another device. "
                         "Ask your admin to reset device access if you've switched phones."
            }), 403
        if not bound_device:
            mongo.db.users.update_one({"_id": user["_id"]}, {"$set": {"device_id": device_id}})

    token = create_access_token(identity=str(user["_id"]))
    return jsonify({
        "access_token": token,
        "user": _user_summary(user),
    })


@auth_bp.route("/change-password", methods=["POST"])
@jwt_required()
def change_password():
    user = get_current_user()
    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json(silent=True) or {}
    current_password = data.get("current_password") or ""
    new_password = data.get("new_password") or ""

    if not check_password_hash(user["password_hash"], current_password):
        return jsonify({"error": "Current password is incorrect"}), 401
    if len(new_password) < 4:
        return jsonify({"error": "New password must be at least 4 characters"}), 400
    if check_password_hash(user["password_hash"], new_password):
        return jsonify({"error": "New password must be different from your current password"}), 400

    mongo.db.users.update_one(
        {"_id": user["_id"]},
        {"$set": {"password_hash": generate_password_hash(new_password), "must_change_password": False}},
    )
    return jsonify({"message": "Password updated"})


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    user = get_current_user()
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify(_user_summary(user))


@auth_bp.route("/logout", methods=["POST"])
@jwt_required()
def logout():
    # JWT is stateless; client discards token. Future: add blocklist here.
    return jsonify({"message": "Logged out successfully"})
