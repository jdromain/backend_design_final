/**
 * config-cache/types.ts
 * 
 * Type definitions for agent configuration snapshots.
 * These are loaded from platform-api and cached for the duration of a call.
 */

/**
 * Agent configuration snapshot
 * Loaded from platform-api and cached for performance
 */
export interface AgentConfigSnapshot {
  // Identity
  agentId: string;
  tenantId: string;
  businessId: string;
  
  // Business details
  businessName?: string;
  businessDescription?: string;
  
  // LLM configuration
  llmProfileId?: string;        // e.g., "gpt-4o", "gpt-4o-mini"
  temperature?: number;
  maxTokens?: number;
  
  // Knowledge base
  kbNamespace?: string;
  kbEnabled?: boolean;
  
  // Prompts and instructions
  systemPrompt?: string;
  greetingMessage?: string;
  
  // Features
  toolsEnabled?: boolean;
  guardrailsEnabled?: boolean;
  transferEnabled?: boolean;
  
  // Metadata
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Phone number configuration
 * Associated with a specific Twilio phone number
 */
export interface PhoneNumberConfig {
  phoneNumberId: string;
  did: string;                   // E.164 format phone number
  tenantId: string;
  agentId?: string;
  routeType?: "ai" | "voicemail" | "forward";
  forwardTo?: string;
  
  // Transfer settings
  transferSettings?: {
    transferEnabled: boolean;
    transferNumber?: string;
    transferMessage?: string;
    transferType?: "warm" | "cold";
    businessHours?: {
      open: string;
      close: string;
      timezone: string;
      daysOfWeek: number[];
    };
  };
  
  // Organization info
  organizationInfo?: {
    businessName?: string;
    landlineNumber?: string;
    location?: {
      address?: string;
      city?: string;
      state?: string;
    };
    cuisineType?: string;
  };
}
