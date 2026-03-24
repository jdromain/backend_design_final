import { createLogger } from "@rezovo/logging";

const logger = createLogger({ service: "platform-api", module: "secrets" });

/**
 * SecretManager provides access to sensitive credentials without storing them in plaintext.
 * In production, integrates with AWS Secrets Manager.
 * In development, falls back to environment variables.
 */
export class SecretManager {
  private cache = new Map<string, { value: string; expires: number }>();
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly useAwsSecretsManager: boolean;

  constructor() {
    this.useAwsSecretsManager = process.env.USE_AWS_SECRETS_MANAGER === "true";
    if (this.useAwsSecretsManager) {
      logger.info("secrets manager initialized with AWS backend");
    } else {
      logger.info("secrets manager initialized with env var fallback (dev mode)");
    }
  }

  /**
   * Get a secret value by key.
   * In production: fetches from AWS Secrets Manager with caching
   * In dev: reads from environment variables
   */
  async getSecret(key: string): Promise<string> {
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      return cached.value;
    }

    let value: string;

    if (this.useAwsSecretsManager) {
      value = await this.fetchFromAws(key);
    } else {
      value = this.fetchFromEnv(key);
    }

    // Cache the value
    this.cache.set(key, {
      value,
      expires: Date.now() + this.CACHE_TTL_MS
    });

    return value;
  }

  /**
   * Fetch secret from AWS Secrets Manager
   */
  private async fetchFromAws(key: string): Promise<string> {
    try {
      // Lazy import to avoid loading AWS SDK in dev mode
      const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
      
      const client = new SecretsManagerClient({
        region: process.env.AWS_REGION || "us-east-1"
      });

      const command = new GetSecretValueCommand({ SecretId: key });
      const response = await client.send(command);

      if (!response.SecretString) {
        throw new Error(`Secret ${key} returned empty value`);
      }

      logger.info("fetched secret from AWS", { key });
      return response.SecretString;
    } catch (err) {
      logger.error("failed to fetch secret from AWS", {
        key,
        error: (err as Error).message
      });
      throw new Error(`Failed to fetch secret ${key}: ${(err as Error).message}`);
    }
  }

  /**
   * Fetch secret from environment variables (dev mode)
   */
  private fetchFromEnv(key: string): string {
    // Map secret keys to env var names
    const envKey = key.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const value = process.env[envKey];

    if (!value) {
      throw new Error(`Secret ${key} not found in environment (expected env var: ${envKey})`);
    }

    return value;
  }

  /**
   * Clear the cache (useful for rotation)
   */
  clearCache(): void {
    this.cache.clear();
    logger.info("secrets cache cleared");
  }

  /**
   * Get Twilio SIP credentials for a phone number
   */
  async getTwilioSipCredentials(phoneNumber: string): Promise<{
    username: string;
    password: string;
    domain: string;
  }> {
    // In production, these would be stored as:
    // - arn:aws:secretsmanager:region:account:secret:twilio/sip/{phoneNumber}/username
    // - arn:aws:secretsmanager:region:account:secret:twilio/sip/{phoneNumber}/password
    
    const secretKey = `twilio/sip/${phoneNumber}`;
    const secretValue = await this.getSecret(secretKey);

    // Parse the JSON secret (AWS Secrets Manager best practice)
    try {
      const parsed = JSON.parse(secretValue);
      return {
        username: parsed.username,
        password: parsed.password,
        domain: parsed.domain || "example.pstn.twilio.com"
      };
    } catch {
      // Fallback for simple string secrets in dev
      return {
        username: process.env.TWILIO_SIP_USERNAME || "",
        password: process.env.TWILIO_SIP_PASSWORD || "",
        domain: process.env.TWILIO_SIP_DOMAIN || "example.pstn.twilio.com"
      };
    }
  }

  /**
   * Get Twilio auth token
   */
  async getTwilioAuthToken(): Promise<string> {
    return this.getSecret("twilio/auth_token");
  }

}

// Singleton instance
let instance: SecretManager | null = null;

export function getSecretManager(): SecretManager {
  if (!instance) {
    instance = new SecretManager();
  }
  return instance;
}






