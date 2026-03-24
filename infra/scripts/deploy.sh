#!/bin/bash
set -e

# Rezovo AWS Deployment Script
# This script deploys the complete infrastructure to AWS

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
AWS_REGION="${AWS_REGION:-us-east-1}"
AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID}"
ENVIRONMENT="${ENVIRONMENT:-prod}"

echo -e "${GREEN}🚀 Rezovo AWS Deployment${NC}"
echo "======================================"
echo "Region: $AWS_REGION"
echo "Environment: $ENVIRONMENT"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v terraform &> /dev/null; then
    echo -e "${RED}❌ Terraform not found. Please install Terraform.${NC}"
    exit 1
fi

if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found. Please install AWS CLI.${NC}"
    exit 1
fi

if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker not found. Please install Docker.${NC}"
    exit 1
fi

if [ -z "$AWS_ACCOUNT_ID" ]; then
    AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
    echo "Detected AWS Account ID: $AWS_ACCOUNT_ID"
fi

echo -e "${GREEN}✓ All prerequisites met${NC}"
echo ""

# Step 1: Initialize Terraform
echo -e "${YELLOW}Step 1: Initializing Terraform...${NC}"
cd "$PROJECT_ROOT/infra/terraform"

# Create S3 bucket for Terraform state if it doesn't exist
BUCKET_NAME="rezovo-terraform-state"
if ! aws s3 ls "s3://$BUCKET_NAME" 2>/dev/null; then
    echo "Creating S3 bucket for Terraform state..."
    aws s3 mb "s3://$BUCKET_NAME" --region $AWS_REGION
    aws s3api put-bucket-versioning --bucket $BUCKET_NAME --versioning-configuration Status=Enabled
fi

# Create DynamoDB table for state locking
TABLE_NAME="rezovo-terraform-locks"
if ! aws dynamodb describe-table --table-name $TABLE_NAME --region $AWS_REGION 2>/dev/null; then
    echo "Creating DynamoDB table for state locking..."
    aws dynamodb create-table \
        --table-name $TABLE_NAME \
        --attribute-definitions AttributeName=LockID,AttributeType=S \
        --key-schema AttributeName=LockID,KeyType=HASH \
        --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5 \
        --region $AWS_REGION
fi

terraform init
echo -e "${GREEN}✓ Terraform initialized${NC}"
echo ""

# Step 2: Plan infrastructure
echo -e "${YELLOW}Step 2: Planning infrastructure...${NC}"
terraform plan -out=tfplan
echo -e "${GREEN}✓ Plan created${NC}"
echo ""

# Step 3: Confirm deployment
echo -e "${YELLOW}Step 3: Review and confirm${NC}"
read -p "Do you want to apply this plan? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Deployment cancelled."
    exit 0
fi

# Step 4: Apply infrastructure
echo -e "${YELLOW}Step 4: Applying infrastructure...${NC}"
terraform apply tfplan
echo -e "${GREEN}✓ Infrastructure created${NC}"
echo ""

# Step 5: Get outputs
echo -e "${YELLOW}Step 5: Retrieving infrastructure details...${NC}"
ECR_REPO_API=$(terraform output -raw ecr_repositories | jq -r '.platform_api')
ECR_REPO_REALTIME_NODE=$(terraform output -raw ecr_repositories | jq -r '.realtime_core_node')
ECR_REPO_REALTIME_RTP=$(terraform output -raw ecr_repositories | jq -r '.realtime_core_rtp')
ECR_REPO_JOBS=$(terraform output -raw ecr_repositories | jq -r '.jobs')
ALB_DNS=$(terraform output -raw load_balancer_dns)
echo -e "${GREEN}✓ Outputs retrieved${NC}"
echo ""

# Step 6: Build and push Docker images
echo -e "${YELLOW}Step 6: Building and pushing Docker images...${NC}"
cd "$PROJECT_ROOT"

# Login to ECR
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com

# Build and push platform-api
echo "Building platform-api..."
docker build -f apps/platform-api/Dockerfile -t $ECR_REPO_API:latest .
docker push $ECR_REPO_API:latest

# Build and push realtime-core
echo "Building realtime-core (Node)..."
docker build -f apps/realtime-core/Dockerfile.node -t $ECR_REPO_REALTIME_NODE:latest .
docker push $ECR_REPO_REALTIME_NODE:latest

echo "Building realtime-core (RTP)..."
docker build -f apps/realtime-core/Dockerfile.rtp -t $ECR_REPO_REALTIME_RTP:latest .
docker push $ECR_REPO_REALTIME_RTP:latest

# Build and push jobs
echo "Building jobs worker..."
docker build -f apps/jobs/Dockerfile -t $ECR_REPO_JOBS:latest .
docker push $ECR_REPO_JOBS:latest

echo -e "${GREEN}✓ Docker images built and pushed${NC}"
echo ""

# Step 7: Deploy to ECS
echo -e "${YELLOW}Step 7: Deploying services to ECS...${NC}"
aws ecs update-service --cluster rezovo-cluster --service rezovo-platform-api --force-new-deployment --region $AWS_REGION
aws ecs update-service --cluster rezovo-cluster --service rezovo-realtime-core --force-new-deployment --region $AWS_REGION
aws ecs update-service --cluster rezovo-cluster --service rezovo-jobs --force-new-deployment --region $AWS_REGION

echo "Waiting for services to stabilize..."
aws ecs wait services-stable --cluster rezovo-cluster --services rezovo-platform-api rezovo-realtime-core rezovo-jobs --region $AWS_REGION

echo -e "${GREEN}✓ Services deployed${NC}"
echo ""

# Final summary
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}🎉 Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Load Balancer: http://$ALB_DNS"
echo "API Health Check: http://$ALB_DNS/health"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Populate secrets in AWS Secrets Manager"
echo "2. Point your domain to: $ALB_DNS"
echo "3. Create ACM certificate and update Terraform variables"
echo "4. Run 'terraform apply' again to enable HTTPS"
echo ""




