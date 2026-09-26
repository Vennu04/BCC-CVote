"""The live "coming up" list (GET /auction/<id> -> upcoming) must be the
exact order auto-release really offers players in -- same ranking code,
same category cycle -- and must stay right as players get resolved."""
from app.routes.auction import AUCTION_GROUPS

from test_auction_auto_release import _create, _start, _get, _sell, _both_pass

POOL = (
    [("extra_power_allrounder", 30 + i, 20 + i) for i in range(4)]
    + [("extra_power_batsman", 25 + 3 * i, None) for i in range(4)]
    + [("power", 10 + 2 * i, 25 - i) for i in range(8)]
    + [("classic", 5 + i, None) for i in range(4)]
)


def _setup(client, admin_headers, auth_header, make_auction_setup):
    setup = make_auction_setup(POOL)
    auction_id = _create(client, admin_headers, setup).get_json()["auction_id"]
    return auction_id, auth_header(setup["captain_a"]), auth_header(setup["captain_b"])


def test_pending_auction_lists_whole_pool_in_category_order(client, admin_headers, auth_header, make_auction_setup):
    auction_id, a_h, _ = _setup(client, admin_headers, auth_header, make_auction_setup)
    up = _get(client, a_h, auction_id).get_json()["upcoming"]
    assert len(up) == len(POOL)
    assert [p["position"] for p in up] == list(range(1, len(POOL) + 1))
    cats = [p["category"] for p in up]
    assert cats == sorted(cats, key=AUCTION_GROUPS.index)
    assert "batting_average" in up[0] and "attendance_percentage" in up[0]


def test_every_release_is_the_previous_head_of_upcoming(client, admin_headers, auth_header, make_auction_setup):
    auction_id, a_h, b_h = _setup(client, admin_headers, auth_header, make_auction_setup)
    pending_head = _get(client, a_h, auction_id).get_json()["upcoming"][0]["id"]
    _start(client, admin_headers, auction_id)
    state = _get(client, a_h, auction_id).get_json()
    assert state["current_player"]["id"] == pending_head

    for step in range(len(POOL)):
        if not state["current_player"]:
            break
        before = [p["id"] for p in state["upcoming"]]
        assert state["current_player"]["id"] not in before
        if step % 2:
            _sell(client, auction_id, a_h, b_h)
        else:
            _sell(client, auction_id, b_h, a_h)
        state = _get(client, a_h, auction_id).get_json()
        still_waiting = {p["id"] for p in state["upcoming"]} | ({state["current_player"]["id"]} if state["current_player"] else set())
        expected = [pid for pid in before if pid in still_waiting]
        if state["current_player"]:
            # Whoever releases next is the first player from the old list
            # who's still waiting (leftover awards may have settled others).
            assert state["current_player"]["id"] == expected[0]
            assert [p["id"] for p in state["upcoming"]] == expected[1:]
    assert state["upcoming"] == []


def test_both_passing_moves_player_to_end_of_their_category(client, admin_headers, auth_header, make_auction_setup):
    auction_id, a_h, b_h = _setup(client, admin_headers, auth_header, make_auction_setup)
    _start(client, admin_headers, auction_id)
    state = _get(client, a_h, auction_id).get_json()
    passed = state["current_player"]
    _both_pass(client, auction_id, a_h, b_h)
    state = _get(client, a_h, auction_id).get_json()
    same_cat = [p for p in state["upcoming"] if p["category"] == passed["category"]]
    assert same_cat and same_cat[-1]["id"] == passed["id"] and same_cat[-1]["deprioritized"] is True
