# Infrastructure

Where BCC-CVote actually runs today, how it deploys, and how it got here. Feature/product
docs live in [README.md](README.md) — this file is ops-only.

**Live:** https://d2welg0wjdnhjp.cloudfront.net

---

## Current architecture (as of 2026-08-18)

```
players/captains
      │
      ▼
CloudFront (old AWS account 661474704151, dist E1EZ6V1244PHBR)
      │  origin: 13-234-252-190.sslip.io
      ▼
Caddy (TLS termination + reverse proxy, auto Let's Encrypt via HTTP-01)
      │
      ▼
frontend (nginx, serves the React build, proxies /api/ →)
      │
      ▼
backend (gunicorn, 2 sync workers)
      │
      ▼
MongoDB Atlas (M0 free tier)
```

All three app containers (`bcc-caddy`, `bcc-backend`, `bcc-frontend`) run via Docker Compose
on a **single EC2 instance** — no Kubernetes, no cluster, no orchestrator. This replaced a
K3s (Traefik + self-hosted Actions runner) deployment that used to run in a different,
now-decommissioned AWS account.

| Piece | Detail |
|---|---|
| AWS account | **642195693540** (dedicated, free-tier — see [Why a dedicated account](#why-a-dedicated-account)) |
| EC2 | `bcc-cvote-app`, t3.micro, ap-south-1, 20GB gp3, 1GB swap file |
| Elastic IP | stable across instance replacement — current app hostname is `<eip-with-dashes>.sslip.io` |
| Database | MongoDB Atlas M0 (free tier) — not self-hosted |
| Container registry | ECR in the same account, `bcc-cvote-backend` / `bcc-cvote-frontend` |
| Secrets | SSM Parameter Store, `/bcc-cvote/prod/*` (SecureString) |
| IaC | `terraform-new-account/` |

---

## Why a dedicated account

BCC-CVote used to share an AWS account with another project. That account ran out of
free-tier credits and converted to paid, so BCC-CVote was migrated wholesale to its own new,
dedicated free-tier account — the whole point being **near-zero ongoing cost**:

- Single t3.micro instance (free tier: 750 hrs/month for 12 months) instead of 2 EC2s (K3s
  node + a separate MongoDB node)
- MongoDB Atlas M0 instead of a self-hosted MongoDB EC2
- No load balancer, no NAT gateway, no multi-AZ — deliberately minimal for a ~60-person
  weekend voting app
- `credit_specification.cpu_credits = "standard"` (not `unlimited`) on the instance — throttles
  under sustained load instead of burst-billing, trading a bit of headroom for zero surprise
  charges

## CloudFront deliberately still lives in the OLD account

The one exception: the CloudFront distribution players actually use
(`d2welg0wjdnhjp.cloudfront.net`, id `E1EZ6V1244PHBR`) was **not** migrated — it still lives in
the old account (`661474704151`), just with its origin repointed to the new account's EC2
(`13-234-252-190.sslip.io`, updated 2026-08-17).

This was a deliberate choice, not an oversight: CloudFront distributions can't move between
AWS accounts — a "migration" would mean creating a brand-new distribution with a different
`*.cloudfront.net` domain, breaking every captain/admin's existing bookmarked link. CloudFront
is also usage-billed (a few cents/month at this traffic level), not a fixed cost like the old
account's EC2s were, so leaving it there costs effectively nothing. Manage it by hand (AWS
Console/CLI, profile `vfla-target`) if it ever needs to change; nothing in this repo's
Terraform manages it.

## Old-account decommission (2026-08-18)

Every other BCC-CVote resource in the old account (661474704151) was destroyed once the
account converted to paid: the K3s EC2 node, the standalone MongoDB EC2 node, both old ECR
repos, both security groups, the GitHub OIDC deploy role (verified nothing else in the account
trusted it first), and all 5 old SSM params. The old `terraform/` directory is kept in this
repo as a historical record only — its header comment explains why, and it must never be
`apply`'d again (everything it declares is destroyed; a plain apply would recreate the old
paid-account stack).

---

## CI/CD

`.github/workflows/prod-cd-newaccount.yml` — the only prod deploy pipeline (the old
K3s-targeting `prod-cd.yml` was removed in the same decommission). Triggers on every push to
`main`, no path filter.

1. **`backend-tests`** — pytest against a throwaway `mongo:7.0` service container.
2. **`build-and-push`** — GitHub-hosted runner, OIDC auth (`NEW_AWS_DEPLOY_ROLE_ARN`, no
   static AWS keys), builds + Trivy-scans + pushes both images to ECR, tagged both `:latest`
   and `:<8-char-sha>`.
3. **`deploy`** — plain GitHub-hosted runner (no self-hosted runner needed, unlike the old
   K3s setup) triggers `/opt/bcc-cvote/deploy.sh` on the instance via **SSM RunCommand**,
   polls for completion, then smoke-tests the direct sslip.io URL.

`deploy.sh` (baked onto the instance by Terraform's `user_data`, re-invoked every deploy):
- Discovers its own public IP via IMDSv2 (no dependency on how the EIP is wired up)
- Pulls all 5 secrets from SSM into a fresh `.env` (`chmod 600`)
- `docker compose pull && docker compose up -d`, then prunes images older than 72h

**`NEW_INSTANCE_ID`** (GitHub repo secret) is stable in practice — the Elastic IP survives an
instance stop/replace — but **not guaranteed**: if `terraform-new-account/main.tf`'s
`user_data` ever changes, `user_data_replace_on_change = true` recreates the instance with a
new ID, and this secret needs a manual update (`terraform output instance_id`) before the next
deploy will work.

`dev-ci.yml` runs on PRs — backend pytest, frontend vitest, `npm audit` / `pip audit`, Trivy
filesystem scan, SonarCloud, and a Vite build sanity check. No deploy step.

---

## Secrets (SSM Parameter Store)

All under `/bcc-cvote/prod/`, SecureString, region `ap-south-1`, new account:

| Name | Notes |
|---|---|
| `mongodb-uri` | MongoDB Atlas connection string |
| `jwt-secret` | flask-jwt-extended signing key |
| `app-secret` | Flask `SECRET_KEY` |
| `openweather-api-key` | optional — weather forecast no-ops without it |
| `sentry-dsn` | **not currently set** — Sentry is wired but inert, see README's Known limitations |
| `acme-email` | Caddy's Let's Encrypt registration email |

`openweather-api-key` and `sentry-dsn` are deliberately **not** Terraform-managed resources —
SSM `SecureString` can't hold an empty-string value, and both need to support "unset" as a
valid state without crashing the app. They're created out-of-band (`aws ssm put-parameter`)
instead. `deploy.sh` already handles a missing value gracefully (`|| echo ""`) for both.

---

## Operational notes

- **Memory is tight**: t3.micro has 1GB RAM, no slack once Caddy + frontend + backend are all
  up — the 1GB swap file created at boot is deliberate insurance against an OOM kill during a
  deploy (two container versions briefly coexisting), not routine usage.
- **No replicas**: unlike the old K3s deployment (2 pod replicas each), this is a single
  container per service on a single host. Per-request concurrency comes from gunicorn's own
  `GUNICORN_WORKERS: 2` setting instead, not from multiple containers. A crash/OOM of a
  container causes a brief outage until Docker's `restart: unless-stopped` brings it back, not
  a seamless failover.
- **Checking logs / running one-off commands**: no SSH — the instance has no public SSH access
  configured. Use SSM `send-command` (`AWS-RunShellScript` document) against the instance ID,
  same mechanism the deploy pipeline itself uses.
- **EC2 replacement**: `terraform apply` in `terraform-new-account/` can replace the instance
  (e.g. changing `user_data`). The Elastic IP re-associates automatically, but the new instance
  needs: (1) `NEW_INSTANCE_ID` GitHub secret updated, (2) SSM agent confirmed online + cloud-init
  finished, (3) one manual `/opt/bcc-cvote/deploy.sh` run via SSM (first deploy on a fresh
  instance has no images to pull until this runs).
