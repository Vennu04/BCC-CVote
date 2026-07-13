# BCC-CVote 🏏

Cricket club app for weekend match-availability voting and a live points-based player
auction to split available players into two balanced teams.

**Live:** https://d2welg0wjdnhjp.cloudfront.net

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
   Saturday, a public holiday, etc.) on top of the 4 fixed slots. Same voting mechanism,
   soft-removable, doesn't touch the original 4. Ad-hoc slots sharing the same date are
   grouped side by side on Voting Windows so admin can compare turnout between candidate
   slots for the same day.
3. **Admin can cast or change anyone's vote** — for the real case where a captain/player
   confirmed by phone/WhatsApp but couldn't cast their own vote in the app in time (mobile
   issues, travel, work). Two entry points, both usable regardless of whether that slot's
   window is still open or already closed:
   - **Admin Dashboard**: each slot's stat card has a "yet to vote" toggle that expands to
     the actual list of non-voters, with inline ✅/🤔/❌ buttons.
   - **Voting Window / Auction setup**: every name in the Confirmed/Pending turnout panel
     is clickable — set a first vote immediately, or change an existing one (asks for
     confirmation first, since that overwrites a real answer). See
     [Admin vote management](#admin-vote-management) below.
4. **Live player auction** — once a match's availability is known, admin runs a live
   points-based auction between two designated captains to split everyone who voted
   available into two balanced XIs. Admin releases only the very first player by hand;
   the system auto-releases every player after that and auto-advances across categories
   on its own, all the way to completion. See [Auction rules](#auction-rules) below.
5. **Attendance & knockout-eligibility tracking** — real season attendance (matches present
   / total matches, tracked with a simple "+1" per player/captain), independent of the
   voting system. Voters are ranked by attendance %, with a configurable cutoff to
   auto-mark the top N as eligible for knockout-stage selection. See
   [Attendance & knockout eligibility](#attendance--knockout-eligibility) below.
6. **Account security & self-service** — scrypt-hashed passwords with minimum-length /
   not-all-numeric validation, forced password change on first login or after an admin
   reset, per-device login lock (toggle-able), and immediate session invalidation on any
   password change. See [Accounts & security](#accounts--security) below.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS + React Router v6 + Axios, PWA (vite-plugin-pwa) |
| Backend | Flask 3 + PyMongo + flask-jwt-extended + gunicorn (sync workers), pytz (IST) |
| Database | MongoDB, self-hosted on its own dedicated EC2 instance (not Atlas) |
| Prod infra | K3s (single-node) on AWS EC2 (ap-south-1), Traefik ingress, CloudFront in front |
| CI/CD | GitHub Actions — build/scan on GitHub-hosted runners, deploy via a **self-hosted runner** on the k3s instance itself (see [Deployment](#deployment--cicd)) |
| IaC | Terraform — EC2 (k3s + mongodb), ECR, SSM Parameter Store, CloudFront |
| Container registry | AWS ECR, OIDC deploy role (no static AWS keys in CI) |
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
- MongoDB: localhost:27017 (mongo:7.0 container)
- Admin login: `ADMIN` / `admin@bcc2024` (seed default)
- Captain/player default password: their team code, lowercase (e.g. `MI` → `mi`)

Stop: `docker-compose down`

---

## Deployment / CI/CD

**No ArgoCD, no GitOps polling.** `prod-cd.yml` pushes directly to the cluster:

1. **`build-and-push`** job (GitHub-hosted `ubuntu-latest`): checkout → AWS OIDC auth →
   ECR login → build backend+frontend images → Trivy scan → push to ECR.
2. **`deploy`** job (**self-hosted runner living on the k3s EC2 instance**): updates the
   image tag in `k8s/prod/{backend,frontend}-deployment.yaml` → `kubectl apply` (scoped to
   just those two files, via a least-privilege `github-actions-deployer` ServiceAccount, not
   the cluster-admin kubeconfig) → `kubectl rollout status` → smoke-tests the live URL →
   **auto rollback** (`kubectl rollout undo`) if the rollout or smoke test fails.

The self-hosted runner exists because the k3s API (6443) and SSH are both firewalled to a
static home IP in the security group — a GitHub-hosted runner has no network path in, but a
runner living on the box itself just polls GitHub outbound over 443 (already open).

The existing `maxSurge: 1, maxUnavailable: 0` rolling-update strategy on both Deployments
already gives a sequential (not simultaneous) cutover — the new pod must pass its readiness
probe before the old one is killed. No parallel blue/green Deployment pair needed.

Push to `main` → pipeline runs automatically. No path filter — any push rebuilds and
redeploys both images. Each successful run also commits its own image-tag bump back to
`main` (`chore: deploy <sha> to prod [skip ci]`) — expect `git pull`/`git fetch` to show
one of these after every deploy; they're informational only, not app changes.

---

## Infrastructure

- **k3s node**: single EC2 instance (t3.small, 2GB RAM — intentionally kept small; see
  `terraform/main.tf` comments for the memory-budget tradeoffs of what runs on it).
  Runs: k3s control plane, Traefik (ingress), CoreDNS, local-path-provisioner, the app
  (`bcc-backend`/`bcc-frontend` in the `voting-prod` namespace, **2 replicas each**), and
  the self-hosted Actions runner. 2 replicas protects against a pod-level crash/OOM/
  liveness-restart dropping requests mid-auction — it does **not** protect against the
  underlying EC2 node itself going down, since this is still a single-node cluster.
  Real node headroom was checked (via `free`/`vmstat`, not just k8s's own resource-request
  accounting) before doubling replica counts — k3s itself is the dominant memory consumer,
  not the app pods.
- **MongoDB**: separate dedicated EC2 instance, not co-located with the app node.
- **CloudFront**: sits in front of the k3s node's Elastic IP (origin is a hardcoded
  `*.sslip.io` hostname matching the EIP — Traefik's ingress only matches that Host header).
  Caching fully disabled (dynamic app, not cacheable).
- **ECR pull-secret auto-refresh**: a systemd timer (`refresh-ecr-secret.timer`) on the k3s
  instance refreshes the image-pull secret every 6h + shortly after every boot — ECR tokens
  expire after 12h, and this replaces an earlier cron-based attempt that was written into
  Terraform's `user_data` but never actually took effect on the running instance.
- **cert-manager / external-secrets / monitoring exporters**: currently scaled to 0 on the
  live instance (not removed from Terraform) — a capacity tradeoff made during an incident
  where the full stack together exhausted the 2GB node's memory. Pending decision: leave off
  permanently, move to a separate node, or upsize the instance.

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
- Captains are never part of their own auctioned pool, even if they voted available for
  that match. If a captain also has admin capability (see
  [Accounts & security](#accounts--security)), they're additionally blocked from running an
  auction they'd be participating in themselves.
- Session cap: 25 minutes from admin clicking Start; any players still unresolved at that
  point are distributed evenly between both captains.
- **Fully automatic release, one click to start** — admin releases only the very first
  player of the whole auction by hand; the next player up is always chosen by ranked
  batting/bowling average, never a manual name pick, and releases itself the instant the
  previous player's bidding resolves (sold, both-captains-passed, or leftover-award). Once
  a category runs out, the system auto-advances to the next one on its own too, cycling
  through **Extra Power All-Rounders → Extra Power Batsmen → Power → Classic** starting
  wherever admin's one manual click began — no further clicks needed for the rest of the
  auction. This also closes off a social-engineering angle (no way to steer who comes up).
  Concurrency-safe via a MongoDB compare-and-swap on the "claim this release" write, since
  the backend runs real parallel gunicorn workers.
- **Admin can still pause/resume** the auto-release chain at any point without losing
  progress — useful for a mid-auction break; nothing auto-releases while paused.
- **Both-captains-decline queue** — if both captains pass on a player at the 8.5 base price,
  that player becomes the deprioritized last option in their category instead of just
  re-entering the normal pool; they're only revisited once every other player in the
  category is resolved, and are still covered by the quota/leftover-award rules above.
  Whichever captain's own drop click actually decides something (sold, or both passed)
  gets an explicit on-screen confirmation of that outcome — a routine drop mid-bidding-war
  (the other side hasn't acted yet) stays silent, since that one doesn't need confirming.
- **Completion signal** — a persistent banner (plus a one-time toast) appears for admin the
  moment every player in the pool has been resolved, computed live from the pool's own
  state rather than a separate flag, so it can't miss or double-fire depending on which
  request happens to observe it first.
- **Live quota-balance preview** — the setup screen shows a per-category breakdown of the
  selected slot's confirmed voters before the auction is even created, flagging odd counts
  (⚠️ won't split evenly) and missing categories, so admin can fix roster tagging in Manage
  Players before hitting Create. Every name in this preview is clickable — see
  [Admin vote management](#admin-vote-management).
- **Shared "Available Players" pool panel** — both captains' live auction view shows a
  running count of unsold players left per category (highlighting whoever's currently up
  for bid), so neither side is guessing what's left.
- **Post-completion confidentiality** — once an auction is closed, bid prices, remaining
  points, and how each player was assigned are stripped from the API response entirely
  (not just hidden in the UI). Only the final name-and-category rosters remain visible.

---

## Admin vote management

For the real-world case where a captain/player confirmed availability by phone/WhatsApp but
couldn't cast (or fix) their own vote in the app in time.

- `POST /admin/votes` sets or changes anyone's vote for any slot; `DELETE
  /admin/votes/<slot_id>/<user_id>` clears one. Both are admin-only and deliberately bypass
  the self-service rules in `votes.py` (window must be open to vote at all; a short
  emergency-revoke deadline after close) — admin acting on an explicit request is a
  different trust boundary, and the whole point is that it still works after those
  deadlines pass. Works identically for the 4 fixed slots and any ad-hoc match.
- Two places to use it:
  - **Admin Dashboard** — each slot's stat card shows a "yet to vote" count; expanding it
    lists exactly those non-voters with one-click ✅ Available / 🤔 Maybe / ❌ Not Available
    buttons.
  - **Voting Window / Auction setup screen** — the Confirmed/Pending turnout panel
    (`ConfirmedPlayersPanel`) makes every name clickable, for both groups. Marking someone
    with no vote yet happens immediately; changing someone who already has a vote recorded
    (including a "Pending" person who actually voted maybe/not_available, not just a true
    non-voter) asks for confirmation first, since that overwrites a real answer rather than
    filling a blank.
- Every override — set or clear — is logged to the `vote_overrides` collection (admin,
  target person, slot, old → new availability, timestamp), the same accountability pattern
  already used for `password_resets`.

---

## Accounts & security

- Passwords are hashed with Werkzeug's **scrypt** (memory-hard, no legacy scheme).
- **Password rules**: minimum 6 characters, rejected if all-numeric — enforced identically
  on self-service change, admin-set, and admin-reset paths via one shared validator.
- **Forced password change**: required on first login (default password) and immediately
  after any admin-driven reset; there's no way to navigate around it while it's pending.
- **Admin-assisted reset**: a "Reset Password" action next to each captain/player generates
  a random temp password (readable-over-the-phone alphabet — no `0/O/1/l/I`), sets the
  forced-change flag, and logs who reset whose password and when.
- **Session invalidation**: every account has a `token_version` counter embedded in its JWT;
  changing a password bumps it, instantly invalidating every other active session for that
  account — including a hijacked one — without needing server-side token storage. The tab
  that just changed its own password is reissued a fresh token in the same response, so it
  isn't logged out by its own action.
- **Per-device login lock**: a captain/player account is bound to the first device it logs
  in from; a second device is rejected until admin clicks "Reset Device." Governed by
  `DEVICE_LOCK_ENABLED` (config/ConfigMap) — **currently disabled in prod** while players
  test the app across multiple devices of their own; re-enable by flipping it back once
  that testing period ends.
- **Role promotion**: admin can convert an existing player to captain (or the reverse) in
  place via Manage Players, keeping their login (team code + password) untouched instead of
  creating a new account under a different code. (Manage Captains and Manage Players used to
  be two separate pages/routes — they were merged into one Manage Players page; the old
  `/admin/captains` and `/admin/people` routes now just redirect there.)
- **Admin-as-voter**: a small number of admin accounts (used for admin-side testing) are
  flagged `is_player=True` so that same login can also cast an availability vote via
  `/player/dashboard` — counted in the dashboard/summary/exports/auction pool like any other
  voter — without becoming a separate captain/player account or gaining a normal player's
  restrictions. Bootstrapped once via `backend/scripts/flag_admin_voters.py` against named
  `team_code`s (never by name, to avoid mismatching real players who share a name).
- **Captain/player promoted to admin (the reverse case)**: `backend/scripts/
  grant_admin_access.py` grants admin capability to an existing captain/player account by
  `team_code`, without changing their role or login — checked via `admin_required`'s
  `{"role": "admin"} OR {"is_admin": True}`, looked up fresh on every request (no JWT
  re-issue needed; an already-open session just won't see the Admin nav until it re-fetches
  `/auth/me`). `backend/scripts/link_dual_role_captains.py` then links such an account to
  the real captain record it corresponds to, so `create_auction` can refuse to let them run
  an auction they'd also be bidding in themselves (a conflict of interest over release timing
  and order).
- **Self-service reset from the login page**: a "Reset Password" link next to the password
  field leads to a public `/reset-password` form (team code + current password + new
  password) — for anyone who remembers their current password but isn't/can't get logged
  in. Same validation and current-password check as the in-app change-password flow, just
  reachable without a session; a wrong team code and a wrong password return the identical
  error so it can't be used to probe which codes are real. Admin accounts are excluded, same
  as every other password-reset path. Forgetting the current password entirely still falls
  back to an admin-assisted reset.
- **Bulk credential regeneration**: `backend/scripts/regenerate_credentials.py` is a one-off
  migration that gives every active captain/player a fresh random 4-letter team_code and
  8-character password in one pass, sets the forced-change flag, invalidates existing
  sessions, and unsets device bindings. The generated passwords are never stored anywhere —
  they're written once to STDOUT as a CSV (progress/summary go to STDERR instead), meant to
  be redirected straight into the file admin distributes:
  `docker exec bcc-backend python scripts/regenerate_credentials.py > credentials.csv`.
  Never touches admin accounts.
- **Roster reconciliation**: `backend/scripts/sync_players.py` is a one-off migration that
  deactivates leftover demo/IPL captain accounts, flags existing captains who are also on
  the real player roster with `is_player=True` (one login, dual capability — no duplicate
  account), and creates new `role="player"` accounts for roster names with no existing
  account.

---

## Attendance & knockout eligibility

A separate tracking system from match-slot voting — this is about real-world season
attendance, used to decide who's eligible once the league stage ends and a knockout round
begins.

- Every voter has their own **matches present** / **total matches** counters. A single "+1"
  button per row (Manage Attendance page) credits one more match to that person alone —
  there's no shared "a match happened" event tying multiple people's numbers together, each
  person's own click advances their own two counters independently.
- **Attendance %** (`matches_present / total_matches`) is recomputed immediately on every
  +1 click, and is what ranks and highlights the list — not a separate league-match
  checklist.
- A configurable **knockout cutoff** (default top 14) can auto-mark the top N ranked voters
  as `knockout_eligible` in one click; admin can still hand-adjust individual checkboxes
  after, and "Save All" persists both the cutoff and any hand-adjustments together.
- Purely a selection aid — `knockout_eligible` doesn't gate voting or auction participation,
  it's just a flag admin uses when picking knockout-stage lineups.
- An older design tracked attendance via a per-match checklist (`league_matches` collection,
  admin logs each completed match and checks off who showed up). Those backend routes
  (`/admin/attendance/matches/*`) and their tests still exist and pass, but nothing in the
  current frontend drives them anymore — retired in favor of the simpler +1-per-person
  model above once the checklist approach turned out to sit mostly empty in practice.

---

## Performance & reliability

- **2 replicas** for both backend and frontend Deployments (see
  [Infrastructure](#infrastructure)) — survives a pod-level crash/restart without dropping
  live-auction requests.
- **gzip compression** enabled at the nginx origin (`frontend/nginx.conf`) — off by default
  in the base image, and `gzip_proxied` had to be set explicitly since nginx doesn't
  compress proxied `/api/` responses by default even with `gzip on`.
- **Rate limiting on login and password-reset** — 10 attempts per 5 minutes, keyed on the
  `team_code` being attacked rather than caller IP (this app sits behind CloudFront →
  Traefik → nginx with no verified trusted-proxy chain, so IP-keying would be unreliable).
  Backed by MongoDB (`flask-limiter` + the `limits` library's Mongo storage) rather than
  in-memory, so the count is correctly shared across both replicas × 2 gunicorn workers
  each instead of getting split 4 ways and never tripping.
- **MongoDB indexes** on every field the app actually filters/sorts on — consolidated in
  `backend/app/indexes.py` (single source of truth, also used by `scripts/seed.py`),
  applied idempotently on every app boot rather than needing a separate migration step.
- **Route-level code splitting** (`React.lazy` in `App.jsx`) — a captain never downloads
  the 5 admin pages' code and vice versa; only `Login`/`ResetPassword` stay eagerly loaded.
- **WebP background images**, quality-tuned to how visible each one actually is (the
  low-opacity admin dashboard photos are compressed harder than the login page, which is
  both more visible and the highest-traffic page in the app).
- **Error tracking (Sentry)**: SDK is wired into both frontend (`Sentry.ErrorBoundary`) and
  backend (Flask integration) and already deployed, but currently **inert** — no DSN is
  configured yet. Both sides no-op safely without one. See `frontend/src/utils/sentry.js`
  and `backend/app/__init__.py`.

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
│   │   │   └── auction.py         # /api/admin/auction/*, /api/auction/* — the live auction
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
│   │   │                      #   AuctionRulesNote, PageBackgroundPhoto, LoadingState,
│   │   │                      #   ConfirmDialog, ConfirmedPlayersPanel, YetToVotePanel
│   │   ├── hooks/             # useVoting.js, useAuction.js (2.5s polling), useConfirm.js
│   │   ├── context/AuthContext.jsx   # sessionStorage-based — per-tab login isolation
│   │   ├── config/appMeta.js  # app name/version, company name (shown in Footer)
│   │   ├── utils/             # api.js, device.js, roles.js, formatDate.js, pwaUpdate.js
│   │   └── App.jsx
│   ├── Dockerfile, nginx.conf, vite.config.js  # vite-plugin-pwa (autoUpdate)
├── k8s/prod/                  # applied directly by the deploy job (no GitOps controller)
├── terraform/                 # EC2 (k3s + mongodb), ECR, SSM, CloudFront, IAM
└── .github/workflows/
    ├── dev-ci.yml
    └── prod-cd.yml             # build-and-push (hosted) + deploy (self-hosted runner)
```

---

## Known limitations / pending decisions

- **Per-device login lock is currently disabled in prod** (`DEVICE_LOCK_ENABLED=false`)
  while players test across multiple devices — see [Accounts & security](#accounts--security).
  No end date set; check with the team before re-enabling.
- **Sentry error tracking is wired but inert** — no DSN configured yet (see
  [Performance & reliability](#performance--reliability)). Finishing it needs no more code,
  just a `VITE_SENTRY_DSN` GitHub Actions secret and a `SENTRY_DSN` key in the
  `bcc-cvote-secret` K8s secret.
- cert-manager, external-secrets, and monitoring exporters are scaled to 0 (see
  [Infrastructure](#infrastructure)) — not a permanent decision yet.
- The k3s node's control-plane process alone uses ~770MB of the node's 2GB RAM at idle —
  there's limited headroom regardless of what add-ons run alongside the app.
- A handful of duplicate captain accounts created during early auction testing (team codes
  `CHT`, `MLS`, `NDU`, `PDU`, `PHK`, `RMP`, `SDA`, `SKS`, `SRN`) are soft-deactivated but not
  hard-deleted — those codes remain reserved.
- The old per-match attendance checklist (`league_matches` collection, `/admin/attendance/
  matches/*` routes) is retired from the frontend but not removed from the backend — see the
  note in [Attendance & knockout eligibility](#attendance--knockout-eligibility). Low
  priority; not causing any issue, just unused code.
- No Playwright (or other browser-automation) dependency committed to the project — some
  features have been visually verified with a throwaway local Playwright install, but there's
  no repeatable e2e suite in CI. Backend has a real pytest suite (`backend/tests/`).
