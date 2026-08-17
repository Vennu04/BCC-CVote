variable "aws_region" {
  default = "ap-south-1"
}

variable "github_repo" {
  description = "GitHub repo as owner/name, used for OIDC trust policy"
  default     = "Vennu04/BCC-CVote"
}

locals {
  common_tags = {
    Project     = "bcc-cvote"
    Environment = "production"
    ManagedBy   = "terraform"
    Account     = "new-dedicated-free-tier"
  }
}
