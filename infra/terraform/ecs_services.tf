# ECS Task Definition - Platform API
resource "aws_ecs_task_definition" "platform_api" {
  family                   = "${var.project_name}-platform-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "platform-api"
      image     = "${aws_ecr_repository.platform_api.repository_url}:latest"
      essential = true
      
      portMappings = [
        {
          containerPort = 3001
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = var.environment },
        { name = "PORT", value = "3001" },
        { name = "REDIS_ENABLED", value = var.enable_redis ? "true" : "false" },
        { name = "REDIS_HOST", value = var.enable_redis ? aws_elasticache_replication_group.redis[0].configuration_endpoint_address : "" },
        { name = "REDIS_PORT", value = var.enable_redis ? tostring(aws_elasticache_replication_group.redis[0].port) : "6379" },
        { name = "KAFKA_ENABLED", value = var.enable_kafka ? "true" : "false" },
        { name = "KAFKA_BROKERS", value = var.enable_kafka ? aws_msk_cluster.main[0].bootstrap_brokers_tls : "" },
        { name = "SUPABASE_ENABLED", value = "true" }
      ]

      secrets = [
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.openai_api_key.arn}" },
        { name = "DEEPGRAM_API_KEY", valueFrom = "${aws_secretsmanager_secret.deepgram_api_key.arn}" },
        { name = "ELEVENLABS_API_KEY", valueFrom = "${aws_secretsmanager_secret.elevenlabs_api_key.arn}" },
        { name = "SUPABASE_URL", valueFrom = "${aws_secretsmanager_secret.supabase_url.arn}" },
        { name = "SUPABASE_SERVICE_KEY", valueFrom = "${aws_secretsmanager_secret.supabase_key.arn}" },
        { name = "CLERK_SECRET_KEY", valueFrom = "${aws_secretsmanager_secret.clerk_key.arn}" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.platform_api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})\""]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name = "${var.project_name}-platform-api-task"
  }
}

# ECS Service - Platform API
resource "aws_ecs_service" "platform_api" {
  name            = "${var.project_name}-platform-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.platform_api.arn
  desired_count   = var.platform_api_min_tasks
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.platform_api.arn
    container_name   = "platform-api"
    container_port   = 3001
  }

  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }

  depends_on = [aws_lb_listener.http]

  tags = {
    Name = "${var.project_name}-platform-api-service"
  }
}

# Auto Scaling - Platform API
resource "aws_appautoscaling_target" "platform_api" {
  max_capacity       = var.platform_api_max_tasks
  min_capacity       = var.platform_api_min_tasks
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.platform_api.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "platform_api_cpu" {
  name               = "${var.project_name}-platform-api-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.platform_api.resource_id
  scalable_dimension = aws_appautoscaling_target.platform_api.scalable_dimension
  service_namespace  = aws_appautoscaling_target.platform_api.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 70.0
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
  }
}

# ECS Task Definition - Realtime Core (with RTP sidecar)
resource "aws_ecs_task_definition" "realtime_core" {
  family                   = "${var.project_name}-realtime-core"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "2048"
  memory                   = "4096"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "node-orchestrator"
      image     = "${aws_ecr_repository.realtime_core_node.repository_url}:latest"
      essential = true
      
      portMappings = [
        {
          containerPort = 8080
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "NODE_ENV", value = var.environment },
        { name = "PORT", value = "8080" },
        { name = "RTP_BRIDGE_URL", value = "ws://localhost:8081" },
        { name = "REDIS_ENABLED", value = var.enable_redis ? "true" : "false" },
        { name = "REDIS_HOST", value = var.enable_redis ? aws_elasticache_replication_group.redis[0].configuration_endpoint_address : "" },
        { name = "KAFKA_ENABLED", value = var.enable_kafka ? "true" : "false" },
        { name = "KAFKA_BROKERS", value = var.enable_kafka ? aws_msk_cluster.main[0].bootstrap_brokers_tls : "" }
      ]

      secrets = [
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.openai_api_key.arn}" },
        { name = "DEEPGRAM_API_KEY", valueFrom = "${aws_secretsmanager_secret.deepgram_api_key.arn}" },
        { name = "ELEVENLABS_API_KEY", valueFrom = "${aws_secretsmanager_secret.elevenlabs_api_key.arn}" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.realtime_core.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "node"
        }
      }

      dependsOn = [
        {
          containerName = "rtp-bridge"
          condition     = "HEALTHY"
        }
      ]
    },
    {
      name      = "rtp-bridge"
      image     = "${aws_ecr_repository.realtime_core_rtp.repository_url}:latest"
      essential = true
      
      portMappings = [
        {
          containerPort = 8081
          protocol      = "tcp"
        },
        {
          containerPort = 10000
          hostPort      = 10000
          protocol      = "udp"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.realtime_core.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "rtp"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "wget -q -O /dev/null http://localhost:8081/health || exit 1"]
        interval    = 10
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])

  tags = {
    Name = "${var.project_name}-realtime-core-task"
  }
}

# ECS Service - Realtime Core
resource "aws_ecs_service" "realtime_core" {
  name            = "${var.project_name}-realtime-core"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.realtime_core.arn
  desired_count   = var.realtime_core_min_tasks
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.realtime_core.arn
    container_name   = "node-orchestrator"
    container_port   = 8080
  }

  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }

  depends_on = [aws_lb_listener.http]

  tags = {
    Name = "${var.project_name}-realtime-core-service"
  }
}

# Auto Scaling - Realtime Core
resource "aws_appautoscaling_target" "realtime_core" {
  max_capacity       = var.realtime_core_max_tasks
  min_capacity       = var.realtime_core_min_tasks
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.realtime_core.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "realtime_core_cpu" {
  name               = "${var.project_name}-realtime-core-cpu-scaling"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.realtime_core.resource_id
  scalable_dimension = aws_appautoscaling_target.realtime_core.scalable_dimension
  service_namespace  = aws_appautoscaling_target.realtime_core.service_namespace

  target_tracking_scaling_policy_configuration {
    target_value       = 60.0
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    scale_in_cooldown  = 60
    scale_out_cooldown = 30
  }
}

# ECS Task Definition - Jobs Worker
resource "aws_ecs_task_definition" "jobs" {
  family                   = "${var.project_name}-jobs"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "jobs-worker"
      image     = "${aws_ecr_repository.jobs.repository_url}:latest"
      essential = true

      environment = [
        { name = "NODE_ENV", value = var.environment },
        { name = "KAFKA_ENABLED", value = var.enable_kafka ? "true" : "false" },
        { name = "KAFKA_BROKERS", value = var.enable_kafka ? aws_msk_cluster.main[0].bootstrap_brokers_tls : "" },
        { name = "SUPABASE_ENABLED", value = "true" }
      ]

      secrets = [
        { name = "OPENAI_API_KEY", valueFrom = "${aws_secretsmanager_secret.openai_api_key.arn}" },
        { name = "SUPABASE_URL", valueFrom = "${aws_secretsmanager_secret.supabase_url.arn}" },
        { name = "SUPABASE_SERVICE_KEY", valueFrom = "${aws_secretsmanager_secret.supabase_key.arn}" }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.jobs.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "ecs"
        }
      }
    }
  ])

  tags = {
    Name = "${var.project_name}-jobs-task"
  }
}

# ECS Service - Jobs Worker
resource "aws_ecs_service" "jobs" {
  name            = "${var.project_name}-jobs"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.jobs.arn
  desired_count   = 2
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = false
  }

  deployment_configuration {
    maximum_percent         = 200
    minimum_healthy_percent = 100
  }

  tags = {
    Name = "${var.project_name}-jobs-service"
  }
}




