# BCC-CVote 🏏

Cricket club app for weekend match-availability voting and a live points-based player
auction to split available players into two balanced teams. Currently running the **BCC
Premier League 2026** tournament.

**Live:** https://d2welg0wjdnhjp.cloudfront.net
**Deployment/ops details:** see [INFRASTRUCTURE.md](INFRASTRUCTURE.md)

---

## What it does

1. **Weekend availability voting** — 4 fixed recurring slots (Sat/Sun Morning/Evening).
   Admin opens/closes a voting window per slot; captains and players mark themselves
   available/not-available/maybe. Each slot card shows a live weather forecast (temp,
   rain %, wind, humidity) for the venue. Once a captain/player has cast their own vote
   for a slot, that slot's card reveals a live "Available Players" list — just the names
   of everyone else who's voted available for that same match, nothing else (not a full
   breakdown of every status). Admin sees the same per-slot available-players list
   unconditionally on the Voting Windows page, without needing to vote.
2. **Ad-hoc dated matches** — admin can add a one-off match for any date (a weather-driven
   Saturday, a public holiday, a knockout-stage qualifier, etc.) on top of the 4 fixed slots.
   Same voting mechanism, soft-removable, doesn't touch the original 4. Ad-hoc slots sharing
   the same date are grouped side by side on Voting Windows so admin can compare turnout
   between candidate slots for the same day.
3. **Admin can cast or change anyone's vote** — for the real case where a captain/player
   confirmed by phone/WhatsApp but couldn't cast their own vote in the app in time (mobile
   issues, travel, work). Two entry points, both usable regardless of whether that slot's
   window is still open or already closed. See [Admin vote management](#admin-vote-management)
   below.
4. **Live player auction** — once a match's availability is known, admin runs a live
   points-based auction between two designated captains to split everyone who voted
   available into two balanced XIs. Admin's one Start click is the only manual step in
   the entire auction — the first player releases automatically, and the system carries
   every player after that (and every category after that) through to completion on its
   own. A **rehearsal/practice mode** lets captains try the exact live-bidding flow with
   any hand-picked roster before a real match, and an **in-auction chat** (open to the two
   assigned captains plus any admin) lets everyone ask questions without falling back to a
   phone call mid-bid. See [Auction rules](#auction-rules) below.
5. **Attendance & knockout-eligibility tracking** — real season attendance (matches present
   / total matches, tracked with a simple "+1" per player/captain), independent of the
   voting system. Voters are ranked by attendance %, with a configurable cutoff to
   auto-mark the top N as eligible for knockout-stage selection. See
   [Attendance & knockout eligibility](#attendance--knockout-eligibility) below.
6. **Account security & self-service** — scrypt-hashed passwords with minimum-length /
   not-all-numeric validation, forced password change on first login or after an admin
   reset (with a show/hide toggle on every password field), per-device login lock
   (toggle-able), and immediate session invalidation on any password change. See
   [Accounts & security](#accounts--security) below.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS + React Router v6 + Axios, PWA (vite-plugin-pwa) |
| Backend | Flask 3 + PyMongo + flask-jwt-extended + gunicorn (2 sync workers), pytz (IST) |
| Database | MongoDB Atlas (M0 free tier) |
| Prod infra | Single EC2 instance, Docker Compose (Caddy + backend + frontend) — no Kubernetes. See [INFRASTRUCTURE.md](INFRASTRUCTURE.md) |
| CI/CD | GitHub Actions, OIDC deploy role (no static AWS keys), deploy via SSM RunCommand |
| Container registry | AWS ECR |
| Weather | OpenWeatherMap free tier (5-day/3-hour forecast), cached in Mongo (2h TTL, 10min on failure) |
| PWA | vite-plugin-pwa, `autoUpdate` registration — installable, app-shell precached, API calls never cached |

---

## Dev setup (local)

```bash
git clone https://github.com/Vennu04/BCC-CVote
cd BCC-CVote
docker-compose up -d
docker-compose run --rm seed   # first time only — seeds 4 slots + admin + sample captains
```

- Frontend: http://localhost:3000
- Backend: http://localhost:5000
- MongoDB: localhost:27017 (mongo:7.0 container — local dev only, prod uses Atlas)
- Admin login: `ADMIN` / `admin@bcc2024` (seed default)
- Captain/player default password: their team code, lowercase (e.g. `MI` → `mi`)

Stop: `docker-compose down`

Deployment, AWS architecture, CI/CD pipeline details, and secrets management are all in
[INFRASTRUCTURE.md](INFRASTRUCTURE.md) — kept separate from this file since they change
independently of the app's own features.

---

## Auction rules

- Players are split into 4 groups: **Extra Power → All-Rounders**, **Extra Power → Batsmen**,
  **Power**, **Classic**. Each group is split exactly in half between the two captains.
- Every player has a base price of **8.5 points**. Each captain has a **17-point purse**.
- **The purse only ever pays for the bid amount *above* the 8.5 base** — winning a player at
  15 (8.5 base + 6.5 extra) costs the winner 6.5 points, not 15. The base itself is never
  drawn from the purse.
- Bids are in 0.5 increments; a captain can keep bidding for as little as 0.5 extra even
  once low on points — they're never locked out below the 8.5 floor.
- **Extra Power quota rule**: the instant a captain wins half of a group's players (e.g. 3
  of 6), the rest of that same group transfers to the other captain for free — no more
  bidding on them.
- **Purse-drained rule (Power/Classic only)**: once a captain's 17-point purse hits 0, the
  other captain can freely claim any remaining Power/Classic player without bidding — Extra
  Power is excluded from this since it already has its own quota-based rule above.
- **Minimum pool size**: at least **20** players must have voted available for the selected
  slot (10 per side) before an auction can be created — deliberately not a full-XI
  requirement, per admin's call.
- **Maximum pool size**: no more than **14 per side** in the auctioned pool (28 total) — the
  captain themselves is separate from this cap, so each side's real final headcount is 14
  auctioned players + their own captain = 15. Per-category quota is always dynamic
  (`category_total // 2`, recomputed live from that slot's actual confirmed voters).
- Captains are never part of their own auctioned pool, even if they voted available for
  that match. If a captain also has admin capability (see
  [Accounts & security](#accounts--security)), they're additionally blocked from running an
  auction they'd be participating in themselves — checked via a `linked_captain_id` on their
  admin account, set by hand for the small number of dual-role admins who need it.
- Session cap: 25 minutes from admin clicking Start; any players still unresolved at that
  point are distributed evenly between both captains.
- **Fully automatic release, one click for the whole auction** — admin's only manual
  step is clicking **Start**; every player after the first releases itself the instant the
  previous one's bidding resolves, cycling through categories in a fixed order — **Extra
  Power All-Rounders → Extra Power Batsmen → Power → Classic** — no further clicks needed.
  Concurrency-safe via a MongoDB compare-and-swap on the "claim this release" write, since
  the backend runs real parallel gunicorn workers.
- **In-auction chat** — a message thread scoped to each auction, open to the two assigned
  captains plus any admin, rides the same ~2.5s poll the rest of the live auction screen
  already uses (no separate realtime infra). A new message from someone else triggers a
  sound/vibrate/toast alert, same mechanism as the "your turn" bidding alert.
- **Practice/rehearsal auctions** — admin can create a fully separate `is_test` auction with
  any two captains and any hand-picked roster, not tied to a real match slot or voting
  window, so captains can rehearse the live-bidding flow (including chat) before it matters.
  Uses every other auction route unmodified; only creation has its own path.
- **"Both captains joined" status, before admin even starts** — the setup screen tracks the
  first time each captain's own login loads the auction page, shows a live ✅/pending readout,
  and fires a one-time toast the moment both are in. Not a hard gate — Start still works
  regardless.
- **Admin can pause/resume** the auto-release chain at any point without losing progress.
- **Both-captains-decline queue** — if both captains pass on a player at the 8.5 base price,
  that player becomes the deprioritized last option in their category, revisited only once
  every other player in the category is resolved.
- **Post-completion confidentiality** — once an auction is closed, bid prices, remaining
  points, and how each player was assigned are stripped from the API response entirely (not
  just hidden in the UI). Only the final name-and-category rosters — and the chat log —
  remain visible.

---

## Admin vote management

For the real-world case where a captain/player confirmed availability by phone/WhatsApp but
couldn't cast (or fix) their own vote in the app in time.

- `POST /admin/votes` sets or changes anyone's vote for any slot; `DELETE
  /admin/votes/<slot_id>/<user_id>` clears one. Both are admin-only and deliberately bypass
  the self-service rules in `votes.py` (window must be open to vote at all; a short
  emergency-revoke deadline after close). Works identically for the 4 fixed slots and any
  ad-hoc match.
- Two places to use it:
  - **Admin Dashboard** — each slot's stat card shows a "yet to vote" count; expanding it
    lists exactly those non-voters with one-click ✅ Available / 🤔 Maybe / ❌ Not Available
    buttons.
  - **Voting Window / Auction setup screen** — every name in the Confirmed/Pending turnout
    panel is clickable; changing someone who already has a vote recorded asks for
    confirmation first, since that overwrites a real answer.
- Every override — set or clear — is logged to the `vote_overrides` collection (admin,
  target person, slot, old → new availability, timestamp).

---

## Accounts & security

- Passwords are hashed with Werkzeug's **scrypt** (memory-hard, no legacy scheme).
- **Password rules**: minimum 6 characters, rejected if all-numeric — enforced identically
  on self-service change, admin-set, and admin-reset paths via one shared validator.
- **Forced password change**: required on first login (default password) and immediately
  after any admin-driven reset; there's no way to navigate around it while it's pending.
  Every password field (including this one) has a show/hide visibility toggle.
- **Admin-assisted reset**: a "Reset Password" action next to each captain/player generates
  a random temp password (readable-over-the-phone alphabet — no `0/O/1/l/I`), sets the
  forced-change flag, logs who reset whose password and when, and gives admin a
  copy-to-clipboard button on the generated password instead of retyping it from a toast.
- **Session invalidation**: every account has a `token_version` counter embedded in its JWT;
  changing a password bumps it, instantly invalidating every other active session for that
  account — including a hijacked one — without needing server-side token storage.
- **Per-device login lock**: a captain/player account can be bound to the first device it
  logs in from; a second device is rejected until admin clicks "Reset Device." Governed by
  `DEVICE_LOCK_ENABLED` — **currently disabled for all users** (a deliberate config choice,
  not a temporary testing state) so players can use the app across multiple devices of their
  own.
- **Role promotion**: admin can convert an existing player to captain (or the reverse) in
  place via Manage Players, keeping their login (team code + password) untouched.
- **Admin-as-voter**: a small number of admin accounts are flagged `is_player=True` so that
  same login can also cast an availability vote — counted in the dashboard/summary/exports/
  auction pool like any other voter.
- **Captain/player promoted to admin (the reverse case)**: an existing captain/player account
  can be granted admin capability via `is_admin=True` without changing their role or login —
  checked via `admin_required`'s `{"role": "admin"} OR {"is_admin": True}`. A `linked_captain_id`
  then ties such an account to the real captain record it corresponds to, so it can be blocked
  from running an auction it would also be bidding in (see [Auction rules](#auction-rules)).
- **Self-service reset from the login page**: a "Reset Password" link next to the password
  field leads to a public `/reset-password` form (team code + current password + new
  password) — for anyone who remembers their current password but isn't/can't get logged in.
  A wrong team code and a wrong password return the identical error so it can't be used to
  probe which codes are real. Admin accounts are excluded, same as every other password-reset
  path. Forgetting the current password entirely falls back to an admin-assisted reset, or the
  support contact shown on the login page.

---

## Attendance & knockout eligibility

A separate tracking system from match-slot voting — this is about real-world season
attendance, used to decide who's eligible once the league stage ends and a knockout round
begins.

- Every voter has their own **matches present** / **total matches** counters. A single "+1"
  button per row credits one more match to that person alone.
- **Attendance %** (`matches_present / total_matches`) is recomputed immediately on every
  +1 click, and is what ranks and highlights the list.
- A configurable **knockout cutoff** (default top 14) can auto-mark the top N ranked voters
  as `knockout_eligible` in one click; admin can hand-adjust individual checkboxes after.
  Bulk edits show an "Unsaved changes" indicator and warn before an accidental refresh/close
  discards them.
- Purely a selection aid — `knockout_eligible` doesn't gate voting or auction participation.

---

## Performance & reliability

- **gzip compression** enabled at the nginx origin — off by default in the base image, and
  `gzip_proxied` had to be set explicitly since nginx doesn't compress proxied `/api/`
  responses by default even with `gzip on`.
- **Rate limiting on login and password-reset** — 10 attempts per 5 minutes, keyed on the
  `team_code` being attacked rather than caller IP (this app sits behind CloudFront → Caddy
  with no verified trusted-proxy chain, so IP-keying would be unreliable). Backed by
  MongoDB (`flask-limiter` + the `limits` library's Mongo storage), not in-memory.
- **MongoDB indexes** on every field the app actually filters/sorts on — consolidated in
  `backend/app/indexes.py` (single source of truth, also used by `scripts/seed.py`),
  applied idempotently on every app boot.
- **Route-level code splitting** (`React.lazy` in `App.jsx`) — a captain never downloads
  the 5 admin pages' code and vice versa; only `Login`/`ResetPassword` stay eagerly loaded.
- **Batched admin dashboard queries** — per-slot voting-window/auction lookups are 2 batched
  `$in` queries instead of N per-slot round trips, since this endpoint is polled every 5-10s
  from two different admin pages.
- **WebP background images**, quality-tuned to how visible each one actually is.
- **No horizontal replicas** in the current single-EC2 Docker Compose deployment — the old
  K3s deployment ran 2 pod replicas per service; the current setup relies on gunicorn's own
  2 worker processes for backend concurrency instead. See
  [INFRASTRUCTURE.md](INFRASTRUCTURE.md#operational-notes).
- **Error tracking (Sentry)**: SDK is wired into both frontend (`Sentry.ErrorBoundary`) and
  backend (Flask integration) and already deployed, but currently **inert** — no DSN is
  configured yet. Both sides no-op safely without one.

---

## Project structure

```
BCC-CVote/
├── backend/
│   ├── app/
│   │   ├── __init__.py            # Flask app factory, blueprint registration
│   │   ├── config.py
│   │   ├── indexes.py             # single source of truth for Mongo indexes — also used by scripts/seed.py
│   │   ├── routes/
│   │   │   ├── auth.py            # /api/auth/* — login, device binding, change-password
│   │   │   ├── votes.py           # /api/slots, /api/votes/* — self-service voting + named per-slot attendance
│   │   │   ├── admin.py           # /api/admin/* — captains/players, windows, ad-hoc slots,
│   │   │   │                      #   admin vote override, attendance/knockout tracking,
│   │   │   │                      #   reset-device/reset-password, exports
│   │   │   └── auction.py         # /api/admin/auction/*, /api/auction/* — live + practice auctions, chat
│   │   ├── services/weather.py    # OpenWeatherMap call + Mongo-cached forecast lookup
│   │   └── utils/
│   │       ├── auth.py            # JWT decorators + token_version session-invalidation check
│   │       ├── passwords.py       # shared password validation + temp-password generation
│   │       ├── time_utils.py      # IST timezone helpers, voting-window logic
│   │       └── export.py          # CSV/Excel report builders
│   ├── scripts/                   # seed.py + one-off migrations (credential regen, roster
│   │                              #   sync, admin-access grants — see Accounts & security)
│   ├── tests/                     # pytest — auth, auction lifecycle, password/device security,
│   │                              #   admin vote override, attendance
│   ├── Dockerfile, gunicorn.conf.py, run.py
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Login.jsx, ResetPassword.jsx  # public self-service reset form
│   │   │   ├── CaptainDashboard.jsx, PlayerDashboard.jsx, Results.jsx, Auction.jsx
│   │   │   ├── ChangePassword.jsx  # forced/self-service password change
│   │   │   └── admin/
│   │   │       ├── AdminDashboard.jsx  # captain×slot grid + per-slot "yet to vote" mark-vote panel
│   │   │       ├── ManagePlayers.jsx   # captains + players, merged into one page
│   │   │       ├── VotingWindow.jsx    # "Add Ad-hoc Match" form + Confirmed/Pending turnout
│   │   │       ├── Attendance.jsx      # +1 attendance credit + knockout-eligibility ranking
│   │   │       └── Auction.jsx         # auction setup + live control screen
│   │   ├── components/       # Navbar, SlotCard, VotingSlots, WeatherForecast, Footer,
│   │   │                      #   AuctionRulesNote, AuctionChat, PasswordInput,
│   │   │                      #   PageBackgroundPhoto, LoadingState, ConfirmDialog,
│   │   │                      #   ConfirmedPlayersPanel, YetToVotePanel
│   │   ├── hooks/             # useVoting.js, useAuction.js (2.5s polling), useConfirm.js
│   │   ├── context/AuthContext.jsx   # sessionStorage-based — per-tab login isolation
│   │   ├── config/appMeta.js  # app name/version, tournament name, company name
│   │   ├── utils/             # api.js, device.js, roles.js, formatDate.js, pwaUpdate.js
│   │   └── App.jsx
│   ├── Dockerfile, nginx.conf, vite.config.js  # vite-plugin-pwa (autoUpdate)
├── deploy/                    # docker-compose.prod.yml, Caddyfile, deploy.sh — see INFRASTRUCTURE.md
├── terraform-new-account/     # current prod infra (EC2, ECR, SSM, IAM) — see INFRASTRUCTURE.md
├── terraform/                 # RETIRED — old (decommissioned) account, kept for history only
└── .github/workflows/
    ├── dev-ci.yml
    └── prod-cd-newaccount.yml # the only prod deploy pipeline
```

---

## Known limitations / pending decisions

- **Per-device login lock is disabled for all users** (`DEVICE_LOCK_ENABLED=false`) — see
  [Accounts & security](#accounts--security). No end date set; check with the team before
  re-enabling.
- **Sentry error tracking is wired but inert** — no DSN configured yet. Finishing it needs no
  more code, just a `sentry-dsn` SSM parameter and a `VITE_SENTRY_DSN` GitHub Actions secret.
- **No horizontal redundancy** — single EC2, single container per service. A crash/OOM causes
  a brief outage until Docker restarts the container, not a seamless failover. See
  [INFRASTRUCTURE.md](INFRASTRUCTURE.md#operational-notes).
- The old per-match attendance checklist (`league_matches` collection, `/admin/attendance/
  matches/*` routes) is retired from the frontend but not removed from the backend — low
  priority, not causing any issue, just unused code.
- No Playwright (or other browser-automation) dependency committed to the project — some
  features have been visually verified with a throwaway local Playwright install, but there's
  no repeatable e2e suite in CI. Backend has a real pytest suite (`backend/tests/`).
- A "Stumps" (third-party cricket scoring app) integration was investigated for pulling match
  score/stats automatically — no public API, webhooks, or export beyond PDF/image exists, so
  this remains a manual-entry gap. Contacted their support (`support@stumpsapp.com`) to check
  for an unlisted org-tier API; no automated integration built yet.
