from flask import Blueprint, request, jsonify
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import check_password_hash
from .. import mongo
from ..utils.auth import get_current_user

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}
    team_code = (data.get("team_code") or "").strip().upper()
    password = data.get("password") or ""

    if not team_code or not password:
        return jsonify({"error": "team_code and password are required"}), 400

    user = mongo.db.users.find_one({"team_code": team_code, "is_active": True})
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid team code or password"}), 401

    token = create_access_token(identity=str(user["_id"]))
    return jsonify({
        "access_token": token,
        "user": {
            "id": str(user["_id"]),
            "name": user["name"],
            "team_code": user["team_code"],
            "role": user["role"],
        }
    })


@auth_bp.route("/me", methods=["GET"])
@jwt_required()
def me():
    user = get_current_user()
    if not user:
        return jsonify({"error": "User not found"}), 404
    return jsonify({
        "id": str(user["_id"]),
        "name": user["name"],
        "team_code": user["team_code"],
        "role": user["role"],
    })


@auth_bp.route("/logout", methods=["POST"])
@jwt_required()
def logout():
    # JWT is stateless; client discards token. Future: add blocklist here.
    return jsonify({"message": "Logged out successfully"})
