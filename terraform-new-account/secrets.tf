# ── Secrets Manager (added 2026-10-16) ──────────────────────────────────────
# Every secret this project uses lives here. Terraform creates the secret
# containers only — never their values, so no secret ever lands in
# Terraform state or in git. Values are set with
#   aws secretsmanager put-secret-value --secret-id <name> --secret-string file://...
# (JSON object, one key per setting).
#
#   bcc-cvote/prod/app  read by the backend itself at startup via the
#                       instance role (backend/app/aws_secrets.py):
#                       MONGODB_URI, JWT_SECRET_KEY, SECRET_KEY,
#                       OPENWEATHER_API_KEY, VAPID_PRIVATE_KEY,
#                       VAPID_PUBLIC_KEY, VAPID_CLAIM_EMAIL, SENTRY_DSN
#   bcc-cvote/ci        read by GitHub Actions during a run, masked in logs:
#                       SONAR_TOKEN, VITE_SENTRY_DSN

resource "aws_secretsmanager_secret" "app" {
  name                    = "bcc-cvote/prod/app"
  description             = "BCC-CVote backend runtime secrets (JSON). Read by the backend at startup."
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret" "ci" {
  name                    = "bcc-cvote/ci"
  description             = "BCC-CVote CI secrets (JSON). Read by GitHub Actions during a run."
  recovery_window_in_days = 7
  tags                    = local.common_tags
}

output "app_secret_name" {
  value = aws_secretsmanager_secret.app.name
}
