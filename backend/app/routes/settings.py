from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from ..services.settings import AUCTION_RULES, get_auction_rules, validate_auction_rules, save_auction_rules
from ..utils.audit import log_action
from ..utils.auth import admin_only_required

settings_bp = Blueprint("settings", __name__)


# Everyone can read the rules (the auction rules page shows them to players).
@settings_bp.route("/settings/auction-rules", methods=["GET"])
@jwt_required()
def read_rules():
    return jsonify({
        "rules": get_auction_rules(),
        "fields": [{"key": k, "label": spec[4], "min": spec[2], "max": spec[3],
                    "step": 0.5 if spec[1] is float else 1, "default": spec[0]}
                   for k, spec in AUCTION_RULES.items()],
    })


@settings_bp.route("/admin/settings/auction-rules", methods=["PUT"])
@admin_only_required
def update_rules():
    before = get_auction_rules()
    clean, error = validate_auction_rules(request.get_json(silent=True) or {})
    if error:
        return jsonify({"error": error}), 400
    if not clean:
        return jsonify({"error": "Nothing to save"}), 400
    after = save_auction_rules(clean)
    log_action(get_jwt_identity(), "update", "auction_rules", "auction_rules",
               old_value={k: before[k] for k in clean}, new_value=clean)
    return jsonify({"message": "Rules saved — they apply to the next auction", "rules": after})
