#!/bin/bash
# Refreshes secrets from SSM and (re)deploys the compose stack. Run on the
# instance itself — baked in at boot by Terraform's user_data, and
# re-invoked on every CI push via SSM RunCommand (see .github/workflows).
# Self-contained: discovers its own public IP via IMDSv2 rather than
# needing Terraform to inject it, so this script has no dependency on how
# the EIP is wired up.
set -euo pipefail
cd /opt/bcc-cvote

REGION="ap-south-1"

get_secret() {
  aws ssm get-parameter --name "$1" --with-decryption --region "$REGION" \
    --query Parameter.Value --output text
}

# /bcc-cvote/prod/app-hostname overrides the auto-detected sslip.io hostname
# (e.g. a real domain like a DuckDNS name pointed at the instance's EIP) —
# falls back to the IP-derived sslip.io hostname if the param isn't set, so
# this keeps working with zero config on a fresh instance.
APP_HOSTNAME=$(get_secret /bcc-cvote/prod/app-hostname || echo "")
if [ -z "$APP_HOSTNAME" ]; then
  TOKEN=$(curl -sX PUT "http://169.254.169.254/latest/api/token" -H "X-aws-ec2-metadata-token-ttl-seconds: 21600")
  PUBLIC_IP=$(curl -s -H "X-aws-ec2-metadata-token: $TOKEN" http://169.254.169.254/latest/meta-data/public-ipv4)
  APP_HOSTNAME="$(echo "$PUBLIC_IP" | tr '.' '-').sslip.io"
fi
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

cat > .env <<ENVEOF
APP_HOSTNAME=${APP_HOSTNAME}
ACME_EMAIL=$(get_secret /bcc-cvote/prod/acme-email)
MONGODB_URI=$(get_secret /bcc-cvote/prod/mongodb-uri)
JWT_SECRET_KEY=$(get_secret /bcc-cvote/prod/jwt-secret)
SECRET_KEY=$(get_secret /bcc-cvote/prod/app-secret)
OPENWEATHER_API_KEY=$(get_secret /bcc-cvote/prod/openweather-api-key || echo "")
SENTRY_DSN=$(get_secret /bcc-cvote/prod/sentry-dsn || echo "")
ECR_REGISTRY=${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com
ENVEOF
chmod 600 .env

echo "Deploying for hostname: ${APP_HOSTNAME}"

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

docker compose -f docker-compose.prod.yml --env-file .env pull
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker image prune -af --filter "until=72h"

echo "Deploy complete: https://${APP_HOSTNAME}"
