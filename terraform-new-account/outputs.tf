output "public_ip" {
  value       = aws_eip.app.public_ip
  description = "Static public IP (Elastic IP) of the app instance"
}

output "app_hostname" {
  value       = "${replace(aws_eip.app.public_ip, ".", "-")}.sslip.io"
  description = "Free hostname resolving to the EIP — this is what deploy.sh's Caddy config requests a Let's Encrypt cert for, and what the OLD account's CloudFront origin should be repointed to at cutover"
}

output "app_url_direct" {
  value       = "https://${replace(aws_eip.app.public_ip, ".", "-")}.sslip.io"
  description = "Direct URL for smoke-testing before CloudFront is repointed"
}

output "instance_id" {
  value       = aws_instance.app.id
  description = "Use for SSM Session Manager (`aws ssm start-session --target <id>`) and SSM RunCommand deploys"
}

output "ecr_backend_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecr_frontend_url" {
  value = aws_ecr_repository.frontend.repository_url
}

output "github_actions_deploy_role_arn" {
  value       = aws_iam_role.github_actions_deploy.arn
  description = "Set as AWS_DEPLOY_ROLE_ARN repo secret for the new account's CI"
}

output "ssm_session_command" {
  value       = "aws ssm start-session --target ${aws_instance.app.id} --region ap-south-1 --profile bcc-cvote-new"
  description = "Shell into the instance — no SSH key, no open port 22"
}

output "manual_first_deploy_command" {
  value       = "aws ssm send-command --instance-ids ${aws_instance.app.id} --document-name AWS-RunShellScript --parameters commands='[\"/opt/bcc-cvote/deploy.sh\"]' --region ap-south-1 --profile bcc-cvote-new"
  description = "Run once, after the first image has been pushed to ECR and SSM secrets are set for real"
}
