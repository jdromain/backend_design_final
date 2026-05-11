import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { createLogger } from "@rezovo/logging";
import { env } from "../env";

const logger = createLogger({ service: "platform-api", module: "tokenCrypto" });

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;

function keyMaterial(): Buffer {
  const raw = env.CALENDAR_OAUTH_ENCRYPTION_KEY.trim();
  if (!raw) {
    const fallbackSeed = env.INTERNAL_SERVICE_TOKEN.trim() || "rezovo-dev-calendar-key";
    logger.warn("CALENDAR_OAUTH_ENCRYPTION_KEY missing; using derived fallback seed");
    return createHash("sha256").update(fallbackSeed).digest();
  }

  try {
    // 64 hex chars = 32 bytes.
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, "hex");
    }
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length === 32) {
      return decoded;
    }
  } catch {
    // handled by fallback hash below.
  }

  return createHash("sha256").update(raw).digest();
}

const KEY = keyMaterial();

function b64(input: Buffer): string {
  return input.toString("base64");
}

function fromB64(input: string): Buffer {
  return Buffer.from(input, "base64");
}

export function encryptToken(plainText: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${b64(iv)}:${b64(authTag)}:${b64(encrypted)}`;
}

export function decryptToken(cipherText: string): string {
  if (!cipherText) return "";
  if (!cipherText.startsWith("v1:")) return cipherText;

  const [, ivPart, tagPart, dataPart] = cipherText.split(":");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("invalid encrypted token payload");
  }

  const decipher = createDecipheriv(ALGO, KEY, fromB64(ivPart));
  decipher.setAuthTag(fromB64(tagPart));
  const decrypted = Buffer.concat([decipher.update(fromB64(dataPart)), decipher.final()]);
  return decrypted.toString("utf8");
}
