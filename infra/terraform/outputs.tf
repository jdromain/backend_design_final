# Main outputs for the infrastructure

output "vpc_id" {
  value       = aws_vpc.main.id
  description = "VPC ID"
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Private subnet IDs"
}

output "public_subnet_ids" {
  value       = aws_subnet.public[*].id
  description = "Public subnet IDs"
}

output "load_balancer_dns" {
  value       = aws_lb.main.dns_name
  description = "Load balancer DNS name - point your domain here"
}

output "ecr_repositories" {
  value = {
    realtime_core_node = aws_ecr_repository.realtime_core_node.repository_url
    realtime_core_rtp  = aws_ecr_repository.realtime_core_rtp.repository_url
    platform_api       = aws_ecr_repository.platform_api.repository_url
    jobs               = aws_ecr_repository.jobs.repository_url
  }
  description = "ECR repository URLs for Docker images"
}

output "deployment_summary" {
  value = {
    region              = var.aws_region
    environment         = var.environment
    vpc_cidr            = var.vpc_cidr
    alb_dns             = aws_lb.main.dns_name
    ecs_cluster         = aws_ecs_cluster.main.name
    redis_enabled       = var.enable_redis
    kafka_enabled       = var.enable_kafka
    recordings_bucket   = aws_s3_bucket.recordings.id
  }
  description = "Deployment summary"
}




