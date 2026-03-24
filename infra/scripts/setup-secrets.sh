#!/bin/bash
set -e

# Script to populate AWS Secrets Manager with required secrets

AWS_REGION="${AWS_REGION:-us-east-1}"
PROJECT_NAME="rezovo"

echo "🔐 Setting up AWS Secrets Manager"
echo "=================================="
echo ""

# Function to create/update secret
update_secret() {
    local secret_name=$1
    local secret_value=$2
    
    if aws secretsmanager describe-secret --secret-id "$secret_name" --region $AWS_REGION &>/dev/null; then
        echo "Updating existing secret: $secret_name"
        aws secretsmanager put-secret-value \
            --secret-id "$secret_name" \
            --secret-string "$secret_value" \
            --region $AWS_REGION
    else
        echo "Creating new secret: $secret_name"
        aws secretsmanager create-secret \
            --name "$secret_name" \
            --secret-string "$secret_value" \
            --region $AWS_REGION
    fi
}

# Prompt for each secret
echo "Please provide the following secrets:"
echo ""

read -p "OpenAI API Key: " OPENAI_API_KEY
update_secret "$PROJECT_NAME/openai/api-key" "$OPENAI_API_KEY"

read -p "Deepgram API Key: " DEEPGRAM_API_KEY
update_secret "$PROJECT_NAME/deepgram/api-key" "$DEEPGRAM_API_KEY"

read -p "ElevenLabs API Key: " ELEVENLABS_API_KEY
update_secret "$PROJECT_NAME/elevenlabs/api-key" "$ELEVENLABS_API_KEY"

read -p "Supabase URL: " SUPABASE_URL
update_secret "$PROJECT_NAME/supabase/url" "$SUPABASE_URL"

read -p "Supabase Service Key: " SUPABASE_KEY
update_secret "$PROJECT_NAME/supabase/service-key" "$SUPABASE_KEY"

read -p "Clerk Secret Key: " CLERK_KEY
update_secret "$PROJECT_NAME/clerk/secret-key" "$CLERK_KEY"

read -p "Twilio Account SID (optional, press enter to skip): " TWILIO_SID
if [ -n "$TWILIO_SID" ]; then
    update_secret "$PROJECT_NAME/twilio/account-sid" "$TWILIO_SID"
fi

read -p "Twilio Auth Token (optional, press enter to skip): " TWILIO_TOKEN
if [ -n "$TWILIO_TOKEN" ]; then
    update_secret "$PROJECT_NAME/twilio/auth-token" "$TWILIO_TOKEN"
fi

echo ""
echo "✅ All secrets configured successfully!"
echo ""
echo "You can now deploy the application with:"
echo "  cd infra/scripts && ./deploy.sh"




