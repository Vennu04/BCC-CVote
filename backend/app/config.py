import os
from datetime import timedelta


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "bcc-cvote-dev-secret")
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "bcc-cvote-jwt-dev-secret")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=10)
    JWT_TOKEN_LOCATION = ["headers"]
    JWT_HEADER_NAME = "Authorization"
    JWT_HEADER_TYPE = "Bearer"
    MONGO_URI = os.environ.get("MONGODB_URI", "mongodb://localhost:27017/bcc_cvote")
    SENTRY_DSN = os.environ.get("SENTRY_DSN", "")
    # Reuse the same Mongo connection for rate-limit counters — the backend
    # runs 2 replicas x 2 gunicorn sync workers, so in-memory storage would
    # let a team_code's real attempt count be split up to 4 ways and never
    # actually trip the limit. Mongo storage is shared across all of them.
    RATELIMIT_STORAGE_URI = MONGO_URI
    RATELIMIT_SWALLOW_ERRORS = True  # a storage hiccup should never 500 a login
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
    # Temporary escape hatch — flip to "false" (via bcc-cvote-config configmap
    # in prod) to let captains/players log in from any device without being
    # locked to the first one, e.g. while they're testing the app across
    # multiple phones/browsers. Defaults on (the normal, enforced behavior);
    # this is meant to be flipped back once that testing period is over, not
    # a permanent removal of the feature.
    DEVICE_LOCK_ENABLED = os.environ.get("DEVICE_LOCK_ENABLED", "true").lower() == "true"
    # IST timezone (UTC+5:30)
    TIMEZONE = "Asia/Kolkata"
    # Default voting window schedule (IST)
    VOTING_OPENS_DAY = "Thursday"
    VOTING_OPENS_HOUR = 18   # 6:00 PM
    VOTING_CLOSES_DAY = "Friday"
    VOTING_CLOSES_HOUR = 20  # 8:00 PM


class DevelopmentConfig(Config):
    DEBUG = True
    TESTING = False


class StagingConfig(Config):
    DEBUG = False
    TESTING = False


class ProductionConfig(Config):
    DEBUG = False
    TESTING = False


class TestingConfig(Config):
    DEBUG = False
    TESTING = True
    # Separate database name so the test suite never touches dev/seed data,
    # even though it talks to the same mongod as docker-compose.
    MONGO_URI = os.environ.get(
        "TEST_MONGODB_URI",
        Config.MONGO_URI.rsplit("/", 1)[0] + "/bcc_cvote_test",
    )
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    # Tests hit /login repeatedly against the same team_code by design —
    # rate limiting would make the suite's pass/fail depend on run order.
    RATELIMIT_ENABLED = False


config_map = {
    "development": DevelopmentConfig,
    "staging": StagingConfig,
    "production": ProductionConfig,
    "testing": TestingConfig,
    "default": DevelopmentConfig,
}
