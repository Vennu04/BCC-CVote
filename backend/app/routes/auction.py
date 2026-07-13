from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required
from bson import ObjectId
from datetime import datetime, timedelta

from .. import mongo
from ..utils.auth import admin_required, get_current_user
from ..utils.time_utils import format_ist, to_iso_utc
from ..services.next_match import next_match_context, next_match_label

auction_bp = Blueprint("auction", __name__)

# Every auctioned player sits in exactly one of these four groups, each split evenly
# in half between the two captains (Extra Power is two independent sections, not one
# combined pool — see admin's rules).
AUCTION_GROUPS = ("extra_power_allrounder", "extra_power_batsman", "power", "classic")
POINTS_BUDGET = 17
STARTING_PRICE = 8.5
TARGET_ROSTER_SIZE = 11
SESSION_MINUTES = 25
MIN_AUCTION_POOL_SIZE = 20  # a side can field 10, per admin's call — no longer requiring a full XI
MAX_ROSTER_SIZE_PER_SIDE = 15

# Release order within a category is driven by batting/bowling stats, not admin
# choice (admin can only pick WHICH CATEGORY to release from next, never which
# player within it — see release_player).
#
# extra_power_batsman is graded on batting only (this is the one group that's
# explicitly a pure-batting pool). The other three groups (extra_power_allrounder,
# power, classic) are graded on both skills combined via a direct signed sum:
# battingAverage - bowlingAverage as the primary key, strikeRate - economy as
# the secondary key (admin's explicit call — simple to reason about, though it
# means a stat with larger typical magnitude has more pull on the ranking).
# Any remaining tie is broken by attendance_percentage descending.
BATSMAN_ONLY_GROUPS = ("extra_power_batsman",)


def _get_active_window(slot_id):
    return mongo.db.voting_windows.find_one({"slot_id": slot_id, "is_active": True})


def _auction_or_404(auction_id):
    try:
        return mongo.db.auctions.find_one({"_id": ObjectId(auction_id)})
    except Exception:
        return None


def _player_doc(auction_id, player_id):
    try:
        return mongo.db.auction_players.find_one({"_id": ObjectId(player_id), "auction_id": auction_id})
    except Exception:
        return None


def _captain_counts(auction, captain_id, group):
    """(count, points spent) for one captain within one group — sold_to is only ever
    set once a player leaves "available", so this needs no extra status filter."""
    players = list(mongo.db.auction_players.find({
        "auction_id": str(auction["_id"]), "category": group, "sold_to": captain_id,
    }))
    return len(players), sum(p.get("sold_price") or 0 for p in players)


def _group_quota(auction, group):
    total = mongo.db.auction_players.count_documents({"auction_id": str(auction["_id"]), "category": group})
    return total // 2


def _captain_points_remaining(auction, captain_id):
    """The 17-point purse only ever pays for the EXTRA bid amount above each
    player's 8.5 base price — the base itself is never drawn from it. A player
    won at 15 (8.5 base + 6.5 extra) costs the winning captain 6.5 points, not
    15. Leftover-free/free-pick wins (sold_price=0) never touch the purse."""
    spent = sum(
        (p.get("sold_price") or 0) - auction["starting_price"]
        for p in mongo.db.auction_players.find({"auction_id": str(auction["_id"]), "sold_to": captain_id})
        if p.get("assigned_via") == "bid"
    )
    return auction["points_budget"] - spent


def _check_leftover_award(auction, group):
    """The instant either captain's count in this group hits quota, every player still
    "available" in the group instantly transfers to the OTHER captain for free — no
    further bidding possible on them."""
    quota = _group_quota(auction, group)
    if quota == 0:
        return
    for captain_id, other_id in (
        (auction["captain_a_id"], auction["captain_b_id"]),
        (auction["captain_b_id"], auction["captain_a_id"]),
    ):
        count, _ = _captain_counts(auction, captain_id, group)
        if count < quota:
            continue
        remaining = list(mongo.db.auction_players.find({
            "auction_id": str(auction["_id"]), "category": group, "status": "available",
        }))
        if not remaining:
            continue
        now = datetime.utcnow()
        remaining_ids = [str(p["_id"]) for p in remaining]
        for p in remaining:
            mongo.db.auction_players.update_one(
                {"_id": p["_id"]},
                {"$set": {"status": "free_assigned", "sold_to": other_id,
                          "sold_price": 0, "assigned_via": "leftover_free"}},
            )
            mongo.db.auction_bids.insert_one({
                "auction_id": str(auction["_id"]), "player_id": str(p["_id"]),
                "captain_id": other_id, "action": "leftover_free", "amount": 0,
                "created_at": now,
            })
        if auction.get("current_player_id") in remaining_ids:
            mongo.db.auctions.update_one({"_id": auction["_id"]}, {"$set": {"current_player_id": None}})
        return  # only one side can hit quota first — nothing left to check for this group


def _release_rank_key(player, users_map):
    """Sort key for one candidate within a category's release queue. Returns
    (has_score, primary, secondary, attendance) where every component sorts
    descending (higher = released sooner) — has_score alone already pushes
    players with no usable stats to the back, ahead of the by-name fallback
    ordered() applies to that subgroup.

    extra_power_batsman: battingAverage, then strikeRate. Bowling is never
    consulted for this group — it's explicitly a pure-batting pool.

    extra_power_allrounder / power / classic: (battingAverage - bowlingAverage)
    as the primary key, (strikeRate - economy) as the secondary — both skills
    have to be present to produce a score; a player with only one half of the
    pair (e.g. a specialist batsman with no bowling record) falls into the
    no-score/by-name group for these three, same as a player with neither.
    """
    user = users_map.get(player["user_id"], {})
    bat = user.get("batting_average")
    bowl = user.get("bowling_average")
    sr = user.get("strike_rate")
    econ = user.get("economy")
    attendance = user.get("attendance_percentage")
    attendance_key = attendance if attendance is not None else -1

    if player["category"] in BATSMAN_ONLY_GROUPS:
        if bat is None:
            return None
        primary = bat
        secondary = sr if sr is not None else float("-inf")
    else:
        if bat is None or bowl is None:
            return None
        primary = bat - bowl
        secondary = (sr if sr is not None else 0) - (econ if econ is not None else 0)

    return (primary, secondary, attendance_key)


def get_next_player_in_category(candidates, category, users_map):
    """Pure ranking function: given the pool of still-available auction_player
    docs for ONE category (already filtered by caller — no Mongo access here,
    so this is unit-testable on its own), returns whichever one should be
    released next, or None if the pool is empty.

    Ranking: _release_rank_key descending (primary stat, then secondary stat,
    then attendance_percentage as the final tie-break); players with no usable
    score sort after every scored player, ordered by name. Players flagged
    `deprioritized` (both captains passed on them at the base price — see
    drop_player) are held back to the very end of the category's queue,
    after every other player has already been offered, ranked the same way
    within that held-back group.
    """
    def ordered(group):
        scored = []
        unscored = []
        for p in group:
            key = _release_rank_key({**p, "category": category}, users_map)
            (scored if key is not None else unscored).append((p, key))
        scored.sort(key=lambda x: x[1], reverse=True)
        unscored.sort(key=lambda x: users_map.get(x[0]["user_id"], {}).get("name", ""))
        return [p for p, _ in (*scored, *unscored)]

    normal = ordered([p for p in candidates if not p.get("deprioritized")])
    held_back = ordered([p for p in candidates if p.get("deprioritized")])
    queue = normal + held_back
    return queue[0] if queue else None


def _next_release_candidate(auction, category, users_map):
    """Mongo-querying wrapper around get_next_player_in_category — admin only
    ever chooses the category, never the specific player, so there's no room
    for admin to favor either captain by release order."""
    candidates = list(mongo.db.auction_players.find({
        "auction_id": str(auction["_id"]), "category": category, "status": "available",
    }))
    return get_next_player_in_category(candidates, category, users_map)


def _users_map_for_auction(auction):
    user_ids = {p["user_id"] for p in mongo.db.auction_players.find({"auction_id": str(auction["_id"])})}
    return {str(u["_id"]): u for u in mongo.db.users.find({"_id": {"$in": [ObjectId(i) for i in user_ids]}})}


def _claim_release(auction, category, player, users_map):
    """Atomically claims the right to put `player` up for bidding -- a Mongo
    compare-and-swap on current_player_id still being None, not a
    check-then-write. gunicorn runs multiple real worker processes for this
    app (see gunicorn.conf.py), so two requests racing to release the next
    player -- e.g. a captain's drop finishing right as the GET-poll safety
    net below also tries to advance -- is a real, reachable condition, not
    just a theoretical one. Returns True only if THIS call won the claim;
    the release-order log is only written by the winner, so a race can
    never produce two log entries or two claimed players for one release."""
    released_at = datetime.utcnow()
    result = mongo.db.auctions.update_one(
        {"_id": auction["_id"], "current_player_id": None},
        {"$set": {
            "current_player_id": str(player["_id"]),
            "current_player_released_at": released_at,
            "auto_release_category": category,
        }},
    )
    if result.matched_count == 0:
        return False
    user = users_map.get(player["user_id"], {})
    mongo.db.auction_release_log.insert_one({
        "auction_id": str(auction["_id"]),
        "category": category,
        "player_id": str(player["_id"]),
        "player_name": user.get("name", "?"),
        "released_at": released_at,
    })
    return True


def _maybe_auto_release_next(auction_id):
    """Self-fetching and fully guarded -- safe to call unconditionally from
    anywhere a release might need to advance (tail of drop_player, tail of
    free_pick, lazily from get_auction). No-ops unless the auction is still
    active, not paused, and has no current player.

    Admin manually releases only the very first player of the auction --
    everything after that is automatic, including moving on to the next
    CATEGORY once the current one runs out, not just the next player within
    it. The category sequence itself is fixed (AUCTION_GROUPS order), and
    cycles starting from wherever admin's one manual click happened to
    begin -- so this works regardless of which category they started with,
    it doesn't have to be literally first in AUCTION_GROUPS. Once every
    category is exhausted, auto_release_category clears and this becomes a
    no-op for the rest of the auction's life (is_complete takes over from
    there). A player who's the sole survivor in his category after both
    captains passed (deprioritized, see drop_player) gets auto re-offered
    here too -- that's intentional, not a bug; it still needs both captains
    to act again before it resolves, same as today, just without the extra
    admin click."""
    auction = _auction_or_404(auction_id)
    if not auction or auction["status"] != "active" or auction.get("is_paused"):
        return
    if auction.get("current_player_id"):
        return
    category = auction.get("auto_release_category")
    if not category:
        return
    users_map = _users_map_for_auction(auction)

    start_idx = AUCTION_GROUPS.index(category) if category in AUCTION_GROUPS else 0
    for i in range(len(AUCTION_GROUPS)):
        cat = AUCTION_GROUPS[(start_idx + i) % len(AUCTION_GROUPS)]
        player = _next_release_candidate(auction, cat, users_map)
        if player:
            _claim_release(auction, cat, player, users_map)
            return

    # Every category exhausted -- nothing left for auto-release to do.
    mongo.db.auctions.update_one(
        {"_id": auction["_id"], "current_player_id": None},
        {"$set": {"auto_release_category": None}},
    )


def _distribute_remaining_players_evenly(auction):
    """Splits every still-'available' player free, alternating so both captains
    end up even per group — whoever has fewer in that specific group so far
    gets the next one (captain_a wins ties). Shared by the 25-minute session
    timeout and admin's manual Force Close: an active auction ending early for
    either reason should resolve the same way, not silently orphan whoever
    hadn't come up yet at status 'available' forever."""
    now = datetime.utcnow()
    for group in AUCTION_GROUPS:
        remaining = list(mongo.db.auction_players.find({
            "auction_id": str(auction["_id"]), "category": group, "status": "available",
        }))
        for p in remaining:
            a_count, _ = _captain_counts(auction, auction["captain_a_id"], group)
            b_count, _ = _captain_counts(auction, auction["captain_b_id"], group)
            target = auction["captain_a_id"] if a_count <= b_count else auction["captain_b_id"]
            mongo.db.auction_players.update_one(
                {"_id": p["_id"]},
                {"$set": {"status": "free_assigned", "sold_to": target,
                          "sold_price": 0, "assigned_via": "leftover_free"}},
            )
            mongo.db.auction_bids.insert_one({
                "auction_id": str(auction["_id"]), "player_id": str(p["_id"]),
                "captain_id": target, "action": "leftover_free", "amount": 0,
                "created_at": now,
            })


def _apply_timeout_fallback(auction):
    """Once the session's 25-minute cap passes, any group that never got fully
    resolved through bidding gets its remaining players split free."""
    now = datetime.utcnow()
    if auction["status"] != "active" or not auction.get("ends_at") or now <= auction["ends_at"]:
        return
    _distribute_remaining_players_evenly(auction)
    mongo.db.auctions.update_one(
        {"_id": auction["_id"]},
        {"$set": {"status": "completed", "current_player_id": None}},
    )


# ── Admin: setup + control ──────────────────────────────────────────────────────

@auction_bp.route("/admin/auction", methods=["POST"])
@admin_required
def create_auction():
    data = request.get_json(silent=True) or {}
    slot_id = data.get("slot_id")
    captain_a_id = data.get("captain_a_id")
    captain_b_id = data.get("captain_b_id")

    if not slot_id or not captain_a_id or not captain_b_id:
        return jsonify({"error": "slot_id, captain_a_id and captain_b_id are required"}), 400
    if captain_a_id == captain_b_id:
        return jsonify({"error": "captain_a_id and captain_b_id must be different"}), 400

    # Conflict of interest: an admin who is also (in real life) one of the two
    # captains shouldn't be the one running their own auction — someone else
    # from the admin team should conduct it instead. linked_captain_id is set
    # once, by hand, on the small number of dual-role admin accounts that
    # need it (see scripts/link_dual_role_captains.py) — most admins have no
    # such link and this check is simply a no-op for them.
    acting_admin = get_current_user()
    linked_captain_id = acting_admin.get("linked_captain_id") if acting_admin else None
    if linked_captain_id and linked_captain_id in (captain_a_id, captain_b_id):
        return jsonify({
            "error": "You're linked to one of the chosen captains — someone else from the admin team must run this auction"
        }), 403

    slot = mongo.db.match_slots.find_one({"_id": ObjectId(slot_id)})
    if not slot:
        return jsonify({"error": "Slot not found"}), 404
    window = _get_active_window(slot_id)
    if not window:
        return jsonify({"error": "No active voting window for this slot"}), 400

    available_votes = list(mongo.db.votes.find({
        "slot_id": slot_id, "window_id": str(window["_id"]), "availability": "available",
    }))
    if not available_votes:
        return jsonify({"error": "No one has voted available for this slot yet"}), 400

    # Captain A/B are whoever is running the draft — not required to be in the
    # player pool themselves, so any active captain in the system is eligible,
    # not just those who happened to vote available for this slot.
    for cid in (captain_a_id, captain_b_id):
        captain_user = mongo.db.users.find_one({"_id": ObjectId(cid), "role": "captain", "is_active": True})
        if not captain_user:
            return jsonify({"error": f"{cid} is not an active captain"}), 400

    # Captains never auction themselves — they run the draft, they're not in the
    # pool being drafted, even if they happened to vote available for this slot.
    voter_ids = [v["captain_id"] for v in available_votes if v["captain_id"] not in (captain_a_id, captain_b_id)]
    if not voter_ids:
        return jsonify({"error": "No one (other than the two captains) has voted available for this slot"}), 400
    voters = list(mongo.db.users.find({"_id": {"$in": [ObjectId(i) for i in voter_ids]}}))
    missing_category = [v["name"] for v in voters if not v.get("auction_category")]
    if missing_category:
        return jsonify({
            "error": f"These players need an auction_category set first: {', '.join(missing_category)}"
        }), 400

    counts_by_group = {g: 0 for g in AUCTION_GROUPS}
    for v in voters:
        counts_by_group[v["auction_category"]] += 1
    unbalanced = [g for g in AUCTION_GROUPS if counts_by_group[g] % 2 != 0]
    if unbalanced:
        return jsonify({
            "error": f"These groups have an odd number of available players and can't be split evenly: {', '.join(unbalanced)}"
        }), 400

    # It's a cricket match — each side needs at least a playing XI, and (per
    # admin's rule) no more than 15 to keep squads a sane size. Both are
    # driven by the pool size itself, not the 17-point budget, which is
    # unrelated and unchanged either way.
    if len(voters) < MIN_AUCTION_POOL_SIZE:
        return jsonify({
            "error": f"At least {MIN_AUCTION_POOL_SIZE} players are needed for an auction "
                     f"({MIN_AUCTION_POOL_SIZE // 2} per side) — only {len(voters)} voted available"
        }), 400

    per_side_roster_size = sum(count // 2 for count in counts_by_group.values())
    if per_side_roster_size > MAX_ROSTER_SIZE_PER_SIDE:
        return jsonify({
            "error": f"This pool would give each side {per_side_roster_size} players — "
                     f"the max is {MAX_ROSTER_SIZE_PER_SIDE} per side"
        }), 400

    auction_doc = {
        "slot_id": slot_id,
        "window_id": str(window["_id"]),
        "captain_a_id": captain_a_id,
        "captain_b_id": captain_b_id,
        "status": "pending",
        "current_player_id": None,
        "auto_release_category": None,
        "is_paused": False,
        "started_at": None,
        "ends_at": None,
        "target_roster_size": TARGET_ROSTER_SIZE,
        "points_budget": POINTS_BUDGET,
        "starting_price": STARTING_PRICE,
        "created_at": datetime.utcnow(),
    }
    result = mongo.db.auctions.insert_one(auction_doc)
    auction_id = str(result.inserted_id)

    for v in voters:
        mongo.db.auction_players.insert_one({
            "auction_id": auction_id,
            "user_id": str(v["_id"]),
            "category": v["auction_category"],
            "status": "available",
            "sold_to": None,
            "sold_price": None,
            "assigned_via": None,
            "deprioritized": False,
        })

    return jsonify({
        "message": "Auction created",
        "auction_id": auction_id,
        "group_counts": counts_by_group,
    }), 201


@auction_bp.route("/admin/auction/<auction_id>/start", methods=["POST"])
@admin_required
def start_auction(auction_id):
    auction = _auction_or_404(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404
    if auction["status"] != "pending":
        return jsonify({"error": f"Auction is already {auction['status']}"}), 400

    now = datetime.utcnow()
    ends_at = now + timedelta(minutes=SESSION_MINUTES)
    mongo.db.auctions.update_one(
        {"_id": auction["_id"]},
        {"$set": {"status": "active", "started_at": now, "ends_at": ends_at}},
    )
    return jsonify({"message": "Auction started", "ends_at": format_ist(ends_at), "ends_at_iso": to_iso_utc(ends_at)})


@auction_bp.route("/admin/auction/<auction_id>/release", methods=["POST"])
@admin_required
def release_player(auction_id):
    """Admin picks a CATEGORY only — never a specific player. Which player
    within it comes up next is decided automatically by _next_release_candidate,
    so there's no room for admin to release players in an order that favors
    either captain. This is also what starts (or re-points) that category's
    auto-release chain -- see _maybe_auto_release_next -- so admin only does
    this once per category, not once per player."""
    auction = _auction_or_404(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404
    if auction["status"] != "active":
        return jsonify({"error": "Auction is not active"}), 400
    if auction.get("current_player_id"):
        return jsonify({"error": "A player is already up for bidding"}), 400

    data = request.get_json(silent=True) or {}
    category = data.get("category")
    if category not in AUCTION_GROUPS:
        return jsonify({"error": f"category must be one of {AUCTION_GROUPS}"}), 400

    users_map = _users_map_for_auction(auction)
    player = _next_release_candidate(auction, category, users_map)
    if not player:
        return jsonify({"error": "No players remaining in this category"}), 400

    if not _claim_release(auction, category, player, users_map):
        return jsonify({"error": "A player is already up for bidding"}), 400

    return jsonify({"message": "Player released for bidding", "player_id": str(player["_id"])})


@auction_bp.route("/auction/<auction_id>/release-log", methods=["GET"])
@jwt_required()
def get_release_log(auction_id):
    """View-only, full release-order history for this auction — available
    to both captains, so the fixed rule (see get_next_player_in_category)
    can be verified after the fact from the actual sequence of events, not
    just trusted from the current player's own justification."""
    auction = _auction_or_404(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404

    entries = list(mongo.db.auction_release_log.find({"auction_id": auction_id}).sort("released_at", 1))
    return jsonify({
        "entries": [{
            "order_index": i + 1,
            "category": e["category"],
            "player_name": e["player_name"],
            "released_at": format_ist(e["released_at"]),
        } for i, e in enumerate(entries)],
    })


@auction_bp.route("/admin/auction/<auction_id>/close", methods=["POST"])
@admin_required
def close_auction(auction_id):
    auction = _auction_or_404(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404

    # An active auction being force-closed early should resolve exactly like a
    # natural timeout would -- split whoever's left evenly -- rather than
    # silently orphaning them at "available" forever. A still-pending auction
    # (admin cancelling before it ever started) has nothing to distribute --
    # nobody's been released yet -- and this would otherwise wrongly hand the
    # entire roster to two captains for an auction that never actually ran.
    if auction["status"] == "active":
        _distribute_remaining_players_evenly(auction)

    mongo.db.auctions.update_one(
        {"_id": auction["_id"]},
        {"$set": {"status": "completed", "current_player_id": None}},
    )
    return jsonify({"message": "Auction closed"})


@auction_bp.route("/admin/auction/<auction_id>/pause", methods=["POST"])
@admin_required
def pause_auction(auction_id):
    """Halts auto-release only -- bidding on whoever's already current_player
    is untouched, since pausing mid-bid would be far more disruptive than
    just holding off on releasing the next one."""
    auction = _auction_or_404(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404
    mongo.db.auctions.update_one({"_id": auction["_id"]}, {"$set": {"is_paused": True}})
    return jsonify({"message": "Auto-release paused"})


@auction_bp.route("/admin/auction/<auction_id>/resume", methods=["POST"])
@admin_required
def resume_auction(auction_id):
    auction = _auction_or_404(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404
    mongo.db.auctions.update_one({"_id": auction["_id"]}, {"$set": {"is_paused": False}})
    # Try immediately rather than waiting for the next poll, so admin sees
    # the next player come up right away instead of up to 2.5s later.
    _maybe_auto_release_next(auction_id)
    return jsonify({"message": "Auto-release resumed"})


# ── Discovery: "is there an auction I'm part of right now?" ─────────────────────
# Lets a captain find their auction without needing a manually-shared link/ID —
# the frontend polls this from the navbar for any logged-in captain.

@auction_bp.route("/auction/my-active", methods=["GET"])
@jwt_required()
def my_active_auction():
    user = get_current_user()
    uid = str(user["_id"])
    auction = mongo.db.auctions.find_one({
        "status": {"$in": ["pending", "active"]},
        "$or": [{"captain_a_id": uid}, {"captain_b_id": uid}],
    }, sort=[("created_at", -1)])
    if not auction:
        return jsonify({"auction_id": None})
    return jsonify({"auction_id": str(auction["_id"]), "status": auction["status"]})


# ── Shared live state (admin + the two assigned captains) ───────────────────────

@auction_bp.route("/auction/<auction_id>", methods=["GET"])
@jwt_required()
def get_auction(auction_id):
    auction = _auction_or_404(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404

    if auction["status"] == "active":
        _apply_timeout_fallback(auction)
        auction = _auction_or_404(auction_id)  # re-fetch in case the fallback just completed it
        # Order matters: timeout-completion above must always win over
        # auto-release advancing within the same request, and this doubles
        # as the self-healing path for a captain refreshing mid-auction --
        # if some earlier request's auto-release call got dropped by a
        # network blip, the very next poll from anyone picks it back up.
        if auction["status"] == "active":
            _maybe_auto_release_next(auction_id)
            auction = _auction_or_404(auction_id)

    user = get_current_user()
    uid = str(user["_id"])
    is_participant = uid in (auction["captain_a_id"], auction["captain_b_id"])
    if not is_participant and user["role"] != "admin":
        return jsonify({"error": "Access denied"}), 403

    players = list(mongo.db.auction_players.find({"auction_id": auction_id}))
    players_by_id = {str(p["_id"]): p for p in players}
    # Captains are deliberately excluded from the auctioned pool itself (see
    # create_auction), so their own user records must be fetched separately —
    # otherwise captain_name() falls back to "Unknown" for both of them.
    user_ids = {p["user_id"] for p in players} | {auction["captain_a_id"], auction["captain_b_id"]}
    users_map = {str(u["_id"]): u for u in mongo.db.users.find(
        {"_id": {"$in": [ObjectId(uid) for uid in user_ids]}}
    )}

    def captain_name(captain_id):
        return users_map.get(captain_id, {}).get("name", "Unknown")

    # Once the auction is over, what each captain paid for whom becomes
    # confidential — only the final rosters (names) stay visible. Prices/
    # points are removed from the response entirely, not just hidden in the
    # UI, so they can't be recovered via devtools either.
    reveal_prices = auction["status"] != "completed"

    def captain_summary(captain_id):
        roster = [p for p in players if p.get("sold_to") == captain_id]
        points_remaining = _captain_points_remaining(auction, captain_id)
        by_group = {g: 0 for g in AUCTION_GROUPS}
        for p in roster:
            by_group[p["category"]] += 1
        return {
            "captain_id": captain_id,
            "name": captain_name(captain_id),
            "team_name": users_map.get(captain_id, {}).get("team_name", ""),
            "points_remaining": points_remaining if reveal_prices else None,
            "is_drained": (points_remaining <= 0) if reveal_prices else None,
            "roster_count": len(roster),
            "roster": [{
                "user_id": p["user_id"], "name": users_map.get(p["user_id"], {}).get("name", "?"),
                "category": p["category"],
                "price": p.get("sold_price") if reveal_prices else None,
                "assigned_via": p.get("assigned_via") if reveal_prices else None,
            } for p in roster],
            "group_counts": by_group,
        }

    group_quotas = {g: _group_quota(auction, g) for g in AUCTION_GROUPS}

    current_player = None
    if auction.get("current_player_id"):
        cp = players_by_id.get(auction["current_player_id"])
        if cp:
            last_bid = mongo.db.auction_bids.find_one(
                {"auction_id": auction_id, "player_id": auction["current_player_id"], "action": "bid"},
                sort=[("created_at", -1)],
            )
            user = users_map.get(cp["user_id"], {})

            # Player Insights — auto-populated from data that already exists
            # (Manage Players' stats fields, the same next-match vote data
            # the Players dashboard tag uses), never manually entered per
            # release. "Team history" has no real equivalent in this data
            # model (teams are freshly drafted each auction, not persistent
            # across seasons) — attendance is the closest real substitute.
            next_slot, next_avail_map = next_match_context()
            insights = {
                "role": user.get("role"),
                "team_name": user.get("team_name") or None,
                "batting_average": user.get("batting_average"),
                "strike_rate": user.get("strike_rate"),
                "bowling_average": user.get("bowling_average"),
                "economy": user.get("economy"),
                "matches_present": user.get("matches_present"),
                "total_matches": user.get("total_matches"),
                "attendance_percentage": user.get("attendance_percentage"),
                "next_match_available": next_avail_map.get(cp["user_id"], False),
                "next_match_label": next_match_label(next_slot),
            }

            # Release order justification — every number here is a live
            # count, not a pre-generated slot, since admin still chooses
            # which CATEGORY to release from at each click (see
            # release_player's docstring). "index"/"category_index" already
            # include the current release itself, since its log entry was
            # written synchronously in release_player before this endpoint
            # can ever be polled for it.
            release_order = {
                "category": cp["category"],
                "index": mongo.db.auction_release_log.count_documents({"auction_id": auction_id}),
                "of_total": mongo.db.auction_players.count_documents({"auction_id": auction_id}),
                "category_index": mongo.db.auction_release_log.count_documents(
                    {"auction_id": auction_id, "category": cp["category"]}
                ),
                "category_of_total": mongo.db.auction_players.count_documents(
                    {"auction_id": auction_id, "category": cp["category"]}
                ),
            }

            current_player = {
                "id": str(cp["_id"]), "user_id": cp["user_id"],
                "name": user.get("name", "?"),
                "category": cp["category"],
                # Lets the frontend show "Re-offering X — both captains
                # passed" instead of a plain release, so a sole-survivor
                # auto-re-release (see _maybe_auto_release_next) reads as
                # expected behavior rather than a bug.
                "deprioritized": cp.get("deprioritized", False),
                "current_high_bid": last_bid["amount"] if last_bid else auction["starting_price"],
                "current_high_bidder": captain_name(last_bid["captain_id"]) if last_bid else None,
                "insights": insights,
                "release_order": release_order,
            }

    # The bid history is just as confidential as the final prices once the
    # auction's over — it's the same information (who paid what), just in log
    # form instead of a roster line, so it's withheld the same way.
    bid_feed = []
    if reveal_prices:
        bids = list(mongo.db.auction_bids.find({"auction_id": auction_id}).sort("created_at", -1).limit(50))
        bids.reverse()
        bid_feed = [{
            "captain_name": captain_name(b["captain_id"]),
            "action": b["action"],
            "amount": b.get("amount"),
            "player_name": users_map.get(players_by_id.get(b["player_id"], {}).get("user_id", ""), {}).get("name", "?"),
            "created_at": format_ist(b["created_at"]),
        } for b in bids]

    # Deprioritized (both captains passed at base price) sort to the end so
    # admin's release dropdown naturally offers everyone else in the category
    # first — they're still releasable any time, just not the default pick.
    available_players = sorted(
        (
            {
                "id": str(p["_id"]), "user_id": p["user_id"],
                "name": users_map.get(p["user_id"], {}).get("name", "?"), "category": p["category"],
                "deprioritized": p.get("deprioritized", False),
            } for p in players if p["status"] == "available"
        ),
        key=lambda p: p["deprioritized"],
    )

    # Purely computed, not a stored flag: players only ever leave
    # "available" (sold/free_assigned/deprioritized-but-still-available
    # doesn't count as leaving), never return to it, so this is monotonic --
    # once true for an active auction it stays true. That's what makes it
    # safe for admin, both captains, and every poll of any of them to read
    # independently with no risk of a "who saw it first" race, unlike a
    # write-on-first-observation flag would have.
    is_complete = auction["status"] == "active" and len(available_players) == 0

    return jsonify({
        "id": auction_id,
        "status": auction["status"],
        "ends_at": format_ist(auction["ends_at"]) if auction.get("ends_at") else None,
        "ends_at_iso": to_iso_utc(auction.get("ends_at")),
        "points_budget": auction["points_budget"],
        "starting_price": auction["starting_price"],
        "session_minutes": SESSION_MINUTES,
        "group_quotas": group_quotas,
        "current_player": current_player,
        "available_players": available_players,
        "captain_a": captain_summary(auction["captain_a_id"]),
        "captain_b": captain_summary(auction["captain_b_id"]),
        "bid_feed": bid_feed,
        "auto_release_category": auction.get("auto_release_category"),
        "is_paused": auction.get("is_paused", False),
        "is_complete": is_complete,
    })


# ── Captain actions ───────────────────────────────────────────────────────────────

@auction_bp.route("/auction/<auction_id>/bid", methods=["POST"])
@jwt_required()
def place_bid(auction_id):
    auction = _auction_or_404(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404
    if auction["status"] != "active":
        return jsonify({"error": "Auction is not active"}), 400

    user = get_current_user()
    captain_id = str(user["_id"])
    if captain_id not in (auction["captain_a_id"], auction["captain_b_id"]):
        return jsonify({"error": "Only the two assigned captains can bid in this auction"}), 403
    if not auction.get("current_player_id"):
        return jsonify({"error": "No player is currently up for bidding"}), 400

    data = request.get_json(silent=True) or {}
    try:
        amount = float(data.get("amount"))
    except (TypeError, ValueError):
        return jsonify({"error": "A numeric amount is required"}), 400

    if round(amount * 2) != amount * 2:
        return jsonify({"error": "Bids must be in increments of 0.5"}), 400

    player = _player_doc(auction_id, auction["current_player_id"])
    if not player or player["status"] != "available":
        return jsonify({"error": "This player is no longer available"}), 400

    remaining_points = _captain_points_remaining(auction, captain_id)
    if remaining_points < 0.5:
        return jsonify({"error": "You have no points left to bid with"}), 400

    last_bid = mongo.db.auction_bids.find_one(
        {"auction_id": auction_id, "player_id": auction["current_player_id"], "action": "bid"},
        sort=[("created_at", -1)],
    )
    if last_bid:
        if last_bid["captain_id"] == captain_id:
            return jsonify({"error": "You already have the highest bid"}), 400
        if amount <= last_bid["amount"]:
            return jsonify({"error": f"Bid must be higher than the current bid of {last_bid['amount']}"}), 400
    else:
        # Every bid = 8.5 base + extra (0.5-17). The base is never drawn from
        # the purse, so the opening bid on a fresh player must be at least
        # base + 0.5 — not just the base itself.
        min_total = auction["starting_price"] + 0.5
        if amount < min_total:
            return jsonify({"error": f"Bid must be at least {min_total} (base {auction['starting_price']} + minimum 0.5 extra)"}), 400

    extra = round(amount - auction["starting_price"], 1)
    if extra > remaining_points:
        return jsonify({
            "error": f"That bid needs {extra} extra points on top of the {auction['starting_price']} base, "
                     f"but you only have {remaining_points} remaining"
        }), 400

    quota = _group_quota(auction, player["category"])
    count, _ = _captain_counts(auction, captain_id, player["category"])
    if count >= quota:
        return jsonify({"error": "You've already filled your quota for this category"}), 400

    mongo.db.auction_bids.insert_one({
        "auction_id": auction_id, "player_id": auction["current_player_id"],
        "captain_id": captain_id, "action": "bid", "amount": amount,
        "created_at": datetime.utcnow(),
    })
    return jsonify({"message": "Bid placed", "amount": amount})


@auction_bp.route("/auction/<auction_id>/drop", methods=["POST"])
@jwt_required()
def drop_player(auction_id):
    auction = _auction_or_404(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404
    if auction["status"] != "active":
        return jsonify({"error": "Auction is not active"}), 400

    user = get_current_user()
    captain_id = str(user["_id"])
    if captain_id not in (auction["captain_a_id"], auction["captain_b_id"]):
        return jsonify({"error": "Only the two assigned captains can act in this auction"}), 403
    if not auction.get("current_player_id"):
        return jsonify({"error": "No player is currently up for bidding"}), 400

    player_id = auction["current_player_id"]
    player = _player_doc(auction_id, player_id)
    other_captain = auction["captain_b_id"] if captain_id == auction["captain_a_id"] else auction["captain_a_id"]

    # Scope "has the other captain already passed" and "who holds the active
    # bid" to actions taken SINCE this exact release. Without this, a player
    # who's the only one left in their category -- so gets released again
    # after an earlier no-bid pass -- carries the other captain's stale drop
    # record forward from that earlier round, letting a single fresh drop
    # from just one captain wrongly resolve "both passed" even though the
    # other captain never acted this time. Auctions already in flight when
    # this shipped won't have current_player_released_at set yet for their
    # current release; falling back to no scoping for just that one release
    # keeps the old behavior for it instead of erroring, and self-heals from
    # the very next release() call onward.
    released_at = auction.get("current_player_released_at")
    this_round = {"created_at": {"$gte": released_at}} if released_at else {}

    last_bid = mongo.db.auction_bids.find_one(
        {"auction_id": auction_id, "player_id": player_id, "action": "bid", **this_round},
        sort=[("created_at", -1)],
    )
    if last_bid and last_bid["captain_id"] == captain_id:
        return jsonify({"error": "You have the highest bid — you can't drop out now"}), 400

    mongo.db.auction_bids.insert_one({
        "auction_id": auction_id, "player_id": player_id, "captain_id": captain_id,
        "action": "drop", "amount": None, "created_at": datetime.utcnow(),
    })

    if last_bid and last_bid["captain_id"] == other_captain:
        # The other captain is the sole remaining bidder with an active bid — awarded immediately.
        mongo.db.auction_players.update_one(
            {"_id": ObjectId(player_id)},
            {"$set": {"status": "sold", "sold_to": other_captain,
                      "sold_price": last_bid["amount"], "assigned_via": "bid"}},
        )
        mongo.db.auctions.update_one({"_id": auction["_id"]}, {"$set": {"current_player_id": None}})
        auction = _auction_or_404(auction_id)
        _check_leftover_award(auction, player["category"])
        response = jsonify({"message": "Sold", "sold_to": other_captain, "sold_price": last_bid["amount"]})
        _maybe_auto_release_next(auction_id)
        return response

    already_dropped = mongo.db.auction_bids.find_one({
        "auction_id": auction_id, "player_id": player_id, "captain_id": other_captain, "action": "drop", **this_round,
    })
    if not last_bid and already_dropped:
        # Both captains passed at the base price with no bids at all — stays
        # "available", but deprioritized: _next_release_candidate holds these
        # back until every other player in the category has already gone.
        mongo.db.auction_players.update_one({"_id": ObjectId(player_id)}, {"$set": {"deprioritized": True}})
        mongo.db.auctions.update_one({"_id": auction["_id"]}, {"$set": {"current_player_id": None}})
        response = jsonify({"message": "Both captains passed — this player becomes the last option in their category"})
        _maybe_auto_release_next(auction_id)
        return response

    return jsonify({"message": "Dropped"})


@auction_bp.route("/auction/<auction_id>/free-pick", methods=["POST"])
@jwt_required()
def free_pick(auction_id):
    """
    Once the OTHER captain's purse is fully drained (0 points — they
    literally cannot bid the 8.5 floor anymore, in any category), the solvent
    captain can claim any remaining unsold player, in any category, for free
    — without needing admin to release it first or going through a bid/drop
    cycle against an opponent who can no longer contest anything. Still capped
    by the solvent captain's own per-category quota (see the check below), so
    this can never let them exceed their own fair share — whatever's left
    over after that goes to the drained captain via _check_leftover_award,
    same as it would after any other quota-filling pick.
    """
    auction = _auction_or_404(auction_id)
    if not auction:
        return jsonify({"error": "Auction not found"}), 404
    if auction["status"] != "active":
        return jsonify({"error": "Auction is not active"}), 400

    user = get_current_user()
    captain_id = str(user["_id"])
    if captain_id not in (auction["captain_a_id"], auction["captain_b_id"]):
        return jsonify({"error": "Only the two assigned captains can act in this auction"}), 403

    other_captain = auction["captain_b_id"] if captain_id == auction["captain_a_id"] else auction["captain_a_id"]
    if _captain_points_remaining(auction, other_captain) > 0:
        return jsonify({"error": "Free pick is only available once the other captain's points are fully drained"}), 400

    data = request.get_json(silent=True) or {}
    player_id = data.get("player_id")
    player = _player_doc(auction_id, player_id) if player_id else None
    if not player or player["status"] != "available":
        return jsonify({"error": "Player not available"}), 400

    # Same quota cap normal bidding enforces — without this, the solvent
    # captain could free-pick every remaining player in a category once the
    # opponent is drained, taking far more than their fair half instead of
    # just what's left within their own quota.
    quota = _group_quota(auction, player["category"])
    count, _ = _captain_counts(auction, captain_id, player["category"])
    if count >= quota:
        return jsonify({"error": "You've already filled your quota for this category"}), 400

    mongo.db.auction_players.update_one(
        {"_id": player["_id"]},
        {"$set": {"status": "free_assigned", "sold_to": captain_id, "sold_price": 0, "assigned_via": "free_pick"}},
    )
    mongo.db.auction_bids.insert_one({
        "auction_id": auction_id, "player_id": str(player["_id"]), "captain_id": captain_id,
        "action": "free_pick", "amount": 0, "created_at": datetime.utcnow(),
    })
    if auction.get("current_player_id") == str(player["_id"]):
        mongo.db.auctions.update_one({"_id": auction["_id"]}, {"$set": {"current_player_id": None}})

    # A free-pick counts toward quota same as a bid win — if it just pushed the
    # picking captain to their group quota, the rest of that group should
    # transfer to the other captain immediately too, not sit unresolved.
    auction = _auction_or_404(auction_id)
    _check_leftover_award(auction, player["category"])
    _maybe_auto_release_next(auction_id)

    return jsonify({"message": "Player picked for free"})
