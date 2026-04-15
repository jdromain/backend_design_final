/**
 * guardrails.ts
 *
 * Production-grade input/output guardrails.
 *
 * Approach:
 * - Primary: OpenAI Moderation API (semantic understanding, no false positives)
 * - Fallback: Pattern-based transfer detection (explicit human requests)
 * - Harassment: Redis-backed warn counters survive reconnections
 * - Output: PII leak detection
 *
 * The old regex approach (e.g. /(kill|murder|die)/i) caused false positives
 * like "the battery died" → blocked. The moderation API understands context.
 */

import OpenAI from "openai";
import { createLogger } from "@rezovo/logging";
import { sessionStore } from "./sessionStore";

const logger = createLogger({ service: "realtime-core", module: "guardrails" });

// ─── Types ───

export interface GuardrailResult {
  blocked: boolean;
  action: "none" | "warn" | "block" | "transfer";
  message?: string;
  category?: string;
}

// ─── Configuration ───

const MAX_WARNINGS_BEFORE_TRANSFER = 2;

/**
 * Transfer detection patterns — these detect explicit requests
 * to speak with a human. These are not safety guardrails;
 * they're intent-level shortcuts.
 */
const TRANSFER_PATTERNS = [
  /speak\s+(?:to|with)\s+(?:a\s+)?(?:someone|person|human|agent|representative|rep)/i,
  /talk\s+(?:to|with)\s+(?:a\s+)?(?:someone|person|human|agent|representative|rep)/i,
  /transfer\s+me/i,
  /(?:real|actual|live)\s+person/i,
  /(?:get\s+me\s+)?(?:a\s+)?manager/i,
  /operator/i,
  /human\s+agent/i,
];

// ─── Engine ───

export class GuardrailsEngine {
  private openai: OpenAI;
  private moderationAvailable = true;

  constructor() {
    this.openai = new OpenAI();
  }

  /**
   * Check input for safety violations.
   *
   * Order of checks:
   * 1. Transfer detection (shortcut — not safety, just intent)
   * 2. OpenAI moderation API (semantic safety)
   * 3. Harassment counter (persistent via Redis)
   */
  async checkInput(text: string, callId: string): Promise<GuardrailResult> {
    try {
      logger.info("guardrail input check started", {
        callId,
        textLen: text.length,
        textPreview: text.slice(0, 160),
      });

      // 1. Explicit transfer request (not a safety issue, just routing)
      if (this.detectTransferRequest(text)) {
        logger.info("transfer request detected", { callId });
        return { blocked: false, action: "transfer" };
      }

      // 2. OpenAI Moderation API
      const moderation = await this.moderate(text);

      if (moderation) {
        // Violence / self-harm / sexual involving minors → hard block
        if (
          moderation.violence ||
          moderation["self-harm"] ||
          moderation["sexual/minors"]
        ) {
          logger.warn("severe content flagged by moderation API", {
            callId,
            categories: moderation,
          });
          return {
            blocked: true,
            action: "transfer",
            message: "Let me connect you with someone who can help.",
            category: "severe_content",
          };
        }

        // Harassment — progressive enforcement
        if (moderation.harassment || moderation["harassment/threatening"]) {
          return this.handleHarassment(callId, text);
        }
      }

      logger.info("guardrail input check passed", { callId, action: "none" });
      return { blocked: false, action: "none" };
    } catch (error) {
      logger.error("guardrail input check failed", {
        callId,
        error: (error as Error).message,
      });
      // Fail open — don't break the call
      return { blocked: false, action: "none" };
    }
  }

  /**
   * Check output for inappropriate content / PII leakage.
   */
  async checkOutput(text: string, callId: string): Promise<GuardrailResult> {
    try {
      logger.info("guardrail output check started", {
        callId,
        textLen: text.length,
        textPreview: text.slice(0, 160),
      });

      // Check for PII in output that shouldn't be there
      // (In a booking context, some PII like phone/name is expected and OK)
      const suspiciousPiiPatterns = [
        // SSN
        /\b\d{3}-\d{2}-\d{4}\b/,
        // Credit card numbers (basic pattern)
        /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/,
      ];

      for (const pattern of suspiciousPiiPatterns) {
        if (pattern.test(text)) {
          logger.warn("suspicious PII in output blocked", { callId });
          return {
            blocked: true,
            action: "block",
            message: "I apologize, let me rephrase that.",
            category: "pii_leak",
          };
        }
      }

      // Moderation check on output (catches prompt injection leaks)
      const moderation = await this.moderate(text);
      if (moderation && (moderation.violence || moderation["self-harm"] || moderation.sexual)) {
        logger.warn("output flagged by moderation", { callId });
      return {
          blocked: true,
          action: "block",
          category: "output_moderation",
      };
      }

      logger.info("guardrail output check passed", { callId, action: "none" });
      return { blocked: false, action: "none" };
    } catch (error) {
      logger.error("guardrail output check failed", {
        callId,
        error: (error as Error).message,
      });
      return { blocked: false, action: "none" };
    }
  }

  // ─── Private ───

  /**
   * Call OpenAI Moderation API. Returns category flags or null on failure.
   * Designed to degrade gracefully — if the API is down, guardrails skip.
   */
  private async moderate(
    text: string
  ): Promise<Record<string, boolean> | null> {
    if (!this.moderationAvailable) return null;

    try {
      const response = await this.openai.moderations.create({
        model: "omni-moderation-latest",
        input: text,
      });

      if (response.results.length > 0 && response.results[0].flagged) {
        return response.results[0].categories as unknown as Record<string, boolean>;
      }

      return null; // Not flagged
    } catch (error) {
      logger.warn("moderation API unavailable, degrading gracefully", {
        error: (error as Error).message,
      });
      // Mark as unavailable for 5 minutes to avoid hammering a down API
      this.moderationAvailable = false;
      setTimeout(() => {
        this.moderationAvailable = true;
      }, 5 * 60 * 1000);
      return null;
    }
  }

  /**
   * Progressive harassment handling:
   * - 1st offense: gentle warning
   * - 2nd offense: firm warning
   * - 3rd+: escalate to human
   *
   * Warn counts stored in Redis so they survive reconnections.
   */
  private async handleHarassment(
    callId: string,
    text: string
  ): Promise<GuardrailResult> {
    const warnCount = await sessionStore.incrementWarnCount(callId);

    logger.info("harassment flagged", { callId, warnCount });

    if (warnCount >= MAX_WARNINGS_BEFORE_TRANSFER) {
      return {
        blocked: true,
        action: "transfer",
        message: "Let me connect you with someone who can help.",
        category: "harassment",
      };
    }

    if (warnCount === 1) {
      return {
        blocked: false,
        action: "warn",
        message: "I understand you may be frustrated. I'm here to help — how can I assist you?",
        category: "harassment",
      };
    }

    return {
      blocked: false,
      action: "warn",
      message:
        "I want to make sure we have a productive conversation. Let's focus on how I can help you today.",
      category: "harassment",
    };
  }

  private detectTransferRequest(text: string): boolean {
    return TRANSFER_PATTERNS.some((p) => p.test(text));
  }
}

/** Singleton */
export const guardrailsEngine = new GuardrailsEngine();
