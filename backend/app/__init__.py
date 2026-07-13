import os
import sentry_sdk
from sentry_sdk.integrations.flask import FlaskIntegration
from flask import Flask, jsonify
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from flask_pymongo import PyMongo
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from .config import config_map
from .indexes import ensure_indexes

mongo = PyMongo()
jwt = JWTManager()
# Default key is remote IP; login/reset-password override this per-route to
# key on team_code instead (see routes/auth.py) — CloudFront/Traefik/nginx
# sit in front of this app and remote_addr isn't verified against a trusted
# proxy chain here, so IP-keying alone would be unreliable for the one place
# it actually matters (brute-forcing a specific account).
limiter = Limiter(key_func=get_remote_address)


def create_app(config_name: str = None) -> Flask:
    if config_name is None:
        config_name = os.environ.get("FLASK_ENV", "development")

    app = Flask(__name__)
    app.config.from_object(config_map.get(config_name, config_map["default"]))

    # No-ops if SENTRY_DSN is unset (local/dev without the secret configured).
    # send_default_pii stays off (the default) — this app's request bodies
    # carry passwords/team codes, and Sentry shouldn't ever see those.
    if app.config["SENTRY_DSN"]:
        sentry_sdk.init(
            dsn=app.config["SENTRY_DSN"],
            environment=config_name,
            integrations=[FlaskIntegration()],
            traces_sample_rate=0,
        )

    # CORS — allow frontend origin
    CORS(app, resources={r"/api/*": {"origins": app.config["FRONTEND_URL"]}},
         supports_credentials=True)

    mongo.init_app(app)
    jwt.init_app(app)
    limiter.init_app(app)

    if app.config["ENSURE_INDEXES"]:
        ensure_indexes(mongo.db)

    # JWT error handlers
    @jwt.invalid_token_loader
    def invalid_token_callback(error):
        return jsonify({"error": "Invalid token"}), 401

    @jwt.expired_token_loader
    def expired_token_callback(jwt_header, jwt_payload):
        return jsonify({"error": "Token has expired"}), 401

    @jwt.unauthorized_loader
    def missing_token_callback(error):
        return jsonify({"error": "Authorization token required"}), 401

    # Blueprints
    from .routes.auth import auth_bp
    from .routes.votes import votes_bp
    from .routes.admin import admin_bp
    from .routes.auction import auction_bp

    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(votes_bp, url_prefix="/api")
    app.register_blueprint(admin_bp, url_prefix="/api/admin")
    app.register_blueprint(auction_bp, url_prefix="/api")

    @app.route("/health")
    def health():
        return jsonify({"status": "ok", "app": "BCC-CVote", "version": "1.0.0"})

    @app.errorhandler(404)
    def not_found(e):
        return jsonify({"error": "Resource not found"}), 404

    @app.errorhandler(500)
    def server_error(e):
        return jsonify({"error": "Internal server error"}), 500

    return app
