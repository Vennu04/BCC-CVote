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

output "monitoring_ip" {
  value       = aws_instance.monitoring.public_ip
  description = "Public IP of the monitoring instance (Grafana/Prometheus, admin_cidr only)"
}

output "grafana_url" {
  value       = "http://${aws_instance.monitoring.public_ip}:3000"
  description = "Grafana — login is admin / grafana_admin_password"
}

output "prometheus_url" {
  value = "http://${aws_instance.monitoring.public_ip}:9090"
}

output "grafana_admin_password" {
  value       = random_password.grafana_admin.result
  sensitive   = true
  description = "Run: terraform output -raw grafana_admin_password"
}

output "monitoring_ssh_command" {
  value = "ssh -i bcc-cvote-key.pem ubuntu@${aws_instance.monitoring.public_ip}"
}
