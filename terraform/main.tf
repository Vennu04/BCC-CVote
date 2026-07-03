terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  backend "s3" {
    bucket         = "bcc-cvote-tfstate"
    key            = "prod/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "bcc-cvote-tfstate-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

# ── ECR Repositories ─────────────────────────────────────────────────────────

resource "aws_ecr_repository" "backend" {
  name                 = "bcc-cvote-backend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

resource "aws_ecr_repository" "frontend" {
  name                 = "bcc-cvote-frontend"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = local.common_tags
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "frontend" {
  repository = aws_ecr_repository.frontend.name
  policy     = aws_ecr_lifecycle_policy.backend.policy
}

# ── GitHub Actions OIDC — dedicated to bcc-cvote, not shared with any other
#    project in this account. No long-lived AWS keys stored in GitHub. ───────

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"] # GitHub's OIDC root CA thumbprint

  tags = local.common_tags
}

resource "aws_iam_role" "github_actions_deploy" {
  name = "bcc-cvote-github-actions-deploy"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
        }
        StringLike = {
          # Only this repo, only pushes to main — nothing broader.
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main"
        }
      }
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "bcc-cvote-deploy-policy"
  role = aws_iam_role.github_actions_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*" # this specific action does not support resource-level scoping
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage", "ecr:PutImage", "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart", "ecr:CompleteLayerUpload"
        ]
        Resource = [aws_ecr_repository.backend.arn, aws_ecr_repository.frontend.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/bcc-cvote/*"
      },
      {
        Effect   = "Allow"
        Action   = ["ecr:DescribeImageScanFindings", "ecr:DescribeImages"]
        Resource = [aws_ecr_repository.backend.arn, aws_ecr_repository.frontend.arn]
      }
    ]
  })
}

# ── K3s EC2 Instance ──────────────────────────────────────────────────────────

resource "aws_security_group" "k3s" {
  name        = "bcc-cvote-k3s-sg"
  description = "K3s node security group"
  vpc_id      = var.vpc_id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  ingress {
    description = "K3s API"
    from_port   = 6443
    to_port     = 6443
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  ingress {
    description = "HTTP (ACME challenge + redirect to HTTPS)"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Grafana/Prometheus now live on their own dedicated instance (see
  # aws_security_group.monitoring below) — that instance's SG is allowed to
  # scrape node-exporter/kube-state-metrics here, added after both SGs exist.

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# No dedicated bcc-cvote monitoring instance — consolidated onto the
# existing vfla-monitoring-grafana instance instead (one Prometheus/Grafana
# for both projects, not two). This project's Terraform doesn't own that
# instance, just opens the door for it to reach these exporters.
#
# Add this to vfla-monitoring-grafana's prometheus.yml scrape_configs
# (see terraform output bcc_cvote_scrape_config for the exact snippet):
resource "aws_security_group_rule" "k3s_allow_vfla_monitoring_scrape" {
  type                     = "ingress"
  security_group_id        = aws_security_group.k3s.id
  source_security_group_id = var.vfla_monitoring_sg_id
  from_port                = 30100
  to_port                  = 30100
  protocol                 = "tcp"
  description              = "node-exporter NodePort - scraped by vfla-monitoring-grafana"
}

resource "aws_security_group_rule" "k3s_allow_vfla_monitoring_ksm" {
  type                     = "ingress"
  security_group_id        = aws_security_group.k3s.id
  source_security_group_id = var.vfla_monitoring_sg_id
  from_port                = 30101
  to_port                  = 30101
  protocol                 = "tcp"
  description              = "kube-state-metrics NodePort - scraped by vfla-monitoring-grafana"
}

# ── Dedicated MongoDB instance ─────────────────────────────────────────────────
# Self-hosting as a K3s pod on the app node caused real instability (NodeNotReady
# events under combined load with K3s+Traefik+cert-manager+ESO+ArgoCD+the app) —
# moved out to its own instance, same proven Docker Compose pattern as monitoring.

resource "aws_security_group" "mongodb" {
  name        = "bcc-cvote-mongodb-sg"
  description = "Self-hosted MongoDB - isolated from the app node, only reachable from it"
  vpc_id      = var.vpc_id

  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
  }

  ingress {
    description     = "MongoDB - app node only, never public"
    from_port       = 27017
    to_port         = 27017
    protocol        = "tcp"
    security_groups = [aws_security_group.k3s.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
    # Canonical's naming now includes the release codename ("jammy").
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }
  filter {
    name   = "state"
    values = ["available"]
  }
  filter {
    name   = "architecture"
    values = ["x86_64"]
  }
}

resource "aws_iam_role" "k3s_node" {
  name = "bcc-cvote-k3s-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy" "k3s_ecr_and_ssm" {
  name = "k3s-ecr-ssm-policy"
  role = aws_iam_role.k3s_node.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken", "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetParameter", "ssm:GetParameters"]
        Resource = "arn:aws:ssm:${var.aws_region}:*:parameter/bcc-cvote/*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "k3s_node" {
  name = "bcc-cvote-k3s-profile"
  role = aws_iam_role.k3s_node.name
}

# Dedicated SSH key for this project only — not shared with any other
# project/account resource, per the "separate IDs" requirement.
resource "tls_private_key" "k3s_ssh" {
  algorithm = "RSA"
  rsa_bits  = 4096
}

resource "aws_key_pair" "k3s" {
  key_name   = "bcc-cvote-key"
  public_key = tls_private_key.k3s_ssh.public_key_openssh
  tags       = local.common_tags
}

resource "aws_instance" "k3s" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.small" # 2GB RAM — needed for app + Traefik + cert-manager + ESO + ArgoCD
  key_name               = aws_key_pair.k3s.key_name
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.k3s.id]
  iam_instance_profile   = aws_iam_instance_profile.k3s_node.name

  # t3 is burstable — standard mode throttles hard to ~20% of a vCPU once
  # burst credits run out (observed: CPUCreditBalance hit 0 during bootstrap,
  # API server requests started taking 30+ seconds). Unlimited lets it burst
  # as needed; AWS only bills the surplus (~$0.05/vCPU-hour) during actual
  # bursts, not constantly.
  credit_specification {
    cpu_credits = "unlimited"
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  # cloud-init/user_data only runs on first boot — a plain reboot does NOT
  # re-run it. This makes Terraform properly destroy+recreate the instance
  # when the script changes, so `terraform apply` is always the real source
  # of truth for what's running (no manual SSH drift).
  user_data_replace_on_change = true

  user_data = <<-EOF
    #!/bin/bash
    set -e
    apt-get update -y
    apt-get install -y curl jq unzip

    # AWS CLI v2 — needed by the ECR-pull-secret refresh cron below (auths
    # via the instance's IAM role automatically, no keys needed).
    curl -sfL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
    (cd /tmp && unzip -q awscliv2.zip && ./aws/install)

    # 2GB swap — t3.small's 2GB RAM gets tight during bootstrap (K3s + Traefik +
    # cert-manager + ArgoCD + ESO installing concurrently); this is the standard,
    # safe mitigation rather than a bigger (non-free-tier-adjacent) instance.
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab

    # Install K3s (built-in Traefik disabled — we install it ourselves for hostPort control)
    curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh -
    until kubectl get nodes 2>/dev/null | grep -q " Ready"; do sleep 5; done

    curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

    # Configure kubectl for ubuntu user
    mkdir -p /home/ubuntu/.kube
    cp /etc/rancher/k3s/k3s.yaml /home/ubuntu/.kube/config
    chown ubuntu:ubuntu /home/ubuntu/.kube/config
    export KUBECONFIG=/etc/rancher/k3s/k3s.yaml

    # ── Traefik on 80/443 via K3s's built-in ServiceLB ─────────────────────
    # Default LoadBalancer service type — K3s's ServiceLB (svclb) binds
    # host ports 80/443 for us with privilege handling it already gets
    # right. (A hand-rolled hostNetwork+NET_BIND_SERVICE capability setup
    # was tried and hit unexplained bind: permission denied errors even
    # with the capability granted — this is simpler and just works.)
    helm repo add traefik https://traefik.github.io/charts && helm repo update
    helm install traefik traefik/traefik -n kube-system \
      --set resources.requests.cpu=50m \
      --set resources.requests.memory=64Mi \
      --set resources.limits.cpu=200m \
      --set resources.limits.memory=128Mi

    # ── cert-manager (free Let's Encrypt certs) ──────────────────────────
    helm repo add jetstack https://charts.jetstack.io && helm repo update
    helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace \
      --set crds.enabled=true \
      --set resources.requests.cpu=25m \
      --set resources.requests.memory=32Mi

    # Retries any kubectl apply — CRDs freshly installed by a helm chart can
    # take a while to actually appear in API discovery even after the CRD
    # object itself exists ("no matches for kind" races), so every apply of
    # a custom resource in this script goes through this instead of a
    # one-shot call.
    retry_apply() {
      local file="$1"; local n=0
      until kubectl apply -f "$file"; do
        n=$((n+1))
        [ $n -ge 15 ] && { echo "giving up applying $file after $n tries"; return 1; }
        sleep 10
      done
    }

    # ClusterIssuer — Let's Encrypt via HTTP-01, solved by Traefik.
    # ${var.acme_email} is the registration/expiry-notice email.
    cat <<'ISSUER' > /tmp/cluster-issuer.yaml
    apiVersion: cert-manager.io/v1
    kind: ClusterIssuer
    metadata:
      name: letsencrypt-prod
    spec:
      acme:
        server: https://acme-v02.api.letsencrypt.org/directory
        email: ${var.acme_email}
        privateKeySecretRef:
          name: letsencrypt-prod-key
        solvers:
          - http01:
              ingress:
                ingressClassName: traefik
    ISSUER
    retry_apply /tmp/cluster-issuer.yaml

    # ── External Secrets Operator — syncs SSM Parameter Store straight into
    #    a K8s Secret inside the cluster. Secret material never passes through
    #    CI or gets committed to git, unlike the old Secrets-Manager-via-CI
    #    approach. Auth is via the node's IAM instance profile (IMDS) — no
    #    OIDC/IRSA needed since this isn't EKS.
    helm repo add external-secrets https://charts.external-secrets.io && helm repo update
    helm install external-secrets external-secrets/external-secrets -n external-secrets --create-namespace \
      --set resources.requests.cpu=25m \
      --set resources.requests.memory=32Mi

    cat <<'STORE' > /tmp/cluster-secret-store.yaml
    apiVersion: external-secrets.io/v1
    kind: ClusterSecretStore
    metadata:
      name: aws-ssm
    spec:
      provider:
        aws:
          service: ParameterStore
          region: ${var.aws_region}
          # No auth block — falls back to the default AWS credential chain,
          # which picks up the node's IAM instance profile via IMDS.
    STORE
    retry_apply /tmp/cluster-secret-store.yaml

    # ── ArgoCD (UI included) ────────────────────────────────────────────────
    # server-side apply + a generous request-timeout: the full install
    # manifest includes a couple of very large CRDs (ApplicationSet) that
    # can time out on a small instance under first-boot load; retrying is
    # safe since server-side apply is idempotent.
    kubectl create namespace argocd || true
    n=0
    until kubectl apply -n argocd --server-side --force-conflicts --request-timeout=180s \
      -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml; do
      n=$((n+1))
      [ $n -ge 5 ] && break
      sleep 20
    done

    # We don't use ApplicationSets or the notifications feature — scale them
    # to 0 so they stop consuming RAM/restart-churn instead of crash-looping
    # over a CRD we're not applying.
    kubectl -n argocd scale deployment argocd-applicationset-controller argocd-notifications-controller --replicas=0 || true

    # Bootstrap the GitOps Application pointing at this repo's k8s/prod path
    curl -sfL -o /tmp/app-prod.yaml https://raw.githubusercontent.com/${var.github_repo}/main/argocd/app-prod.yaml
    retry_apply /tmp/app-prod.yaml

    # ── Metrics exporters only (node-exporter + kube-state-metrics) ────────
    # The heavy parts — Prometheus's TSDB and Grafana — live on their own
    # dedicated monitoring instance instead, so they never compete with the
    # app for this node's RAM. These two exporters are tiny (~30-50Mi
    # combined) and just expose metrics for that instance to scrape.
    helm repo add prometheus-community https://prometheus-community.github.io/helm-charts && helm repo update
    helm install node-exporter prometheus-community/prometheus-node-exporter -n monitoring --create-namespace \
      --set service.type=ClusterIP \
      --set resources.requests.cpu=10m \
      --set resources.requests.memory=16Mi
    helm install kube-state-metrics prometheus-community/kube-state-metrics -n monitoring \
      --set resources.requests.cpu=10m \
      --set resources.requests.memory=32Mi

    # Expose both as NodePort so the monitoring instance can reach them —
    # ClusterIP alone is only reachable from inside this cluster.
    cat <<'EXPORTERS' | kubectl apply -f -
    apiVersion: v1
    kind: Service
    metadata:
      name: node-exporter-external
      namespace: monitoring
    spec:
      type: NodePort
      selector:
        app.kubernetes.io/name: prometheus-node-exporter
      ports:
        - port: 9100
          targetPort: 9100
          nodePort: 30100
    ---
    apiVersion: v1
    kind: Service
    metadata:
      name: kube-state-metrics-external
      namespace: monitoring
    spec:
      type: NodePort
      selector:
        app.kubernetes.io/name: kube-state-metrics
      ports:
        - port: 8080
          targetPort: 8080
          nodePort: 30101
    EXPORTERS

    # ── ECR credential helper for K3s (auto-refresh, tokens expire in 12h) ─
    cat > /usr/local/bin/refresh-ecr-secret.sh << 'SCRIPT'
    #!/bin/bash
    REGION="${var.aws_region}"
    ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    TOKEN=$(aws ecr get-login-password --region $REGION)
    kubectl -n voting-prod delete secret ecr-pull-secret --ignore-not-found
    kubectl -n voting-prod create secret docker-registry ecr-pull-secret \
      --docker-server="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com" \
      --docker-username=AWS \
      --docker-password="$TOKEN"
    SCRIPT
    chmod +x /usr/local/bin/refresh-ecr-secret.sh
    echo "0 */6 * * * root KUBECONFIG=/etc/rancher/k3s/k3s.yaml /usr/local/bin/refresh-ecr-secret.sh" > /etc/cron.d/ecr-refresh
  EOF

  tags = merge(local.common_tags, { Name = "bcc-cvote-k3s" })
}

# Static public IP — survives instance stop/start/replace, and is what the
# sslip.io hostname (see outputs.tf) and Let's Encrypt cert are pinned to.
resource "aws_eip" "k3s" {
  instance = aws_instance.k3s.id
  domain   = "vpc"
  tags     = local.common_tags
}

# ── Dedicated monitoring instance (Prometheus + Grafana) ──────────────────────
# Plain Docker Compose, not K8s — no cluster overhead needed just to run two
# containers. Scrapes the app node over its private IP (stays inside the VPC,
# no data-transfer cost, and never exposed to the internet).

# Reads the password already set via `aws ssm put-parameter` (see
# k8s/prod/secret.yaml's header comment) — not Terraform-managed as a
# resource since it already exists and this is just a lookup for use below.
data "aws_ssm_parameter" "mongo_root_password" {
  name            = "/bcc-cvote/prod/mongo-root-password"
  with_decryption = true
}

resource "aws_instance" "mongodb" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.micro" # dedicated instance, no K3s/app overhead to share with
  key_name               = aws_key_pair.k3s.key_name
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.mongodb.id]

  # Cheap insurance against the same CPU-credit exhaustion seen on the app
  # node — this is a production database, worth avoiding burst-throttling.
  credit_specification {
    cpu_credits = "unlimited"
  }

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  user_data_replace_on_change = true

  user_data = <<-EOF
    #!/bin/bash
    set -e
    apt-get update -y
    apt-get install -y docker.io docker-compose-v2
    systemctl enable --now docker

    mkdir -p /opt/mongodb
    cat > /opt/mongodb/docker-compose.yml << 'COMPOSE'
    services:
      mongo:
        image: mongo:7.0
        restart: unless-stopped
        command: ["mongod", "--wiredTigerCacheSizeGB=0.5", "--bind_ip_all"]
        environment:
          - MONGO_INITDB_ROOT_USERNAME=bccadmin
          - MONGO_INITDB_ROOT_PASSWORD=${data.aws_ssm_parameter.mongo_root_password.value}
          - MONGO_INITDB_DATABASE=bcc_cvote
        volumes:
          - mongo-data:/data/db
        ports:
          - "27017:27017"
    volumes:
      mongo-data:
    COMPOSE

    cd /opt/mongodb && docker compose up -d
  EOF

  tags = merge(local.common_tags, { Name = "bcc-cvote-mongodb" })
}

# ── SSM Parameter Store secrets (free — replaces paid Secrets Manager) ────────

resource "aws_ssm_parameter" "mongodb_uri" {
  name  = "/bcc-cvote/prod/mongodb-uri"
  type  = "SecureString"
  value = "PLACEHOLDER — set real value via: aws ssm put-parameter --overwrite ..."
  tags  = local.common_tags

  lifecycle {
    ignore_changes = [value] # don't let terraform stomp on a real value you set out-of-band
  }
}

resource "aws_ssm_parameter" "jwt_secret" {
  name  = "/bcc-cvote/prod/jwt-secret"
  type  = "SecureString"
  value = "PLACEHOLDER"
  tags  = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "app_secret" {
  name  = "/bcc-cvote/prod/app-secret"
  type  = "SecureString"
  value = "PLACEHOLDER"
  tags  = local.common_tags

  lifecycle {
    ignore_changes = [value]
  }
}

# ── S3 for Terraform state (bootstrap manually first) ─────────────────────────

# NOTE: Create this bucket manually BEFORE running terraform init:
#   aws s3 mb s3://bcc-cvote-tfstate --region ap-south-1
#   aws dynamodb create-table --table-name bcc-cvote-tfstate-lock \
#     --attribute-definitions AttributeName=LockID,AttributeType=S \
#     --key-schema AttributeName=LockID,KeyType=HASH \
#     --billing-mode PAY_PER_REQUEST --region ap-south-1
