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
    FRONTEND_URL = os.environ.get("FRONTEND_URL", "http://localhost:5173")
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


config_map = {
    "development": DevelopmentConfig,
    "staging": StagingConfig,
    "production": ProductionConfig,
    "default": DevelopmentConfig,
}
