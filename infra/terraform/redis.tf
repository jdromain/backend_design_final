# ElastiCache Subnet Group
resource "aws_elasticache_subnet_group" "redis" {
  count      = var.enable_redis ? 1 : 0
  name       = "${var.project_name}-redis-subnet"
  subnet_ids = aws_subnet.data[*].id

  tags = {
    Name = "${var.project_name}-redis-subnet-group"
  }
}

# Security Group for Redis
resource "aws_security_group" "redis" {
  count       = var.enable_redis ? 1 : 0
  name        = "${var.project_name}-redis-sg"
  description = "Security group for ElastiCache Redis"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Redis from ECS tasks"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.project_name}-redis-sg"
  }
}

# Random password for Redis auth
resource "random_password" "redis_auth" {
  length  = 32
  special = true
}

# ElastiCache Redis Cluster
resource "aws_elasticache_replication_group" "redis" {
  count                         = var.enable_redis ? 1 : 0
  replication_group_id          = "${var.project_name}-redis"
  description                   = "Redis cluster for Rezovo real-time caching"
  engine                        = "redis"
  engine_version                = "7.1"
  node_type                     = "cache.r7g.large"
  num_cache_clusters            = 3
  port                          = 6379
  parameter_group_name          = "default.redis7"
  automatic_failover_enabled    = true
  multi_az_enabled              = true
  at_rest_encryption_enabled    = true
  transit_encryption_enabled    = true
  auth_token_enabled            = true
  auth_token                    = random_password.redis_auth.result
  
  # Maintenance
  maintenance_window            = "sun:05:00-sun:07:00"
  snapshot_window               = "03:00-05:00"
  snapshot_retention_limit      = 5
  final_snapshot_identifier     = "${var.project_name}-redis-final-snapshot-${formatdate("YYYY-MM-DD-hhmm", timestamp())}"
  
  # Networking
  subnet_group_name             = aws_elasticache_subnet_group.redis[0].name
  security_group_ids            = [aws_security_group.redis[0].id]
  
  # Logging
  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_slow_log[0].name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  tags = {
    Name = "${var.project_name}-redis-cluster"
  }

  lifecycle {
    ignore_changes = [final_snapshot_identifier]
  }
}

# Store Redis auth token in Secrets Manager
resource "aws_secretsmanager_secret" "redis_auth" {
  count = var.enable_redis ? 1 : 0
  name  = "${var.project_name}/redis/auth-token"

  tags = {
    Name = "${var.project_name}-redis-auth"
  }
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  count         = var.enable_redis ? 1 : 0
  secret_id     = aws_secretsmanager_secret.redis_auth[0].id
  secret_string = random_password.redis_auth.result
}

# CloudWatch Logs for Redis slow queries
resource "aws_cloudwatch_log_group" "redis_slow_log" {
  count             = var.enable_redis ? 1 : 0
  name              = "/aws/elasticache/${var.project_name}/redis/slow-log"
  retention_in_days = 7

  tags = {
    Name = "${var.project_name}-redis-slow-log"
  }
}

# Outputs
output "redis_endpoint" {
  value       = var.enable_redis ? aws_elasticache_replication_group.redis[0].configuration_endpoint_address : null
  description = "Redis cluster endpoint"
  sensitive   = true
}

output "redis_port" {
  value       = var.enable_redis ? aws_elasticache_replication_group.redis[0].port : null
  description = "Redis port"
}




