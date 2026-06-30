variable "aws_region" {
  default = "ap-south-1"
}

variable "vpc_id" {
  description = "VPC ID to deploy K3s node into"
}

variable "subnet_id" {
  description = "Public subnet ID for K3s EC2 instance"
}

variable "key_pair_name" {
  description = "EC2 key pair name for SSH access"
}

variable "admin_cidr" {
  description = "Your IP CIDR for SSH/K3s API access (e.g. 203.0.113.0/32)"
}

locals {
  common_tags = {
    Project     = "bcc-cvote"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}
