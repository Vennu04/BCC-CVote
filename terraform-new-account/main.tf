terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  backend "s3" {
    bucket         = "bcc-cvote-newacct-tfstate"
    key            = "prod/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "bcc-cvote-newacct-tfstate-lock"
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

# ── GitHub Actions OIDC — dedicated to this account, no long-lived keys ───────

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
  tags            = local.common_tags
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
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:ref:refs/heads/main"
        }
      }
    }]
  })
  tags = local.common_tags
}

# Deploy is now "push image + tell the instance to pull it" via SSM
# RunCommand — no self-hosted runner, no SSH key, no K8s API. SendCommand is
# scoped to exactly this one instance + the AWS-RunShellScript document;
# GetCommandInvocation/DescribeInstanceInformation are read-only status
# checks with no meaningful resource-level scoping available.
resource "aws_iam_role_policy" "github_actions_deploy" {
  name = "bcc-cvote-deploy-policy"
  role = aws_iam_role.github_actions_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
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
        Action   = ["ssm:SendCommand"]
        Resource = [
          "arn:aws:ec2:${var.aws_region}:*:instance/${aws_instance.app.id}",
          "arn:aws:ssm:${var.aws_region}::document/AWS-RunShellScript"
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["ssm:GetCommandInvocation", "ssm:DescribeInstanceInformation", "ssm:ListCommandInvocations"]
        Resource = "*"
      }
    ]
  })
}

# ── Security group — no SSH at all (Session Manager only). 80/443 open to
#    the internet, same convention as the old account: the CloudFront
#    origin-facing managed prefix list has 600+ entries, which blows past
#    the default 60-rules-per-security-group quota when used in
#    prefix_list_ids (confirmed: RulesPerSecurityGroupLimitExceeded) — not
#    worth a quota-increase request for this. SSH being fully closed is
#    the bigger hardening win either way. ─────────────────────────────────

data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "app" {
  name        = "bcc-cvote-app-sg"
  description = "Single prod instance - reachable only from CloudFront, no SSH (SSM only)"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    description = "HTTP (ACME HTTP-01 challenge + redirect)"
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

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = local.common_tags
}

# ── IAM role for the instance itself ───────────────────────────────────────
# AmazonSSMManagedInstanceCore gives Session Manager (shell access with no
# open port) + is what lets SSM RunCommand reach this box for deploys.

resource "aws_iam_role" "app_instance" {
  name = "bcc-cvote-app-role"
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

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.app_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "app_ecr_and_ssm_params" {
  name = "bcc-cvote-app-ecr-ssm-policy"
  role = aws_iam_role.app_instance.id
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

resource "aws_iam_instance_profile" "app" {
  name = "bcc-cvote-app-profile"
  role = aws_iam_role.app_instance.name
}

# ── The single EC2 instance ──────────────────────────────────────────────────

data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical
  filter {
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

resource "aws_instance" "app" {
  ami                    = data.aws_ami.ubuntu.id
  instance_type          = "t3.micro" # AWS free tier: 750 hrs/month for 12 months
  subnet_id              = data.aws_subnets.default.ids[0]
  vpc_security_group_ids = [aws_security_group.app.id]
  iam_instance_profile   = aws_iam_instance_profile.app.name

  # Deliberately "standard", not "unlimited" — this account's whole point is
  # minimal/zero spend. Standard just throttles CPU under sustained load
  # instead of burst-billing; for a 20-30 team weekly voting app that's an
  # acceptable tradeoff to guarantee no surprise charge.
  credit_specification {
    cpu_credits = "standard"
  }

  root_block_device {
    volume_size = 20 # well under the 30GB free-tier EBS allowance
    volume_type = "gp3"
    encrypted   = true
  }

  user_data_replace_on_change = true

  user_data = <<-EOF
    #!/bin/bash
    set -e
    apt-get update -y
    apt-get install -y docker.io docker-compose-v2 curl unzip
    systemctl enable --now docker

    # 1GB swap — t3.micro's 1GB RAM has no slack once backend+frontend+caddy
    # are all up; this is cheap insurance against an OOM kill during a
    # deploy (two versions briefly coexisting) rather than a bigger instance.
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab

    # AWS CLI v2 — needed by deploy.sh (ECR login + SSM parameter reads),
    # authenticates automatically via this instance's IAM role.
    curl -sfL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
    (cd /tmp && unzip -q awscliv2.zip && ./aws/install)

    mkdir -p /opt/bcc-cvote
    cat > /opt/bcc-cvote/docker-compose.prod.yml << 'COMPOSEEOF'
    ${file("${path.module}/../deploy/docker-compose.prod.yml")}
    COMPOSEEOF

    cat > /opt/bcc-cvote/Caddyfile << 'CADDYEOF'
    ${file("${path.module}/../deploy/Caddyfile")}
    CADDYEOF

    cat > /opt/bcc-cvote/deploy.sh << 'DEPLOYEOF'
    ${file("${path.module}/../deploy/deploy.sh")}
    DEPLOYEOF
    chmod +x /opt/bcc-cvote/deploy.sh

    # First real deploy (pulling actual images) happens once CI has pushed
    # at least one image tag - not run automatically here since a brand
    # new ECR repo has nothing to pull yet on first boot.
  EOF

  tags = merge(local.common_tags, { Name = "bcc-cvote-app" })

  lifecycle {
    ignore_changes = [ami]
  }
}

resource "aws_eip" "app" {
  instance = aws_instance.app.id
  domain   = "vpc"
  tags     = local.common_tags
}

# ── SSM Parameter Store secrets (free tier, replaces paid Secrets Manager) ────
# Placeholders — set real values yourself via `aws ssm put-parameter
# --overwrite ...` (never through Terraform state, never pasted in chat).

resource "aws_ssm_parameter" "mongodb_uri" {
  name  = "/bcc-cvote/prod/mongodb-uri"
  type  = "SecureString"
  value = "PLACEHOLDER"
  tags  = local.common_tags
  lifecycle {
    ignore_changes = [value]
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

resource "aws_ssm_parameter" "openweather_api_key" {
  name  = "/bcc-cvote/prod/openweather-api-key"
  type  = "SecureString"
  value = "PLACEHOLDER"
  tags  = local.common_tags
  lifecycle {
    ignore_changes = [value]
  }
}

resource "aws_ssm_parameter" "acme_email" {
  name  = "/bcc-cvote/prod/acme-email"
  type  = "String"
  value = "PLACEHOLDER"
  tags  = local.common_tags
  lifecycle {
    ignore_changes = [value]
  }
}

# ── S3 for Terraform state (bootstrap manually first, in the NEW account) ─────
# aws s3 mb s3://bcc-cvote-newacct-tfstate --region ap-south-1 --profile bcc-cvote-new
# aws dynamodb create-table --table-name bcc-cvote-newacct-tfstate-lock \
#   --attribute-definitions AttributeName=LockID,AttributeType=S \
#   --key-schema AttributeName=LockID,KeyType=HASH \
#   --billing-mode PAY_PER_REQUEST --region ap-south-1 --profile bcc-cvote-new
