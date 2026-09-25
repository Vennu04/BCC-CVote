"""Who may watch a live auction (GET /auction/<id>) and post in its chat.

Every real admin in prod is role=captain + is_admin=True, so these routes
must accept the same staff set as @admin_required — a bare role=="admin"
check locked them out of the admin auction screen ("Access denied")."""


def _create(client, headers, setup):
    return client.post("/api/admin/auction", json={
        "slot_id": setup["slot_id"],
        "captain_a_id": str(setup["captain_a"]["_id"]),
        "captain_b_id": str(setup["captain_b"]["_id"]),
    }, headers=headers)


def _auction(client, admin_headers, make_auction_setup):
    setup = make_auction_setup([("power", None, None)] * 22)
    return _create(client, admin_headers, setup).get_json()["auction_id"]


def test_dual_role_admin_can_view_and_chat(client, admin_headers, auth_header, make_user, make_auction_setup):
    auction_id = _auction(client, admin_headers, make_auction_setup)
    shashi = auth_header(make_user("captain", "SHSH", "pw", name="Shashi", is_admin=True))

    assert client.get(f"/api/auction/{auction_id}", headers=shashi).status_code == 200
    res = client.post(f"/api/auction/{auction_id}/chat", json={"message": "hi"}, headers=shashi)
    assert res.status_code == 201


def test_organizer_can_view(client, admin_headers, auth_header, make_user, make_auction_setup):
    auction_id = _auction(client, admin_headers, make_auction_setup)
    org = auth_header(make_user("organizer", "ORG", "pw"))
    assert client.get(f"/api/auction/{auction_id}", headers=org).status_code == 200


def test_unrelated_captain_and_player_still_denied(client, admin_headers, auth_header, make_user, make_auction_setup):
    auction_id = _auction(client, admin_headers, make_auction_setup)
    for user in (make_user("captain", "OTHER", "pw"), make_user("player", "PLX", "pw")):
        h = auth_header(user)
        assert client.get(f"/api/auction/{auction_id}", headers=h).status_code == 403
        assert client.post(f"/api/auction/{auction_id}/chat", json={"message": "x"}, headers=h).status_code == 403
