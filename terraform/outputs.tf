output "k3s_public_ip" {
  value       = aws_instance.k3s.public_ip
  description = "Public IP of K3s node — set this as your CloudFront origin"
}

output "ecr_backend_url" {
  value = aws_ecr_repository.backend.repository_url
}

output "ecr_frontend_url" {
  value = aws_ecr_repository.frontend.repository_url
}

output "app_url" {
  value = "http://${aws_instance.k3s.public_ip}:30080"
}
