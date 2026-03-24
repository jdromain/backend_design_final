# Orchestrator Refactor Plan — Production-Ready Agent Pipeline

**Created:** 2026-02-16  
**Scope:** `apps/realtime-core/src/orchestrator/`  
**Goal:** Human-level phone agent operations via STT → LLM (OpenAI Agents SDK) → TTS pipeline  
**Integration Target:** OpenTable API for booking operations

---

## Architecture: STT → Text LLM → TTS Pipeline

We are **NOT** using OpenAI's Realtime voice API. Our pipeline is:

```
Caller Audio → Deepgram STT → Text → OpenAI Agents SDK (text) → Text → ElevenLabs TTS → Audio → Caller
```

All optimizations target latency reduction within this pipeline (caching, fewer LLM round-trips, parallel execution, sentence-level TTS streaming).

---

## Current State: Critical Issues

| # | Issue | Impact |
|---|-------|--------|
| 1 | Re-classifies intent on **every turn** | User says "John Smith" mid-booking → reclassified as new intent |
| 2 | Extracted data (date, time, party_size) is **logged then discarded** | Agents can't remember what was collected |
| 3 | Zero multi-tenancy — all agents have hardcoded generic prompts | Every business gets identical personality |
| 4 | No tool calls — agents can't actually book, cancel, or look anything up | Pure dialogue with no action capability |
| 5 | KB never injected into prompts despite `kbNamespace` config existing | "What are your hours?" → agent guesses |
| 6 | ~460 lines of copy-paste handler duplication (12 methods doing same thing) | Unmaintainable |
| 7 | Fake streaming (full response split by regex, not token streaming) | Zero latency benefit |
| 8 | Guardrails are naive regex ("die" blocks "the battery died") | False positives, no real safety |
| 9 | `shouldTransfer()` / `shouldEnd()` parse English text for side effects | Fragile, locale-dependent |
| 10 | In-memory state (guardrail counters, idempotency) lost on restart | No durability |
| 11 | `dateTimeNormalizerAgent` defined but never used | Dead code |
| 12 | `OpenAI` client created but never used | Dead code |
| 13 | Greeting hardcoded, ignores `agentConfig` | Tenant customization broken |
| 14 | No retry/timeout on LLM calls | Single failure kills turn |
| 15 | No concurrency guard on `receiveUser()` | History corruption possible |
| 16 | LLM token usage never tracked (`addLlmTokens()` never called) | Billing blind |
| 17 | `IdempotencyManager.clearCall()` checks `startsWith(callId)` on SHA-256 hashes | Always no-op |

---

## New Architecture

### File Structure

```
orchestrator/
├── callSession.ts              # Updated — uses state machine, structured responses
├── usageTracker.ts             # Updated — actually tracks LLM tokens
├── stateMachine.ts             # NEW — conversation state, slots, stage tracking
├── openai-agents/
│   ├── index.ts                # REWRITTEN — unified workflow (~180 lines, was ~460)
│   ├── agentFactory.ts         # NEW — builds agents per-call with tenant context
│   ├── schemas.ts              # NEW — all Zod schemas consolidated
│   ├── tools.ts                # NEW — OpenTable tool definitions for agents
│   ├── redisKeys.ts            # NEW — Redis key schema
│   ├── sessionStore.ts         # NEW — Redis-backed session persistence
│   ├── guardrails.ts           # UPGRADED — OpenAI moderation API
│   ├── types.ts                # UPDATED — structured WorkflowResult
│   ├── agents.ts               # DELETED — replaced by agentFactory
│   └── idempotency.ts          # DELETED — replaced by Redis-backed version in sessionStore
```

### Core Concepts

#### 1. State Machine (eliminates re-classification)
- Tracks: `stage`, `activeIntent`, `collectedSlots`, `missingSlots`, `retryCount`
- Only reclassifies on: first turn, no active intent, or explicit user redirect
- Mid-booking turns skip classification entirely (saves ~200ms per turn)

#### 2. Agent Factory (enables multi-tenancy)
- Creates agents **per-call** from `AgentConfigSnapshot`
- Injects: business name, system prompt, KB context, collected slots, tool definitions
- No more module-level singleton agents

#### 3. Structured Action Responses (kills string matching)
- Agents return: `{ action: "speak" | "transfer" | "end" | "execute_tool", text, toolCall? }`
- No more scanning English for "connect you with someone"

#### 4. OpenTable Tool Integration
- Agent tools: `search_availability`, `create_reservation`, `modify_reservation`, `cancel_reservation`, `get_reservation_details`
- Each tool defined as an OpenAI Agents SDK function with proper JSON schema
- Executed via platform-api toolbus with idempotency

#### 5. Redis-Powered Caching
- Session state persisted (survives restarts)
- KB prefetch cached per-call
- Tool idempotency via Redis
- Guardrail warn counts durable

---

## Redis Key Architecture

| Key Pattern | Data | TTL | Purpose |
|-------------|------|-----|---------|
| `call:{callId}:state` | JSON ConversationState | 2h | Survive restarts |
| `call:{callId}:history` | JSON AgentInputItem[] | 2h | Conversation continuity |
| `call:{callId}:kb_context` | String (KB passages) | 30m | Prefetched once, reused all turns |
| `idem:{hash}` | JSON tool result | 1h | Prevent duplicate bookings |
| `guard:warn:{callId}` | Number | 2h | Harassment counter |
| `rate:calls:{tenantId}` | SET of callIds | 2h | Concurrent call tracking |
| `config:agent:{agentId}` | JSON AgentConfigSnapshot | 5m | L2 config cache |

---

## OpenTable Integration — Tool Definitions

All booking operations are defined as agent functions callable by the dialogue agent:

| Tool | Description | Required Args |
|------|-------------|---------------|
| `search_availability` | Search for available time slots | `date`, `party_size`, `restaurant_id?` |
| `create_reservation` | Book a table | `date`, `time`, `party_size`, `customer_name`, `customer_phone`, `customer_email?` |
| `modify_reservation` | Change existing booking | `reservation_id`, + fields to change |
| `cancel_reservation` | Cancel booking | `reservation_id`, `cancellation_confirmed` |
| `get_reservation_details` | Look up a reservation | `reservation_id` OR `customer_phone` + `customer_name` |
| `send_confirmation_sms` | Send booking confirmation | `phone_number`, `message` |

---

## Implementation Phases

### Phase 1 — Foundation (This Sprint)
- [x] Write this plan document
- [ ] `schemas.ts` — Consolidated Zod schemas with OpenTable-ready structures
- [ ] `stateMachine.ts` — ConversationStateMachine
- [ ] `redisKeys.ts` — Redis key architecture
- [ ] `sessionStore.ts` — Redis session persistence
- [ ] `tools.ts` — OpenTable tool definitions
- [ ] `agentFactory.ts` — Per-call agent builder
- [ ] `types.ts` — Updated with structured WorkflowResult
- [ ] `index.ts` — Rewritten unified workflow
- [ ] `callSession.ts` — Updated to use state machine
- [ ] `guardrails.ts` — Upgraded with OpenAI moderation
- [ ] Delete dead code (`agents.ts` old version, `idempotency.ts` old version)

### Phase 2 — Redis RAG (Next Sprint)
- [ ] `RedisVectorStore` with RediSearch FT.SEARCH
- [ ] Real OpenAI embeddings (text-embedding-3-small)
- [ ] Sentence-aware chunking with overlap
- [ ] Embedding cache in Redis
- [ ] Semantic query cache
- [ ] KB prefetch on call start

### Phase 3 — Pipeline Optimization
- [ ] LLM text token streaming to TTS sentence buffer
- [ ] Parallel extraction + dialogue where safe
- [ ] AbortSignal threading from callController to LLM
- [ ] LLM retry with exponential backoff
- [ ] Per-session concurrency mutex

### Phase 4 — Observability & Testing
- [ ] LLM token usage tracking from API responses
- [ ] Redis rate limiting (concurrent calls, LLM calls/min)
- [ ] Integration tests with mock Redis + mock OpenAI
- [ ] Load testing with simulated concurrent calls

---

## Output Schema Contract

Every agent dialogue response MUST conform to:

```typescript
{
  action: "speak" | "transfer" | "end" | "execute_tool",
  text: string,           // Always present — what to say to caller
  toolCall?: {
    name: string,         // Tool function name
    args: Record<string, unknown>
  }
}
```

The workflow returns `WorkflowResult`:

```typescript
{
  action: "speak" | "transfer" | "end",
  text: string,
  intent?: string,
  confidence?: number,
  extracted?: Record<string, unknown>,  // Accumulated slots
  toolResult?: unknown                  // If tool was executed
}
```

This eliminates all string-matching for transfer/end detection.
