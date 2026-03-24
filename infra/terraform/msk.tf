# Amazon MSK (Kafka) Configuration
resource "aws_msk_configuration" "main" {
  count          = var.enable_kafka ? 1 : 0
  name           = "${var.project_name}-msk-config"
  kafka_version  = "3.5.1"
  
  server_properties = <<PROPERTIES
auto.create.topics.enable=true
default.replication.factor=3
min.insync.replicas=2
num.io.threads=8
num.network.threads=5
num.partitions=3
num.replica.fetchers=2
replica.lag.time.max.ms=30000
socket.receive.buffer.bytes=102400
socket.request.max.bytes=104857600
socket.send.buffer.bytes=102400
unclean.leader.election.enable=false
zookeeper.session.timeout.ms=18000
log.retention.hours=168
log.retention.bytes=1073741824
PROPERTIES
}

# Security Group for MSK
resource "aws_security_group" "msk" {
  count       = var.enable_kafka ? 1 : 0
  name        = "${var.project_name}-msk-sg"
  description = "Security group for Amazon MSK"
  vpc_id      = aws_vpc.main.id

  ingress {
    description     = "Kafka from ECS tasks"
    from_port       = 9092
    to_port         = 9092
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  ingress {
    description     = "Kafka TLS from ECS tasks"
    from_port       = 9094
    to_port         = 9094
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  ingress {
    description     = "Zookeeper from ECS tasks"
    from_port       = 2181
    to_port         = 2181
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
    Name = "${var.project_name}-msk-sg"
  }
}

# KMS key for MSK encryption
resource "aws_kms_key" "msk" {
  count               = var.enable_kafka ? 1 : 0
  description         = "KMS key for MSK encryption"
  enable_key_rotation = true

  tags = {
    Name = "${var.project_name}-msk-kms"
  }
}

resource "aws_kms_alias" "msk" {
  count         = var.enable_kafka ? 1 : 0
  name          = "alias/${var.project_name}-msk"
  target_key_id = aws_kms_key.msk[0].key_id
}

# MSK Cluster
resource "aws_msk_cluster" "main" {
  count                  = var.enable_kafka ? 1 : 0
  cluster_name           = "${var.project_name}-kafka"
  kafka_version          = "3.5.1"
  number_of_broker_nodes = 3

  broker_node_group_info {
    instance_type   = "kafka.m5.large"
    client_subnets  = aws_subnet.data[*].id
    security_groups = [aws_security_group.msk[0].id]
    
    storage_info {
      ebs_storage_info {
        volume_size            = 100
        provisioned_throughput {
          enabled           = true
          volume_throughput = 250
        }
      }
    }
  }

  configuration_info {
    arn      = aws_msk_configuration.main[0].arn
    revision = aws_msk_configuration.main[0].latest_revision
  }

  encryption_info {
    encryption_in_transit {
      client_broker = "TLS"
      in_cluster    = true
    }
    encryption_at_rest_kms_key_arn = aws_kms_key.msk[0].arn
  }

  logging_info {
    broker_logs {
      cloudwatch_logs {
        enabled   = true
        log_group = aws_cloudwatch_log_group.msk[0].name
      }
    }
  }

  tags = {
    Name = "${var.project_name}-msk-cluster"
  }
}

# CloudWatch Logs for MSK
resource "aws_cloudwatch_log_group" "msk" {
  count             = var.enable_kafka ? 1 : 0
  name              = "/aws/msk/${var.project_name}"
  retention_in_days = 7

  tags = {
    Name = "${var.project_name}-msk-logs"
  }
}

# Output
output "msk_bootstrap_brokers" {
  value       = var.enable_kafka ? aws_msk_cluster.main[0].bootstrap_brokers_tls : null
  description = "MSK bootstrap brokers (TLS)"
  sensitive   = true
}

output "msk_zookeeper_connect_string" {
  value       = var.enable_kafka ? aws_msk_cluster.main[0].zookeeper_connect_string : null
  description = "MSK Zookeeper connection string"
  sensitive   = true
}




