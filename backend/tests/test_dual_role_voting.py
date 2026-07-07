"""An admin account flagged is_player=True should function as a normal voter
(vote-casting, dashboard/summary/export inclusion, auction-pool eligibility)
on top of full admin capability — without a plain admin (no is_player flag)
gaining any of that by accident."""
from app import mongo


def test_admin_voter_can_cast_and_see_their_own_vote(client, make_user, auth_header, make_slot_and_window):
    admin_voter = make_user("admin", "ADMINVOTER", "pw", is_player=True)
    slot_id, _ = make_slot_and_window()

    res = client.post("/api/votes", json={"slot_id": slot_id, "availability": "available"},
                       headers=auth_header(admin_voter))
    assert res.status_code == 200

    mine = client.get("/api/votes/my", headers=auth_header(admin_voter)).get_json()
    assert mine["votes"][0]["availability"] == "available"


def test_plain_admin_without_is_player_flag_is_not_a_voter_anywhere(client, make_user, admin_headers, make_slot_and_window):
    plain_admin = make_user("admin", "PLAINADMIN", "pw")  # no is_player
    make_slot_and_window()

    dash = client.get("/api/admin/dashboard", headers=admin_headers).get_json()
    names_in_matrix = {row["captain"]["team_code"] for row in dash["vote_matrix"]}
    assert "PLAINADMIN" not in names_in_matrix

    players = client.get("/api/admin/players", headers=admin_headers).get_json()
    assert "PLAINADMIN" not in {p["team_code"] for p in players}

    summary = client.get("/api/votes/summary", headers=admin_headers).get_json()
    # Only the ADMIN fixture account itself exists so far; a plain admin must
    # not inflate the denominator.
    assert summary["summary"][0]["total_captains"] == 0


def test_admin_voter_appears_in_dashboard_vote_matrix_and_counts(client, make_user, admin_headers, make_slot_and_window, auth_header):
    admin_voter = make_user("admin", "ADMINVOTER", "pw", is_player=True)
    slot_id, _ = make_slot_and_window()
    client.post("/api/votes", json={"slot_id": slot_id, "availability": "available"},
                headers=auth_header(admin_voter))

    dash = client.get("/api/admin/dashboard", headers=admin_headers).get_json()
    assert dash["captains_total"] == 1
    assert dash["captains_voted"] == 1
    row = dash["vote_matrix"][0]
    assert row["captain"]["team_code"] == "ADMINVOTER"
    assert row["captain"]["role"] == "admin"
    assert row["votes"][0]["availability"] == "available"


def test_admin_voter_appears_in_players_list_not_captains_list(client, make_user, admin_headers):
    make_user("admin", "ADMINVOTER", "pw", is_player=True)

    players = client.get("/api/admin/players", headers=admin_headers).get_json()
    assert "ADMINVOTER" in {p["team_code"] for p in players}

    captains = client.get("/api/admin/captains", headers=admin_headers).get_json()
    assert "ADMINVOTER" not in {c["team_code"] for c in captains}


def test_admin_voter_counted_in_votes_summary(client, make_user, admin_headers, make_slot_and_window):
    make_user("admin", "ADMINVOTER", "pw", is_player=True)
    make_slot_and_window()

    summary = client.get("/api/votes/summary", headers=admin_headers).get_json()
    assert summary["summary"][0]["counts"]["no_response"] == 1  # counted, just hasn't voted yet


def test_admin_voter_row_included_in_csv_export(client, make_user, admin_headers, make_slot_and_window):
    make_user("admin", "ADMINVOTER", "pw", is_player=True)
    make_slot_and_window()

    res = client.get("/api/admin/export/csv", headers=admin_headers)
    assert res.status_code == 200
    assert b"ADMINVOTER" in res.data


def test_update_player_can_edit_admin_voter(client, make_user, admin_headers):
    admin_voter = make_user("admin", "ADMINVOTER", "pw", is_player=True)

    res = client.put(f"/api/admin/players/{admin_voter['_id']}",
                      json={"auction_category": "classic"}, headers=admin_headers)
    assert res.status_code == 200
    assert res.get_json()["player"]["auction_category"] == "classic"


def test_update_player_rejects_plain_admin_without_is_player(client, make_user, admin_headers):
    plain_admin = make_user("admin", "PLAINADMIN", "pw")  # no is_player

    res = client.put(f"/api/admin/players/{plain_admin['_id']}",
                      json={"auction_category": "classic"}, headers=admin_headers)
    assert res.status_code == 404


def test_admin_voter_pulled_into_auction_pool(client, make_user, admin_headers, auth_header, make_slot_and_window, make_vote):
    slot_id, window_id = make_slot_and_window()
    captain_a = make_user("captain", "CAPA", "capa")
    captain_b = make_user("captain", "CAPB", "capb")
    admin_voter = make_user("admin", "ADMINVOTER", "pw", is_player=True, auction_category="classic")
    other_voter = make_user("player", "PLR1", "plr1", auction_category="classic")

    make_vote(admin_voter["_id"], slot_id, window_id, "available")
    make_vote(other_voter["_id"], slot_id, window_id, "available")

    res = client.post("/api/admin/auction", json={
        "slot_id": slot_id,
        "captain_a_id": str(captain_a["_id"]), "captain_b_id": str(captain_b["_id"]),
    }, headers=admin_headers)
    assert res.status_code == 201
    assert res.get_json()["group_counts"]["classic"] == 2

    auction_id = res.get_json()["auction_id"]
    pooled_user_ids = {p["user_id"] for p in mongo.db.auction_players.find({"auction_id": auction_id})}
    assert str(admin_voter["_id"]) in pooled_user_ids
