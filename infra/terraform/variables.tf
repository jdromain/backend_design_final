variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name (dev, staging, prod)"
  type        = string
  default     = "prod"
}

variable "project_name" {
  description = "Project name"
  type        = string
  default     = "rezovo"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "enable_kafka" {
  description = "Enable Amazon MSK (Kafka)"
  type        = bool
  default     = true
}

variable "enable_redis" {
  description = "Enable ElastiCache Redis"
  type        = bool
  default     = true
}

variable "realtime_core_min_tasks" {
  description = "Minimum number of realtime-core tasks"
  type        = number
  default     = 2
}

variable "realtime_core_max_tasks" {
  description = "Maximum number of realtime-core tasks"
  type        = number
  default     = 50
}

variable "platform_api_min_tasks" {
  description = "Minimum number of platform-api tasks"
  type        = number
  default     = 2
}

variable "platform_api_max_tasks" {
  description = "Maximum number of platform-api tasks"
  type        = number
  default     = 10
}

variable "domain_name" {
  description = "Domain name for the application"
  type        = string
  default     = "rezovo.ai"
}

variable "acm_certificate_arn" {
  description = "ARN of ACM certificate for HTTPS (create manually in AWS Console)"
  type        = string
  default     = ""
}




