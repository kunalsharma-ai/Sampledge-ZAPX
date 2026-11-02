output "load_balancer_dns" {
  description = "Point studio_domain and api_origin_domain here (CNAME or alias)."
  value       = aws_lb.main.dns_name
}

output "cloudfront_domains" {
  description = "Point runtime_domain and capi_domain here."
  value       = { for k, d in aws_cloudfront_distribution.static : k => d.domain_name }
}

output "cloudfront_distribution_ids" {
  value = { for k, d in aws_cloudfront_distribution.static : k => d.id }
}

output "static_buckets" {
  value = { for k, b in aws_s3_bucket.static : k => b.id }
}

output "ecr_repositories" {
  value = { for k, r in aws_ecr_repository.app : k => r.repository_url }
}

output "files_bucket" {
  value = aws_s3_bucket.files.id
}

output "app_secret_arn" {
  description = "Put the JSON with the app_secret_keys (and EDGE_SHARED_SECRET) here before the first deployment."
  value       = aws_secretsmanager_secret.app.arn
}

output "cluster" {
  value = aws_ecs_cluster.main.name
}

output "migrate_task" {
  value = {
    family          = aws_ecs_task_definition.migrate.family
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.tasks.id]
  }
}
