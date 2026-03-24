# Secrets Manager - Create placeholders for all required secrets
# NOTE: You must manually populate these secrets in AWS Console or via AWS CLI

resource "aws_secretsmanager_secret" "openai_api_key" {
  name        = "${var.project_name}/openai/api-key"
  description = "OpenAI API key for GPT-4"

  tags = {
    Name = "${var.project_name}-openai-key"
  }
}

resource "aws_secretsmanager_secret" "deepgram_api_key" {
  name        = "${var.project_name}/deepgram/api-key"
  description = "Deepgram API key for STT"

  tags = {
    Name = "${var.project_name}-deepgram-key"
  }
}

resource "aws_secretsmanager_secret" "elevenlabs_api_key" {
  name        = "${var.project_name}/elevenlabs/api-key"
  description = "ElevenLabs API key for TTS"

  tags = {
    Name = "${var.project_name}-elevenlabs-key"
  }
}

resource "aws_secretsmanager_secret" "supabase_url" {
  name        = "${var.project_name}/supabase/url"
  description = "Supabase project URL"

  tags = {
    Name = "${var.project_name}-supabase-url"
  }
}

resource "aws_secretsmanager_secret" "supabase_key" {
  name        = "${var.project_name}/supabase/service-key"
  description = "Supabase service role key"

  tags = {
    Name = "${var.project_name}-supabase-key"
  }
}

resource "aws_secretsmanager_secret" "clerk_key" {
  name        = "${var.project_name}/clerk/secret-key"
  description = "Clerk secret key for authentication"

  tags = {
    Name = "${var.project_name}-clerk-key"
  }
}

resource "aws_secretsmanager_secret" "twilio_account_sid" {
  name        = "${var.project_name}/twilio/account-sid"
  description = "Twilio Account SID"

  tags = {
    Name = "${var.project_name}-twilio-sid"
  }
}

resource "aws_secretsmanager_secret" "twilio_auth_token" {
  name        = "${var.project_name}/twilio/auth-token"
  description = "Twilio Auth Token"

  tags = {
    Name = "${var.project_name}-twilio-token"
  }
}

# Output secret ARNs
output "secrets_to_populate" {
  value = {
    openai_api_key        = aws_secretsmanager_secret.openai_api_key.arn
    deepgram_api_key      = aws_secretsmanager_secret.deepgram_api_key.arn
    elevenlabs_api_key    = aws_secretsmanager_secret.elevenlabs_api_key.arn
    supabase_url          = aws_secretsmanager_secret.supabase_url.arn
    supabase_service_key  = aws_secretsmanager_secret.supabase_key.arn
    clerk_secret_key      = aws_secretsmanager_secret.clerk_key.arn
    twilio_account_sid    = aws_secretsmanager_secret.twilio_account_sid.arn
    twilio_auth_token     = aws_secretsmanager_secret.twilio_auth_token.arn
  }
  description = "Secrets that need to be populated manually"
}




