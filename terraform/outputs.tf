output "k3s_public_ip" {
  value       = aws_eip.k3s.public_ip
  description = "Static public IP of the K3s node (Elastic IP — stable across stop/start)"
}

output "app_hostname" {
  value       = "${replace(aws_eip.k3s.public_ip, ".", "-")}.sslip.io"
  description = "Free hostname (no domain needed) that resolves to the Elastic IP — use this as ingress.host / k8s/prod/ingress.yaml's host field, then commit that change once, before the first ArgoCD sync."
}

output "app_url" {
  value       = "https://${replace(aws_eip.k3s.public_ip, ".", "-")}.sslip.io"
  description = "Public HTTPS URL for the app once ingress.yaml has been updated with app_hostname and cert-manager has issued the certificate"
}

output "cloudfront_url" {
  value       = "https://${aws_cloudfront_distribution.app.domain_name}"
  description = "Public URL to share with players — stable across EIP changes, unlike the raw sslip.io IP-based URL"
}

output "ecr_backend_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecr_frontend_url" {
  value = aws_ecr_repository.frontend.repository_url
}

output "github_actions_deploy_role_arn" {
  value       = aws_iam_role.github_actions_deploy.arn
  description = "Set this as the AWS_DEPLOY_ROLE_ARN secret in the GitHub repo"
}

output "ssh_command" {
  value       = "ssh -i bcc-cvote-key.pem ubuntu@${aws_eip.k3s.public_ip}"
  description = "SSH into the node (only reachable from admin_cidr) — save ssh_private_key to bcc-cvote-key.pem first (chmod 400)"
}

output "ssh_private_key" {
  value       = tls_private_key.k3s_ssh.private_key_pem
  sensitive   = true
  description = "Run: terraform output -raw ssh_private_key > bcc-cvote-key.pem && chmod 400 bcc-cvote-key.pem"
}

output "bcc_cvote_scrape_config" {
  description = "Add this to vfla-monitoring-grafana's prometheus.yml scrape_configs (SSH there yourself — this Terraform doesn't own that instance)"
  value       = <<-EOT
    - job_name: 'bcc-cvote-node-exporter'
      static_configs:
        - targets: ['${aws_instance.k3s.private_ip}:30100']
    - job_name: 'bcc-cvote-kube-state-metrics'
      static_configs:
        - targets: ['${aws_instance.k3s.private_ip}:30101']
  EOT
}

output "mongodb_private_ip" {
  value       = aws_instance.mongodb.private_ip
  description = "Use this in the MONGODB_URI SSM parameter — only reachable from the app node's security group, never public"
}

output "mongodb_ssh_command" {
  value = "ssh -i bcc-cvote-key.pem ubuntu@${aws_instance.mongodb.public_ip}"
}
