/**
 * stateMachine.ts
 *
 * Conversation state machine for managing multi-turn call flows.
 *
 * Key design decisions:
 * - Only reclassify intent on first turn, when no intent is set, or when
 *   the user explicitly redirects ("actually I want to cancel instead")
 * - Accumulate extracted slots across turns (don't reset per turn)
 * - Track retry count for escalation rules
 * - Serializable to/from JSON for Redis persistence
 */

import { createLogger } from "@rezovo/logging";
import { REQUIRED_SLOTS } from "./openai-agents/schemas";

const logger = createLogger({ service: "realtime-core", module: "stateMachine" });

// ─── Types ───

export type ConversationStage =
  | "greeting"        // Initial greeting sent, waiting for first user input
  | "intake"          // First user utterance received, classifying intent
  | "active_flow"     // Inside a specific intent flow (booking, modify, etc.)
  | "confirmation"    // All slots collected — confirming before action
  | "executing"       // Tool call in progress
  | "post_action"     // Action completed, wrapping up or asking if anything else
  | "closing"         // Wrapping up the call
  | "transfer";       // Escalating to human

export type ActiveIntent =
  | "create_booking"
  | "modify_booking"
  | "cancel_booking"
  | "complaint"
  | "info_request"
  | "human_transfer"
  | "other"
  | null;

export interface ConversationState {
  stage: ConversationStage;
  activeIntent: ActiveIntent;
  intentConfidence: number;
  intentChangeCount: number;

  // Slot tracking
  slots: Record<string, unknown>;
  missingSlots: string[];

  // Flow control
  turnsSinceIntentSet: number;
  confirmationPending: boolean;
  retryCount: number;
  maxRetries: number;

  // Tool execution tracking
  lastToolCall: string | null;
  lastToolResult: unknown | null;
}

// ─── Redirect detection patterns ───

const REDIRECT_PATTERNS = [
  /actually\s+(i|i'd|i\s+want|can\s+you|let'?s)/i,
  /never\s*mind/i,
  /instead\b/i,
  /wait[,.]?\s+(i|can|let)/i,
  /forget\s+(that|about|it)/i,
  /scratch\s+that/i,
  /change\s+of\s+plans/i,
  /on\s+second\s+thought/i,
];

// ─── State Machine ───

export class ConversationStateMachine {
  private state: ConversationState;

  constructor(opts?: { maxRetries?: number }) {
    this.state = {
      stage: "greeting",
      activeIntent: null,
      intentConfidence: 0,
      intentChangeCount: 0,
      slots: {},
      missingSlots: [],
      turnsSinceIntentSet: 0,
      confirmationPending: false,
      retryCount: 0,
      maxRetries: opts?.maxRetries ?? 3,
      lastToolCall: null,
      lastToolResult: null,
    };
  }

  /** Read-only snapshot of current state */
  get current(): Readonly<ConversationState> {
    return this.state;
  }

  // ─── Intent Management ───

  /**
   * Determine if we should run the classifier on this turn.
   *
   * Returns false when mid-flow to skip the ~200ms classification LLM call.
   * The only time we reclassify mid-flow is if the user explicitly redirects.
   */
  shouldClassify(utterance: string): boolean {
    // Always classify on first real utterance
    if (this.state.stage === "greeting" || this.state.stage === "intake") {
      return true;
    }

    // No active intent — must classify
    if (!this.state.activeIntent) {
      return true;
    }

    // Post-action: user might want something else
    if (this.state.stage === "post_action") {
      return true;
    }

    // Explicit redirect detected mid-flow
    if (this.detectRedirect(utterance)) {
      logger.info("redirect detected, reclassifying", {
        currentIntent: this.state.activeIntent,
        utterance: utterance.slice(0, 80),
      });
      return true;
    }

    // Mid-flow: skip classification
    return false;
  }

  /**
   * Set the active intent from classification result.
   * Tracks intent changes for escalation logic.
   */
  setIntent(intent: ActiveIntent, confidence: number): void {
    if (this.state.activeIntent && this.state.activeIntent !== intent) {
      this.state.intentChangeCount++;
      logger.info("intent changed", {
        from: this.state.activeIntent,
        to: intent,
        changeCount: this.state.intentChangeCount,
      });
      // Reset slots when intent changes
      this.state.slots = {};
    }

    this.state.activeIntent = intent;
    this.state.intentConfidence = confidence;
    this.state.turnsSinceIntentSet = 0;
    this.state.stage = "active_flow";
    this.state.retryCount = 0;
    this.state.confirmationPending = false;
    this.state.lastToolCall = null;
    this.state.lastToolResult = null;
  }

  // ─── Slot Management ───

  /**
   * Merge newly extracted slots with existing ones.
   * Only overwrites with non-null/undefined values.
   * Returns the list of still-missing required slots.
   */
  updateSlots(extracted: Record<string, unknown>): string[] {
    for (const [key, value] of Object.entries(extracted)) {
      if (value !== null && value !== undefined && value !== "") {
        this.state.slots[key] = value;
      }
    }
    this.state.turnsSinceIntentSet++;
    this.state.missingSlots = this.computeMissingSlots();
    return this.state.missingSlots;
  }

  /**
   * Check if we have a lookup identifier (reservation_id, or name+phone).
   * For modify/cancel flows, we need at least one way to find the reservation.
   */
  hasLookupIdentifier(): boolean {
    const { slots } = this.state;
    return !!(
      slots.reservation_id ||
      slots.confirmation_number ||
      (slots.customer_name && slots.customer_phone)
    );
  }

  /**
   * Are all required slots filled for the current intent?
   */
  isReadyForConfirmation(): boolean {
    return (
      this.state.missingSlots.length === 0 &&
      this.state.activeIntent !== null &&
      !this.state.confirmationPending
    );
  }

  /**
   * Mark that we're asking the user to confirm before executing.
   */
  requestConfirmation(): void {
    this.state.confirmationPending = true;
    this.state.stage = "confirmation";
  }

  /**
   * User confirmed — ready to execute tool.
   */
  confirmAction(): void {
    this.state.confirmationPending = false;
    this.state.stage = "executing";
  }

  // ─── Tool Execution ───

  recordToolCall(toolName: string, result: unknown): void {
    this.state.lastToolCall = toolName;
    this.state.lastToolResult = result;
    this.state.stage = "post_action";
  }

  // ─── Flow Control ───

  /**
   * Check if we should escalate to a human based on escalation rules.
   */
  shouldEscalate(): boolean {
    // Too many retries
    if (this.state.retryCount >= this.state.maxRetries) {
      logger.info("escalating: max retries reached", {
        retryCount: this.state.retryCount,
      });
      return true;
    }
    // Too many intent changes (confused caller)
    if (this.state.intentChangeCount >= 3) {
      logger.info("escalating: too many intent changes", {
        intentChangeCount: this.state.intentChangeCount,
      });
      return true;
    }
    return false;
  }

  /** Increment retry counter (agent couldn't understand, or extraction failed) */
  markRetry(): void {
    this.state.retryCount++;
  }

  /** Explicit stage transition */
  transitionTo(stage: ConversationStage): void {
    logger.debug("stage transition", {
      from: this.state.stage,
      to: stage,
    });
    this.state.stage = stage;
  }

  // ─── Serialization (for Redis persistence) ───

  serialize(): string {
    return JSON.stringify(this.state);
  }

  static deserialize(json: string, opts?: { maxRetries?: number }): ConversationStateMachine {
    const machine = new ConversationStateMachine(opts);
    machine.state = JSON.parse(json);
    return machine;
  }

  // ─── Private Helpers ───

  private detectRedirect(utterance: string): boolean {
    return REDIRECT_PATTERNS.some((p) => p.test(utterance));
  }

  private computeMissingSlots(): string[] {
    const intent = this.state.activeIntent;
    if (!intent) return [];

    const required = REQUIRED_SLOTS[intent] || [];
    return required.filter((slot) => {
      // Handle composite slot requirements
      if (slot === "reservation_id_or_lookup") {
        return !this.hasLookupIdentifier();
      }
      if (slot === "modification_details") {
        // At least one "new_*" field must be present
        return !Object.keys(this.state.slots).some((k) => k.startsWith("new_"));
      }
      return !this.state.slots[slot];
    });
  }
}
