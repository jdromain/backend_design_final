#!/usr/bin/env ts-node
import { randomUUID } from "crypto";
import twilio from "twilio";
import { createLogger } from "@rezovo/logging";
import { VoiceStore } from "../apps/platform-api/src/persistence/voiceStore";

const logger = createLogger({ service: "scripts", module: "twilioProvision" });

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const VOICE_WEBHOOK_URL = process.env.TWILIO_VOICE_WEBHOOK_URL || "https://api.rezovo.com/twilio/voice";
const STATUS_WEBHOOK_URL = process.env.TWILIO_STATUS_WEBHOOK_URL || "https://api.rezovo.com/twilio/status";
const AWS_SECRETS_MANAGER_ENABLED = process.env.AWS_SECRETS_MANAGER_ENABLED === "true";

interface ProvisionArgs {
  tenantId: string;
  areaCode?: string;
  phoneNumber?: string;
  friendlyName?: string;
}

async function storeSecret(name: string, value: Record<string, string>): Promise<string> {
  if (!AWS_SECRETS_MANAGER_ENABLED) {
    logger.warn("AWS Secrets Manager disabled, returning mock secret ID", { name });
    return `mock-secret-${randomUUID()}`;
  }

  try {
    const { SecretsManagerClient, CreateSecretCommand } = await import("@aws-sdk/client-secrets-manager");
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
    const command = new CreateSecretCommand({
      Name: name,
      SecretString: JSON.stringify(value),
      Description: `Twilio SIP credentials for ${value.phoneSid}`,
      Tags: [
        { Key: "Service", Value: "rezovo" },
        { Key: "Type", Value: "twilio-sip" }
      ]
    });
    const result = await client.send(command);
    logger.info("stored secret in AWS Secrets Manager", { name, arn: result.ARN });
    return result.ARN || name;
  } catch (err) {
    logger.error("failed to store secret in AWS", { error: (err as Error).message, name });
    throw new Error(`Failed to store secret: ${(err as Error).message}`);
  }
}

async function provisionNumber(args: ProvisionArgs): Promise<void> {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error("TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set");
  }

  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  const voiceStore = new VoiceStore();

  logger.info("provisioning Twilio number", { tenantId: args.tenantId, areaCode: args.areaCode });

  // Step 1: Buy or use existing phone number
  let phoneNumber: any;
  if (args.phoneNumber) {
    logger.info("using provided phone number", { phoneNumber: args.phoneNumber });
    phoneNumber = { phoneNumber: args.phoneNumber, sid: `PN${randomUUID().replace(/-/g, "")}` };
  } else {
    const availableNumbers = await client.availablePhoneNumbers("US").local.list({
      areaCode: args.areaCode || "415",
      limit: 1
    });
    if (availableNumbers.length === 0) {
      throw new Error(`No available numbers in area code ${args.areaCode}`);
    }
    phoneNumber = await client.incomingPhoneNumbers.create({
      phoneNumber: availableNumbers[0].phoneNumber,
      voiceUrl: VOICE_WEBHOOK_URL,
      voiceMethod: "POST",
      statusCallback: STATUS_WEBHOOK_URL,
      statusCallbackMethod: "POST",
      friendlyName: args.friendlyName || `Rezovo-${args.tenantId}`
    });
    logger.info("purchased phone number", { phoneNumber: phoneNumber.phoneNumber, sid: phoneNumber.sid });
  }

  // Step 2: Create SIP domain
  const sipDomainName = `${args.tenantId}-${Date.now()}.sip.rezovo.com`;
  const sipDomain = await client.sip.domains.create({
    domainName: sipDomainName,
    friendlyName: `Rezovo SIP ${args.tenantId}`,
    voiceUrl: VOICE_WEBHOOK_URL,
    voiceMethod: "POST"
  });
  logger.info("created SIP domain", { domain: sipDomain.domainName, sid: sipDomain.sid });

  // Step 3: Create SIP credentials
  const sipUsername = `rezovo-${args.tenantId}`;
  const sipPassword = randomUUID();
  const credentialList = await client.sip.credentialLists.create({
    friendlyName: `Rezovo ${args.tenantId}`
  });
  await client.sip.credentialLists(credentialList.sid).credentials.create({
    username: sipUsername,
    password: sipPassword
  });
  logger.info("created SIP credentials", { username: sipUsername });

  // Step 4: Store secrets in AWS Secrets Manager
  const secretId = await storeSecret(`rezovo/voice/${args.tenantId}`, {
    sipUsername,
    sipPassword,
    phoneSid: phoneNumber.sid,
    sipDomain: sipDomain.domainName
  });

  // Step 5: Write to Postgres
  const webhookToken = randomUUID();
  await voiceStore.upsertVoiceNumber({
    tenantId: args.tenantId,
    phoneNumber: phoneNumber.phoneNumber,
    phoneSid: phoneNumber.sid,
    sipDomain: sipDomain.domainName,
    secretId,
    webhookToken,
    status: "provisioned"
  });

  logger.info("provisioning complete", {
    tenantId: args.tenantId,
    phoneNumber: phoneNumber.phoneNumber,
    sipDomain: sipDomain.domainName,
    secretId
  });
  console.log(`✅ Provisioned ${phoneNumber.phoneNumber} for tenant ${args.tenantId}`);
  console.log(`   SIP Domain: ${sipDomain.domainName}`);
  console.log(`   Secret ID: ${secretId}`);
  console.log(`   Webhook Token: ${webhookToken}`);
}

// CLI entry point
const args = process.argv.slice(2);
const tenantId = args.find((a) => a.startsWith("--tenant-id="))?.split("=")[1];
const areaCode = args.find((a) => a.startsWith("--area-code="))?.split("=")[1];
const phoneNumber = args.find((a) => a.startsWith("--phone-number="))?.split("=")[1];
const friendlyName = args.find((a) => a.startsWith("--friendly-name="))?.split("=")[1];

if (!tenantId) {
  console.error("Usage: pnpm ts-node scripts/twilioProvision.ts --tenant-id=<id> [--area-code=<code>] [--phone-number=<number>]");
  process.exit(1);
}

provisionNumber({ tenantId, areaCode, phoneNumber, friendlyName }).catch((err) => {
  logger.error("provisioning failed", { error: err.message });
  console.error(`❌ Provisioning failed: ${err.message}`);
  process.exit(1);
});
