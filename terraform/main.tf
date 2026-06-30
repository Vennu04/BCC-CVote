terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
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
    description = "Frontend NodePort"
    from_port   = 30080
    to_port     = 30080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Backend NodePort"
    from_port   = 30500
    to_port     = 30500
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "Grafana (optional)"
    from_port   = 30300
    to_port     = 30300
    protocol    = "tcp"
    cidr_blocks = [var.admin_cidr]
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
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-22.04-amd64-server-*"]
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

resource "aws_iam_role_policy" "k3s_ecr_and_secrets" {
  name = "k3s-ecr-secrets-policy"
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
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = "arn:aws:secretsmanager:${var.aws_region}:*:secret:bcc-cvote/*"
      }
    ]
  })
}

resource "aws_iam_instance_profile" "k3s_node" {
  name = "bcc-cvote-k3s-profile"
  role = aws_iam_role.k3s_node.name
}

resource "aws_instance" "k3s" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.micro"
  key_name               = var.key_pair_name
  subnet_id              = var.subnet_id
  vpc_security_group_ids = [aws_security_group.k3s.id]
  iam_instance_profile   = aws_iam_instance_profile.k3s_node.name

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
    encrypted   = true
  }

  user_data = <<-EOF
    #!/bin/bash
    set -e
    apt-get update -y
    apt-get install -y curl jq unzip

    # Install K3s
    curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh -
    # Wait for K3s to be ready
    until kubectl get nodes 2>/dev/null | grep -q " Ready"; do sleep 5; done

    # Install Traefik via Helm for more control
    curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
    helm repo add traefik https://traefik.github.io/charts && helm repo update
    helm install traefik traefik/traefik -n kube-system \
      --set service.type=NodePort \
      --set ports.web.nodePort=30080

    # Configure kubectl for ubuntu user
    mkdir -p /home/ubuntu/.kube
    cp /etc/rancher/k3s/k3s.yaml /home/ubuntu/.kube/config
    chown ubuntu:ubuntu /home/ubuntu/.kube/config
    export KUBECONFIG=/home/ubuntu/.kube/config

    # Install ArgoCD
    kubectl create namespace argocd || true
    kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml

    # ECR credential helper for K3s (auto-refresh)
    AWS_REGION="${var.aws_region}"
    ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    ECR_REGISTRY="$ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"

    # Create ECR pull secret refresh cronjob
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

    # Refresh every 6 hours (ECR tokens expire in 12h)
    echo "0 */6 * * * root /usr/local/bin/refresh-ecr-secret.sh" > /etc/cron.d/ecr-refresh
  EOF

  tags = merge(local.common_tags, { Name = "bcc-cvote-k3s" })
}

# ── Secrets Manager placeholders ──────────────────────────────────────────────

resource "aws_secretsmanager_secret" "mongodb_uri" {
  name                    = "bcc-cvote/prod/mongodb-uri"
  recovery_window_in_days = 0
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "bcc-cvote/prod/jwt-secret"
  recovery_window_in_days = 0
  tags                    = local.common_tags
}

resource "aws_secretsmanager_secret" "app_secret" {
  name                    = "bcc-cvote/prod/app-secret"
  recovery_window_in_days = 0
  tags                    = local.common_tags
}

# ── S3 for Terraform state (bootstrap manually first) ─────────────────────────

# NOTE: Create this bucket manually BEFORE running terraform init:
#   aws s3 mb s3://bcc-cvote-tfstate --region ap-south-1
#   aws dynamodb create-table --table-name bcc-cvote-tfstate-lock \
#     --attribute-definitions AttributeName=LockID,AttributeType=S \
#     --key-schema AttributeName=LockID,KeyType=HASH \
#     --billing-mode PAY_PER_REQUEST --region ap-south-1
