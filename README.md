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
   soft-removable, doesn't touch the original 4.
3. **Live player auction** — once a match's availability is known, admin runs a live
   points-based auction between two designated captains to split everyone who voted
   available into two balanced XIs. See [Auction rules](#auction-rules) below.
4. **Attendance & knockout-eligibility tracking** — admin logs actual attendance per
   completed league match (checklist of who showed up), independent of the voting
   system. Voters are ranked by % of league matches attended, with a configurable
   cutoff to auto-mark the top N as eligible for knockout-stage selection.
5. **Account security & self-service** — scrypt-hashed passwords with minimum-length /
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
redeploys both images.

---

## Infrastructure

- **k3s node**: single EC2 instance (t3.small, 2GB RAM — intentionally kept small; see
  `terraform/main.tf` comments for the memory-budget tradeoffs of what runs on it).
  Runs: k3s control plane, Traefik (ingress), CoreDNS, local-path-provisioner, the app
  (`bcc-backend`/`bcc-frontend` in the `voting-prod` namespace), and the self-hosted
  Actions runner.
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
- Captains are never part of their own auctioned pool, even if they voted available for
  that match.
- Session cap: 25 minutes from admin clicking Start; any players still unresolved at that
  point are distributed evenly between both captains.
- **Release order is automatic, not admin's pick** — admin only clicks "Release Next" per
  category; the next player up is chosen by ranked batting/bowling average, never a manual
  name pick. This also closes off a social-engineering angle (no way to steer who comes up).
- **Both-captains-decline queue** — if both captains pass on a player at the 8.5 base price,
  that player becomes the deprioritized last option in their category instead of just
  re-entering the normal pool; they're only revisited once every other player in the
  category is resolved, and are still covered by the quota/leftover-award rules above.
- **Live quota-balance preview** — the setup screen shows a per-category breakdown of the
  selected slot's confirmed voters before the auction is even created, flagging odd counts
  (⚠️ won't split evenly) and missing categories, so admin can fix roster tagging in Manage
  Players before hitting Create.
- **Shared "Available Players" pool panel** — both captains' live auction view shows a
  running count of unsold players left per category (highlighting whoever's currently up
  for bid), so neither side is guessing what's left.
- **Post-completion confidentiality** — once an auction is closed, bid prices, remaining
  points, and how each player was assigned are stripped from the API response entirely
  (not just hidden in the UI). Only the final name-and-category rosters remain visible.

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
  place via Manage Players/Captains, keeping their login (team code + password) untouched
  instead of creating a new account under a different code.
- **Admin-as-voter**: a small number of admin accounts (used for admin-side testing) are
  flagged `is_player=True` so that same login can also cast an availability vote via
  `/player/dashboard` — counted in the dashboard/summary/exports/auction pool like any other
  voter — without becoming a separate captain/player account or gaining a normal player's
  restrictions. Bootstrapped once via `backend/scripts/flag_admin_voters.py` against named
  `team_code`s (never by name, to avoid mismatching real players who share a name).

---

## Attendance & knockout eligibility

A separate tracking system from match-slot voting — this is about real-world turnout
across a league season, used to decide who's eligible once the league stage ends and a
knockout round begins.

- Admin logs each completed league match as its own record and checks off who actually
  showed up (a per-match attendee checklist), with an inline "quick add" to log a brand-new
  match without leaving the checklist for an existing one.
- Every voter is ranked by **% of league matches attended**, sorted high to low.
- A configurable **knockout cutoff** (default top 28) can auto-mark the top N ranked voters
  as `knockout_eligible` in one click; admin can still hand-adjust individual flags after.
- Purely a selection aid — `knockout_eligible` doesn't gate voting or auction participation,
  it's just a flag admin uses when picking knockout-stage lineups.

---

## Project structure

```
BCC-CVote/
├── backend/
│   ├── app/
│   │   ├── __init__.py            # Flask app factory, blueprint registration
│   │   ├── config.py
│   │   ├── routes/
│   │   │   ├── auth.py            # /api/auth/* — login, device binding, change-password
│   │   │   ├── votes.py           # /api/slots, /api/votes/* — voting + named per-slot attendance
│   │   │   ├── admin.py           # /api/admin/* — captains, players, windows, ad-hoc slots,
│   │   │   │                      #   attendance/knockout tracking, reset-device/reset-password, exports
│   │   │   └── auction.py         # /api/admin/auction/*, /api/auction/* — the live auction
│   │   ├── services/weather.py    # OpenWeatherMap call + Mongo-cached forecast lookup
│   │   └── utils/
│   │       ├── auth.py            # JWT decorators + token_version session-invalidation check
│   │       ├── passwords.py       # shared password validation + temp-password generation
│   │       ├── time_utils.py      # IST timezone helpers, voting-window logic
│   │       └── export.py          # CSV/Excel report builders
│   ├── scripts/seed.py
│   ├── tests/                     # pytest — auth, auction lifecycle, password/device security
│   ├── Dockerfile, gunicorn.conf.py, run.py
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── CaptainDashboard.jsx, PlayerDashboard.jsx, Results.jsx, Auction.jsx
│   │   │   ├── ChangePassword.jsx  # forced/self-service password change
│   │   │   └── admin/
│   │   │       ├── AdminDashboard.jsx, ManageCaptains.jsx, ManagePlayers.jsx
│   │   │       ├── VotingWindow.jsx    # includes the "Add Ad-hoc Match" form
│   │   │       ├── Attendance.jsx      # league match checklist + knockout-eligibility ranking
│   │   │       └── Auction.jsx         # auction setup + live control screen
│   │   ├── components/       # Navbar, SlotCard, VotingSlots, WeatherForecast,
│   │   │                      #   AuctionRulesNote, PageBackgroundPhoto
│   │   ├── hooks/             # useVoting.js, useAuction.js (2.5s polling)
│   │   ├── context/AuthContext.jsx   # sessionStorage-based — per-tab login isolation
│   │   ├── utils/pwaUpdate.js  # service-worker update detection/reload
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
- A stale, superseded branch — `feature/admin-dual-role-voter` — still exists in the repo.
  It duplicates work already shipped directly to `main` in commit `5f17eea` (admin accounts
  flagged `is_player` can vote as themselves — see [Accounts & security](#accounts--security)),
  and is 57 commits behind. Safe to delete; do not merge it.
- cert-manager, external-secrets, and monitoring exporters are scaled to 0 (see
  [Infrastructure](#infrastructure)) — not a permanent decision yet.
- The k3s node's control-plane process alone uses ~770MB of the node's 2GB RAM at idle —
  there's limited headroom regardless of what add-ons run alongside the app.
- A handful of duplicate captain accounts created during early auction testing (team codes
  `CHT`, `MLS`, `NDU`, `PDU`, `PHK`, `RMP`, `SDA`, `SKS`, `SRN`) are soft-deactivated but not
  hard-deleted — those codes remain reserved.
- No Playwright (or other browser-automation) dependency committed to the project — some
  features have been visually verified with a throwaway local Playwright install, but there's
  no repeatable e2e suite in CI. Backend has a real pytest suite (`backend/tests/`).
