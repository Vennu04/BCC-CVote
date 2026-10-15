# ── Build once, promote on merge (added 2026-10-16) ─────────────────────────
# PR checks (dev-ci.yml, job pr-images) build + scan each image and push it
# here as tree-<hash> (git tree hash of the image's folder). On merge, Prod CD
# copies that exact image into the prod repo instead of rebuilding — see
# .github/scripts/plan-images.sh. These repos only ever hold PR builds; the
# server never pulls from them.

resource "aws_ecr_repository" "backend_ci" {
  name                 = "bcc-cvote-backend-ci"
  image_tag_mutability = "MUTABLE"
  tags                 = merge(local.common_tags, { purpose = "pr-builds" })
}

resource "aws_ecr_repository" "frontend_ci" {
  name                 = "bcc-cvote-frontend-ci"
  image_tag_mutability = "MUTABLE"
  tags                 = merge(local.common_tags, { purpose = "pr-builds" })
}

locals {
  # A PR build is only needed until its PR merges.
  pr_builds_lifecycle = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "PR builds are only needed until merge"
      selection = {
        tagStatus   = "any"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 14
      }
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "backend_ci" {
  repository = aws_ecr_repository.backend_ci.name
  policy     = local.pr_builds_lifecycle
}

resource "aws_ecr_lifecycle_policy" "frontend_ci" {
  repository = aws_ecr_repository.frontend_ci.name
  policy     = local.pr_builds_lifecycle
}

# PR checks get their own role: it can push to the two *-ci repos and
# nothing else — no prod repo, no `latest`, no SSM, no instance. Only
# pull_request runs of this repo can assume it.
resource "aws_iam_role" "github_actions_ci" {
  name                 = "bcc-cvote-github-actions-ci"
  description          = "GitHub Actions PR checks: push PR image builds to the *-ci ECR repos only (cannot deploy)"
  max_session_duration = 3600
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = "repo:${var.github_repo}:pull_request"
        }
      }
    }]
  })
  tags = local.common_tags
}

resource "aws_iam_role_policy" "github_actions_ci" {
  name = "ci-ecr-push"
  role = aws_iam_role.github_actions_ci.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "EcrLogin"
        Effect   = "Allow"
        Action   = "ecr:GetAuthorizationToken"
        Resource = "*"
      },
      {
        Sid    = "PushPullPrBuildsOnly"
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer", "ecr:BatchGetImage",
          "ecr:PutImage", "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload"
        ]
        Resource = [aws_ecr_repository.backend_ci.arn, aws_ecr_repository.frontend_ci.arn]
      }
    ]
  })
}
