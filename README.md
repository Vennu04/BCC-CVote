# BCC-CVote 🏏

Cricket club app for weekend match-availability voting and a live points-based player
auction to split available players into two balanced teams.

**Live:** https://d2welg0wjdnhjp.cloudfront.net

---

## What it does

1. **Weekend availability voting** — 4 fixed recurring slots (Sat/Sun Morning/Evening).
   Admin opens/closes a voting window per slot; captains and players mark themselves
   available/not-available/maybe.
2. **Ad-hoc dated matches** — admin can add a one-off match for any date (a weather-driven
   Saturday, a public holiday, etc.) on top of the 4 fixed slots. Same voting mechanism,
   soft-removable, doesn't touch the original 4.
3. **Live player auction** — once a match's availability is known, admin runs a live
   points-based auction between two designated captains to split everyone who voted
   available into two balanced XIs. See [Auction rules](#auction-rules) below.

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

---

## Project structure

```
BCC-CVote/
├── backend/
│   ├── app/
│   │   ├── __init__.py            # Flask app factory, blueprint registration
│   │   ├── config.py
│   │   ├── routes/
│   │   │   ├── auth.py            # /api/auth/*
│   │   │   ├── votes.py           # /api/slots, /api/votes/*
│   │   │   ├── admin.py           # /api/admin/* — captains, players, windows, ad-hoc slots, exports
│   │   │   └── auction.py         # /api/admin/auction/*, /api/auction/* — the live auction
│   │   └── utils/
│   │       ├── auth.py            # JWT decorators (admin_required, captain_required, get_current_user)
│   │       ├── time_utils.py      # IST timezone helpers, voting-window logic
│   │       └── export.py          # CSV/Excel report builders
│   ├── scripts/seed.py
│   ├── Dockerfile, gunicorn.conf.py, run.py
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── CaptainDashboard.jsx, PlayerDashboard.jsx, Results.jsx, Auction.jsx
│   │   │   └── admin/
│   │   │       ├── AdminDashboard.jsx, ManageCaptains.jsx, ManagePlayers.jsx
│   │   │       ├── VotingWindow.jsx    # includes the "Add Ad-hoc Match" form
│   │   │       └── Auction.jsx         # auction setup + live control screen
│   │   ├── components/       # Navbar (auto-detects an active auction), SlotCard, VotingSlots
│   │   ├── hooks/             # useVoting.js, useAuction.js (2.5s polling)
│   │   ├── context/AuthContext.jsx   # sessionStorage-based — per-tab login isolation
│   │   └── App.jsx
│   ├── Dockerfile, nginx.conf
├── k8s/prod/                  # applied directly by the deploy job (no GitOps controller)
├── terraform/                 # EC2 (k3s + mongodb), ECR, SSM, CloudFront, IAM
└── .github/workflows/
    ├── dev-ci.yml
    └── prod-cd.yml             # build-and-push (hosted) + deploy (self-hosted runner)
```

---

## Known limitations / pending decisions

- cert-manager, external-secrets, and monitoring exporters are scaled to 0 (see
  [Infrastructure](#infrastructure)) — not a permanent decision yet.
- The k3s node's control-plane process alone uses ~770MB of the node's 2GB RAM at idle —
  there's limited headroom regardless of what add-ons run alongside the app.
- A handful of duplicate captain accounts created during early auction testing (team codes
  `CHT`, `MLS`, `NDU`, `PDU`, `PHK`, `RMP`, `SDA`, `SKS`, `SRN`) are soft-deactivated but not
  hard-deleted — those codes remain reserved.
- No browser-automation testing in this environment — UI changes are verified via direct API
  calls and clean production builds, not an actual browser click-through.
