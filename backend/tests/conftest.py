import pytest
from datetime import datetime, timedelta
from bson import ObjectId
from werkzeug.security import generate_password_hash
from flask_jwt_extended import create_access_token

from app import create_app, mongo


def _wipe_test_db():
    for name in mongo.db.list_collection_names():
        mongo.db[name].delete_many({})


@pytest.fixture()
def app():
    application = create_app("testing")
    with application.app_context():
        _wipe_test_db()  # in case a previous run crashed mid-test
        yield application
        _wipe_test_db()


@pytest.fixture()
def client(app):
    return app.test_client()


def _insert_user(role, team_code, password, **extra):
    doc = {
        "name": extra.pop("name", team_code.title()),
        "team_code": team_code.upper(),
        "password_hash": generate_password_hash(password),
        "role": role,
        "is_active": extra.pop("is_active", True),
        "created_at": datetime.utcnow(),
        **extra,
    }
    result = mongo.db.users.insert_one(doc)
    doc["_id"] = result.inserted_id
    return doc


@pytest.fixture()
def make_user(app):
    """Insert a user straight into Mongo (bypassing the admin API) — tests
    that aren't exercising add_captain/add_player itself just need a user
    to already exist."""
    return _insert_user


@pytest.fixture()
def admin_user(app):
    return _insert_user("admin", "ADMIN", "admin@bcc2024")


def _token_for(app, user):
    with app.app_context():
        return create_access_token(identity=str(user["_id"]))


@pytest.fixture()
def auth_header(app):
    def _make(user):
        return {"Authorization": f"Bearer {_token_for(app, user)}"}
    return _make


@pytest.fixture()
def admin_headers(app, admin_user, auth_header):
    return auth_header(admin_user)


@pytest.fixture()
def make_slot_and_window(app):
    """A match slot with a currently-open voting window — the minimum an
    auction needs to exist against."""
    def _make(**window_overrides):
        slot = {
            "slot_number": 1, "day": "Saturday", "time_of_day": "Morning",
            "match_time": "06:15 AM", "description": "", "is_adhoc": False,
            "is_active": True, "created_at": datetime.utcnow(),
        }
        slot_id = mongo.db.match_slots.insert_one(slot).inserted_id
        window = {
            "slot_id": str(slot_id),
            "opens_at": datetime.utcnow() - timedelta(hours=1),
            "closes_at": datetime.utcnow() + timedelta(hours=1),
            "is_active": True,
            "created_at": datetime.utcnow(),
            **window_overrides,
        }
        window_id = mongo.db.voting_windows.insert_one(window).inserted_id
        return str(slot_id), str(window_id)
    return _make


@pytest.fixture()
def make_vote(app):
    def _make(captain_id, slot_id, window_id, availability="available"):
        mongo.db.votes.insert_one({
            "captain_id": str(captain_id), "slot_id": slot_id, "window_id": window_id,
            "availability": availability, "voted_at": datetime.utcnow(),
        })
    return _make


@pytest.fixture()
def make_auction_setup(app, make_user, make_slot_and_window, make_vote):
    """Two captains running the draft + a pool of voters with averages and
    categories assigned, evenly split per category (create_auction rejects
    odd splits) — everything /admin/auction/create needs to succeed."""
    def _make(pool_spec):
        """pool_spec: list of (category, batting_avg, bowling_avg) tuples,
        must have an even count per category."""
        slot_id, window_id = make_slot_and_window()
        captain_a = _insert_user("captain", "CAPA", "capa", name="Captain A")
        captain_b = _insert_user("captain", "CAPB", "capb", name="Captain B")

        voters = []
        for i, (category, bat, bowl) in enumerate(pool_spec):
            voter = _insert_user(
                "player", f"PLR{i}", f"plr{i}", name=f"Player{i}",
                auction_category=category, batting_average=bat, bowling_average=bowl,
            )
            make_vote(voter["_id"], slot_id, window_id, "available")
            voters.append(voter)

        return {
            "slot_id": slot_id, "window_id": window_id,
            "captain_a": captain_a, "captain_b": captain_b, "voters": voters,
        }
    return _make
