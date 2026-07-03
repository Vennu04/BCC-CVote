variable "aws_region" {
  default = "ap-south-1"
}

variable "vpc_id" {
  description = "VPC ID to deploy K3s node into"
}

variable "subnet_id" {
  description = "Public subnet ID for K3s EC2 instance"
}

variable "admin_cidr" {
  description = "Your IP CIDR for SSH/K3s API access (e.g. 203.0.113.0/32)"
}

variable "acme_email" {
  description = "Email for Let's Encrypt certificate registration/expiry notices"
}

variable "github_repo" {
  description = "GitHub repo as owner/name, used for OIDC trust policy and pulling GitOps manifests (e.g. Vennu04/BCC-CVote)"
  default     = "Vennu04/BCC-CVote"
}

variable "vfla_monitoring_sg_id" {
  description = "Security group ID of the existing vfla-monitoring-grafana instance — bcc-cvote's exporters open a rule to let it scrape them instead of running a dedicated monitoring instance"
  default     = "sg-0d7dceaea35d53553"
}

locals {
  common_tags = {
    Project     = "bcc-cvote"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}
