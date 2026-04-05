# Rezovo AI Voice Receptionist

Monorepo scaffold for the realtime receptionist platform. The high-level architecture and runtime expectations live in `readme.MD`; this README tracks how the repo is organized as we implement it.

## Layout
- `apps/` — deployable runtimes (`realtime-core`, `platform-api`, `jobs`, `rtp-bridge`).
- `packages/` — shared libraries (`core-types`, `event-bus`, `logging`, `utils`).
- `infra/` — PBX, Kubernetes, and Terraform manifests (placeholders for now).

## Event contracts (phase 1)
- Canonical event types and payloads live in `packages/core-types/src/index.ts` (`CallStarted`, `CallEnded`, `UsageReported`, `ConfigChanged`, `DocIngestRequested`, `AppointmentUpdated`, `ToolUsed`, `VoicemailReferenceCreated`).
- `packages/event-bus` exposes a typed `EventBusClient`, `createEventEnvelope`, `createInMemoryEventBus`, and `createRedisEventBus` (Redis pub/sub for cross-process dev — set `EVENT_BUS_IMPL=redis` + `REDIS_ENABLED=true` + shared `REDIS_URL` on platform-api, realtime-core, and jobs). In-memory remains the default per process.
- `ConfigChanged` payload includes `lob` (line of business) and `status` (`draft` | `published`) so the UI and config-cache can scope and avoid stale swaps:
  ```ts
  type ConfigChangedPayload = {
    entity: "PhoneNumber" | "AgentConfig" | "Plan" | "Business";
    entity_id: string;
    version: number;
    lob?: string;
    status?: "draft" | "published";
  };
  ```

## Scripts
- Root scripts run workspaces with `--if-present` so missing package scripts don’t fail during early scaffolding.



## 1. Runtimes & languages

Three deployables. Period.

```text
Runtime #1: realtime-core   (latency-critical)
Runtime #2: platform-api    (config, tools, billing, KB, analytics)
Runtime #3: jobs            (offline/async work)
Event Bus: Kafka/Redpanda/NATS (at-least-once)
PBX: Asterisk/FreeSWITCH (infra, not your code)
```

**Languages**

* `realtime-core`:

  * Telephony + orchestration: TypeScript/Node is acceptable.
  * Media/RTP: **separate Go (or Rust) process in same pod**.
* `platform-api`: TypeScript/Node (HTTP, DB, SaaS connectors).
* `jobs`: TypeScript/Node (reusing platform modules).

---

## 2. Event bus semantics (no hand-waving)

You will absolutely need this nailed down.

* **Delivery**: at-least-once.
* **Partitioning**: by `tenant_id`.

  * Within a tenant, events are ordered.
* **Idempotency**:

  * Every consumer must treat events as idempotent:

    * Use natural keys (e.g., `call_id` for usage).
* **Retention**:

  * Minimum 7–30 days.
  * New consumers bootstrap by replaying from start of retention.

**Event envelope**

```ts
type EventEnvelope<T> = {
  event_id: string;        // UUID
  event_type: string;      // "CallStarted", ...
  tenant_id: string;
  call_id?: string;
  timestamp: string;       // ISO8601
  payload: T;
};
```

Core event types:

* `CallStarted`
* `CallEnded`
* `UsageReported` (if you separate usage from CallEnded)
* `ConfigChanged`
* `DocIngestRequested`
* `AppointmentUpdated`
* `ToolUsed` (optional v1)
* Possibly `VoicemailReferenceCreated` (if you later integrate VM metadata)

Realtime core is **the only writer of raw usage** (per call). Everything else materializes from events.

---

## 3. Runtime #1 – realtime-core

Latency-critical. Must not depend on DB or slow internal APIs in the hot path.

### 3.1 Process structure

**Pod composition:**

```text
[realtime-core pod]
  ├─ realtime-core-app (Node/TS)
  └─ rtp-bridge        (Go/Rust, separate process)
```

Communication:

* `realtime-core-app` ↔ `rtp-bridge` via:

  * UNIX domain socket or localhost gRPC.
  * Simple streaming API: “send/receive PCM frames for call_id X”.

### 3.2 Modules (inside realtime-core-app)

```text
realtime-core/
  ├─ telephony/       # ARI/ESL client, call routing, failover
  ├─ media/           # bridge wrapper around rtp-bridge
  ├─ orchestrator/    # LLM, tools, KB, state machine
  ├─ config-cache/    # in-memory business/agent/plan config
  ├─ billing-client/  # canStartCall()
  └─ events/          # publish CallStarted/CallEnded/UsageReported
```

---

### 3.3 config-cache (core invariant)

**No DB/API calls in hot path.** Everything is cached.

Cached structures:

```ts
type PhoneNumberConfig = {
  did: string;
  tenantId: string;
  businessId: string;
  routeType: "ai" | "queue" | "voicemail";
  agentConfigId?: string;
  queueExtension?: string;
};

type AgentConfigSnapshot = {
  id: string;
  version: number;
  tenantId: string;
  businessId: string;
  basePrompt: string;
  persona: "receptionist" | "scheduler" | "support";
  openingHours: OpeningHours;
  languagePrefs: string[];
  llmProfileId: string;
  toolAccess: string[];
  kbNamespace: string;
  maxCallDurationSec: number;
  escalationRules: EscalationRules;
};

type PlanSnapshot = {
  tenantId: string;
  planId: string;
  maxConcurrentCalls: number | null; // null = no hard limit
  // maybe rough monthly caps but enforced in platform
};
```

**Refresh strategy**

* On startup:

  * Call Platform API for full config snapshot.
* Then:

  * Subscribe to `ConfigChanged` events and update relevant entries.
  * Optionally periodic full-refresh (e.g., every 5–10 minutes) as safety.

If config missing for a DID → fallback to default route (voicemail/ext) or reject with a recorded message.

**LOB-aware caching**

* Cache keys include tenantId + DID (and lob where applicable).
* Refresh on `ConfigChanged` using lob + version to avoid stale swaps.
* If snapshot missing: route to voicemail/queue defaults; do not block hot path.

---

### 3.4 telephony/ module

**Responsibilities**

* Connect to PBX (ARI/ESL).
* Normalize events into internal `CallState`.
* For inbound call:

Flow:

1. PBX triggers app for DID.
2. telephony/ generates `call_id` (UUID).
3. Look up `PhoneNumberConfig` from `config-cache`.

   * If none: route to PBX voicemail / default extension.
4. If `routeType !== "ai"`:

   * Route to queue or voicemail directly.
   * Optionally emit `CallStarted`/`CallEnded` for analytics (even non-AI).
5. If `routeType === "ai"`:

   * Call BillingQuota API: `canStartCall(tenantId)` (see concurrency below).
   * With a hard timeout (e.g., 300ms).
   * If denied or timeout: route to voicemail/human.

If allowed:

6. Establish external media to `rtp-bridge`.
7. Notify `orchestrator/` to start `CallSession`.
8. Publish `CallStarted` event to bus.

**Failure & health**

* Keep a health channel from orchestrator/media:

  * If orchestrator signals “AI degraded” or rtp-bridge fails:

    * Attempt a single retry.
    * If still broken within N seconds → transfer to human or voicemail based on config.

---

### 3.5 media/ module (wrapper over rtp-bridge)

`rtp-bridge` (Go/Rust):

* Per call:

  * Accept connection from PBX external media.
  * Convert RTP → PCM, PCM → RTP.
  * Provide a bidirectional stream over gRPC/UNIX socket:

    * `ReceivePcm(call_id) → stream<PCMFrame>`
    * `SendPcm(call_id, stream<PCMFrame>)`.

Media module (TS):

* Maintains:

  * `call_id` → stream handles.
* For each call:

  * Forwards PCM frames to orchestrator.
  * Sends orchestrator’s PCM frames back to bridge.

**Keep this dumb:**

* v1: no complex VAD. Let Realtime LLM handle barge-in if using a provider that supports it.
* Optional: minimal amplitude-based VAD just to cut TTS when strong speech is detected — but don’t try to get clever.

---

### 3.6 orchestrator/ module

The conversational brain.

**Call session context**

```ts
type CallStage =
  | "greeting"
  | "intake"
  | "qualification"
  | "booking"
  | "handoff"
  | "message"
  | "closing";

type CallSessionContext = {
  callId: string;
  tenantId: string;
  businessId: string;
  phoneNumberConfig: PhoneNumberConfig;
  agentConfig: AgentConfigSnapshot;
  stage: CallStage;
  slots: {
    callerName?: string;
    callbackNumber?: string;
    reason?: string;
    desiredTime?: string; // ISO string or natural text
    // domain-specific slots later
  };
  transcript: Array<{
    from: "user" | "agent";
    text: string;
    timestamp: string;
  }>;
  kbContext?: string;         // summarized docs/snippets
  startedAt: Date;
};
```

**Realtime greeting and KB behavior**

* On call start:

  * Load `AgentConfigSnapshot` from cache.
  * Build static **business context** from config:

    * Name, address, core services, high-level rules.
  * Immediately send a **generic greeting** using either:

    * Realtime LLM system prompt (“Always start with: …”), or
    * One-shot TTS on static string while LLM boots.
* KB:

  * Fire off an async `kbPrefetch()`:

    * `POST platform-api/kb/retrieve` with a broad query (“business overview”) and context.
    * With timeout (e.g., 500–800ms).
  * If it returns:

    * Store summarized result in `session.kbContext`.
  * If it fails:

    * Fine. The call continues, just less informed.

KB is **nice-to-have**, not required for the greeting or core routing.

**Turn loop**

Assume you use a Realtime LLM (ideal) or STT+LLM+TTS pipeline.

For each user utterance:

1. Receive transcribed user text (from Realtime LLM callback or STT).

2. Append to `session.transcript`.

3. Update `stage` + `slots` via dialog manager:

   * Very light state machine:

     * `greeting` → `intake` once user speaks.
     * `intake` → `qualification` once you know reason.
     * `qualification` → `booking` or `handoff` or `message`.

4. Build prompt for model:

   * System:

     * Persona + business facts + rules (“no payment info”, escalate on uncertainty, etc.).
   * Context:

     * Stage + slots + optionally `kbContext`.
   * Tools schema (only the tools allowed for this agent).

5. LLM generates:

   * Either plain response, or
   * Tool call: `{"tool": "book_appointment", "args": {...}}`.

6. If tool call:

   * Generate `idempotency_key = hash(call_id + tool_name + stable_action_key)`.
   * Call Platform Toolbus:

     * `POST /tool/call` with key and args.
     * Timeout (e.g., 2s).
   * If successful:

     * Feed result back into LLM for final answer.
   * If timeout/fail:

     * Produce fallback answer: apologize + take message or transfer to human.

7. Response text → TTS / Realtime speech → PCM frames → media/ → PBX.

**Escalation rules**

* Trigger escalation when:

  * Stage suggests human is needed (e.g. complex support).
  * User explicitly asks for human.
  * Slot collection fails after N attempts.
  * Policy rules hit (e.g., medical red-flag phrases).

* Implementation:

  * Orchestrator calls telephony/ with `requestTransfer(call_id, destination)`:

    * Destination from config: queue extension, direct DID, etc.
  * Optionally send **screen-pop context** out-of-band via Platform (future).

**Usage reporting**

* For each call, orchestrator tracks:

  * LLM tokens in/out.
  * TTS/STT usage (seconds/chars).
  * Call duration (with telephony/).
* At call end:

  * Build `UsageReported` (or embed inside `CallEnded`).
  * Publish via events module to Event Bus.

---

### 3.7 Concurrency semantics

Pick a side; here’s the decision:

**v1: “Soft” concurrency limits** (best-effort), strict on monthly cost via alerts rather than hard cutoffs.

* `billingQuota.canStartCall(tenantId)`:

  * Reads **approximate** current concurrent calls and monthly usage.
  * Returns allow/deny + reason.
* Race conditions might allow slight overshoot on peak spikes; acceptable for early product.
* You can **later** add strict concurrency using Redis/DB atomic counters.

Document this explicitly:

* Quotas are **advisory**; platform overshoot is possible but monitored.

---

## 4. Runtime #2 – platform-api

All the “slow and complex” stuff: config, auth, billing+quota, tools, KB, analytics, webhooks.

### 4.1 Modules

```text
platform-api/
  ├─ http-api/         # Express/Fastify/Nest, whatever
  ├─ auth/
  ├─ config/
  ├─ billingQuota/
  ├─ toolbus/
  ├─ kb/
  ├─ analytics/
  ├─ webhooks/
  └─ events/
```

---

### 4.2 auth/

* Tenants & users:

  * `Tenant`, `User`, `UserTenantRole`.
* Auth:

  * JWT with `tenant_id`, `user_id`, `roles`.
* Middleware:

  * Every route checks tenant and role.

---

### 4.3 config/

UI support endpoints (keep declarative UI simple, backend enforces truth):

* `GET /config/schema?lob=...`
  * Returns JSON Schema (or similar) with fields/enums/conditionals/defaults and tool availability metadata for the given line of business.
* `GET /config/templates?lob=...`
  * Returns starter configs (id, name, version, config body, description) per LOB.
* `GET /config/snapshot?tenantId=...`
  * Returns full snapshot for realtime-core cache bootstrap; include ETag/version for cache control.
* `POST /config/validate`
  * Dry-run validation; returns normalized config + warnings/errors before save/publish.

Entities:

* `Business` (metadata, opening hours, contact).
* `AgentConfig` (with `version` field).
* `PhoneNumber` (DID → route).
* `Plan` (maps to BillingQuota).

CRUD routes for React app.

Whenever a config changes:

* Increment `version`.
* Persist to DB.
* Publish `ConfigChanged` event:

```ts
type ConfigChangedPayload = {
  entity: "PhoneNumber" | "AgentConfig" | "Plan" | "Business";
  entity_id: string;
  version: number;
  lob?: string;
  status?: "draft" | "published";
};
```

Versioning & validation rules:
* Configs carry `{ version, status: "draft" | "published" }`; publish increments `version`.
* Writes use optimistic locking (If-Match/version).
* Validate/save enforce plan/tool gating; block enabling tools without plan or credentials; return machine-readable errors to drive the UI.

Realtime core listens and updates its `config-cache`.

---

### 4.4 billingQuota/ (single source for money + limits)

**Responsibilities**

* Store plans and tenant subscriptions.
* Consume `CallEnded`/`UsageReported` events:

  * For each call:

    * Upsert `UsageRecord` keyed by `call_id`.
    * Update aggregates per tenant:

      * total LLM cost
      * total minutes
      * peak concurrent calls (approx)
* Provide API:

```ts
POST /billing-quota/can-start-call
  body: { tenantId: string }
  returns: { allowed: boolean; reason?: string }
```

Implementation (v1):

* Use aggregates from DB (or an in-memory cache) for:

  * estimated concurrent calls (last few minutes).
  * monthly usage vs plan.
* If you later need strict concurrency:

  * back a shared counter in Redis with atomic increments.

---

### 4.5 toolbus/

Responsibilities:

* Abstract connectors: Calendly, Google Calendar, HubSpot, SMS, email, etc.
* Expose a **single API**:

```http
POST /tool/call
{
  "tenantId": "...",
  "toolName": "book_appointment",
  "idempotencyKey": "hash",
  "args": { ... }
}
```

Internals:

* `idempotencyStore` table:

  * `(tenant_id, tool_name, idempotency_key)` → stored result (JSON) + status.
* On call:

  * Check store; if result exists → return it.
  * Else:

    * Execute connector.
    * Store result.
    * Return.

Publish `ToolUsed` event (optional v1, but good idea).

---

### 4.6 kb/

Two main flows: ingestion and retrieval.

**Ingestion**

* `POST /kb/docs`:

  * Upload file or URL.
  * Create `Document` row (raw text or location).
  * Publish `DocIngestRequested` event with `doc_id`, `tenant_id`, `namespace`.
* Jobs runtime picks it up (see later), generates chunks + embeddings.

**Retrieval**

* `POST /kb/retrieve`:

  * Input: `tenant_id`, `business_id`, `namespace`, `query`, `topK`.
  * Use vector store (pgvector/Qdrant) + optional BM25.
  * Return:

    * `passages[]` with text + metadata.
* Enforce tenant isolation at DB level.

---

### 4.7 webhooks/

* Inbound from SaaS:

  * Calendly: booking created/updated.
  * CRM: contact updated.
  * SMS: delivery status.

* Validate signature.

* Normalize to internal events:

  * `AppointmentUpdated`, `ContactUpdated`, etc.

* Publish to Event Bus.

* Update DB as needed for internal dashboards.

---

### 4.8 analytics/

* Event consumer:

  * Subscribes to `CallStarted`, `CallEnded`, `ToolUsed`, `AppointmentUpdated`.
  * Maintains aggregate tables:

    * Calls per day per business.
    * Booking rate per agent.
    * Average handle time.
    * Abandonment rate.

* HTTP routes for dashboards:

  * `GET /analytics/calls-summary?tenantId=...`
  * etc.

---

## 5. Runtime #3 – jobs

Async / offline work.

Modules:

* `kbReembedWorker.ts`

  * Consumes `DocIngestRequested`.
  * Fetches raw doc from DB/storage.
  * Chunks + embeds.
  * Writes to vector store.
* `billingReconciliation.ts`

  * Periodically compares internal aggregates to provider invoices (later).
* Any heavy backfills.

---

## 6. Call lifecycle (with failure behaviors explicit)

### 6.1 Inbound call → greeting

1. PSTN → SBC → PBX → your ARI/ESL app.

2. telephony/:

   * Create `call_id`.
   * Lookup DID in config-cache:

     * If missing ⇒ route to default voicemail / message and stop.
   * If routeType = `queue`/`voicemail`: route accordingly, emit events, done.
   * If routeType = `ai`:

     * Call `canStartCall(tenantId)` (timeout 300ms).
     * If denied/timeout ⇒ route to voicemail/human, maybe play “we can’t take your call via AI at the moment”.

3. If allowed AI:

   * Setup external media to rtp-bridge.
   * Inform orchestrator/ to create `CallSession`.
   * Publish `CallStarted`.

4. orchestrator/:

   * Load AgentConfig from cache.
   * Initialize `CallSessionContext`.
   * Fire async KB prefetch (non-blocking).
   * Start Realtime LLM session:

     * System prompt: persona + static business config + rules.
   * Begin greeting:

     * “Thanks for calling {Business}. How can I help you today?”

### 6.2 Mid-call: normal turns

* Audio → rtp-bridge → orchestrator (or Realtime API).

* orchestrator:

  * Update transcript, stage, slots.
  * Use cached `kbContext` if present.
  * Call LLM with tools enabled.

* If tool called:

  * Call Toolbus (`/tool/call`, 2s timeout).
  * On success → feed back into LLM → respond.
  * On timeout → degrade:

    * “I’m having trouble accessing the booking system; I’ll take a message and someone will call you back”.

* Response → TTS/Realtime → PCM → rtp-bridge → PBX.

**KB down?**
Fine. Call continues without KB; policy still enforced via static config and LLM.

### 6.3 Escalation

* When escalation condition met:

  * orchestrator calls telephony/ with `requestTransfer(call_id, target)`:

    * target resolved from config (queue/ext).
  * telephony:

    * PBX transfer to target.
  * Orchestrator:

    * Optional: speak a closing line before transfer.
    * Then stops sending audio, ends LLM session.

### 6.4 End of call

* Caller or PBX hangs up:

  * telephony/ receives HANGUP.
  * Notifies orchestrator and media to stop.
* orchestrator:

  * Finalize transcript.
  * Compute usage metrics.
  * Publish `CallEnded` (with summary + outcome) and/or `UsageReported`.
* BillingQuota & analytics consume events and update their state.

---

## 7. Voicemail (v1 stance)

To keep v1 sane:

* Voicemail is **PBX-native**.
* You:

  * Route to voicemail extensions from dialplan.
  * Optionally export CDRs and recording URLs to Platform later via scripts/integration.
* Your platform **does not** own voicemail storage/transcription in v1.

Later v2:

* Add Voicemail service + STT + notification if you want.

Write this down explicitly so you don’t half-implement VM logic in three places.

---

## 8. Observability / tracing standard

Non-negotiable if you don’t want to go insane debugging.

* `call_id` is the primary correlation ID.

* Every log line in realtime-core and platform-api includes:

  * `call_id` (if applicable)
  * `tenant_id`
  * `service` (realtime-core | platform-api | jobs)
  * `module` (telephony, media, orchestrator, toolbus, etc.)

* Every EventEnvelope includes:

  * `event_id`, `event_type`, `tenant_id`, `call_id?`, timestamp.
  * Include `lob` where applicable for cross-runtime correlation.

If you use OpenTelemetry:

* Start a root span on call accept in realtime-core.
* Propagate `trace_id` into events (optional v1, but easy win).

---

## 9. Reliability & security plan

Tasks below pick up from the current scaffold and carry us to a backend that’s safe for frontend integration and pilot testing. Each “batch” lists the exact files to touch and what changes they need.

### Batch F1 – Clerk authentication cutover
**Files:** `apps/platform-api/src/auth/jwt.ts`, `apps/platform-api/src/auth/store.ts`, `apps/platform-api/src/server.ts`
- Replace the `/auth/login` handler with Clerk token verification (add a `verifyClerkToken` helper).
- Stop reading `data/users.json`; map Clerk user IDs to tenant/roles (temporary lookup until Supabase migration lands).
- Keep the local login path behind a feature flag in dev/staging for rollback.

### Batch F2 – Supabase as source of truth
**Files:** `apps/platform-api/src/persistence/store.ts`, `apps/jobs/src/persistenceClient.ts`, `apps/platform-api/src/kb.ts`, `apps/platform-api/src/config/store.ts`, `apps/platform-api/src/analytics/store.ts`
- Create a Supabase client module with CRUD for tenants, phone_numbers, agent_configs, plans, kb_documents, kb_chunks, tool_results, usage_records, audit_logs.
- Dual-write JSON + Supabase until backfill is complete; then retire JSON writes.
- Provide SQL migrations and backfill scripts for existing data.

### Batch F3 – Redis for rate limits & live state
**Files:** `apps/platform-api/src/server.ts`, `apps/realtime-core/src/index.ts`, `apps/realtime-core/src/billingClient.ts`, `apps/realtime-core/src/telephony/callController.ts`
- Introduce a Redis client for rate-limit buckets (token bucket per tenant/IP) and replace `PersistenceStore.consumeRateLimit`.
- Store realtime-core concurrency counters in Redis, ensuring call admission reads/writes atomically.
- Define fail-open/closed policy per endpoint when Redis is unavailable.

### Batch F4 – Durable event bus (Kafka/Redpanda)
**Files:** `packages/event-bus/src/index.ts`, `packages/event-bus/src/` (new `kafkaClient.ts`), `apps/platform-api/src/index.ts`, `apps/realtime-core/src/index.ts`, `apps/jobs/src/index.ts`
- Define a `BusClient` interface and implement a managed Kafka/Redpanda client with publish/subscribe/checkpoint APIs.
- Run publishers/consumers in shadow mode alongside the in-memory bus, then flip to Kafka once idempotency is proven.
- Remove the in-memory bus when cutover is complete.

### Batch F5 – Telephony carrier integration
**Files:** `apps/realtime-core/src/telephony/pbxBridge.ts`, `infra/pbx/`, new scripts (e.g., `scripts/twilioProvision.ts`)
- Automate Twilio/Bandwidth number purchase, SIP trunk configuration, and webhook signature validation/retries.
- Store phone-number metadata in Supabase and surface per-tenant telephony costs.
- Define number lifecycle automation (attach → monitor → recycle).

### Batch F6 – Observability & SLOs
**Files:** `apps/platform-api/src/server.ts`, `apps/realtime-core/src/index.ts`, `apps/jobs/src/index.ts`, new docs `docs/SLOs.md`, Prometheus configs under `infra/k8s/`
- Expand `/health` to report Supabase, Redis, Kafka, and telephony status.
- Add `/metrics` (Prometheus) and OTEL tracing; instrument call setup, auth, KB ingest latency, and rate-limit hits.
- Document 3–4 SLOs with pager runbooks.

### Batch F7 – CI/CD & AWS deployment
**Files:** `.github/workflows/`, `infra/terraform/`, `infra/k8s/`
- Build Docker images for each runtime via CI.
- Deploy to AWS (ECS/EKS) with Secrets Manager/SSM for credentials, canary/blue-green rollout, and rollback scripts.
- Maintain a “what breaks when X is down” runbook so on-call knows whether to fail open or closed for each dependency.

---

## 9. Monorepo layout (matching this design)

Final compressed tree:

```text
voip-receptionist/
├─ package.json
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
├─ README.md
│
├─ apps/
│  ├─ realtime-core/
│  │  ├─ src/
│  │  │  ├─ index.ts             # boot telephony/media/orchestrator
│  │  │  ├─ telephony/
│  │  │  │  ├─ ariClient.ts
│  │  │  │  ├─ callRouter.ts
│  │  │  │  └─ failover.ts
│  │  │  ├─ media/
│  │  │  │  ├─ bridgeClient.ts   # speaks to rtp-bridge over gRPC/UNIX socket
│  │  │  ├─ orchestrator/
│  │  │  │  ├─ callSession.ts
│  │  │  │  ├─ dialogueManager.ts
│  │  │  │  ├─ promptBuilder.ts
│  │  │  │  ├─ llmClient.ts
│  │  │  │  ├─ kbClient.ts
│  │  │  │  ├─ toolClient.ts
│  │  │  │  └─ usageTracker.ts
│  │  │  ├─ config-cache/
│  │  │  │  ├─ cache.ts
│  │  │  │  └─ configEventSubscriber.ts
│  │  │  └─ events/
│  │  │     ├─ eventPublisher.ts
│  │  │     └─ types.ts
│  │  └─ Dockerfile
│  │
│  ├─ rtp-bridge/                # Go or Rust project
│  │  ├─ main.go (or main.rs)
│  │  └─ Dockerfile
│  │
│  ├─ platform-api/
│  │  ├─ src/
│  │  │  ├─ index.ts
│  │  │  ├─ auth/
│  │  │  ├─ config/
│  │  │  ├─ billingQuota/
│  │  │  ├─ toolbus/
│  │  │  ├─ kb/
│  │  │  ├─ analytics/
│  │  │  ├─ webhooks/
│  │  │  └─ events/
│  │  └─ Dockerfile
│  │
│  └─ jobs/
│     ├─ src/
│     │  ├─ index.ts
│     │  ├─ kbReembedWorker.ts
│     │  └─ billingReconciliation.ts
│     └─ Dockerfile
│
├─ packages/
│  ├─ core-types/
│  │  ├─ callTypes.ts
│  │  ├─ agentTypes.ts
│  │  ├─ configTypes.ts
│  │  └─ eventTypes.ts
│  ├─ event-bus/
│  │  ├─ busClient.ts
│  ├─ logging/
│  │  └─ logger.ts
│  └─ utils/
│
└─ infra/
   ├─ pbx/
   │  ├─ asterisk/...
   │  └─ freeswitch/...
   ├─ k8s/
   └─ terraform/
```


Understood. Here is the **complete, end-to-end voice ingestion delivery plan** in one place, structured as sequential phases with explicit tasks, files, commands, and checkpoints. This is the authoritative roadmap from our current state to a fully testable, production-ready voice pipeline.

---

# Voice Ingestion Delivery Plan

## Phase V1 – Telephony Data & Secrets

1. **Supabase schema**
   - File: `supabase/migrations/002_voice.sql`
     ```sql
     create table public.voice_numbers (
       id uuid default gen_random_uuid() primary key,
       tenant_id text not null,
       phone_number text not null unique,
       phone_sid text not null unique,
       sip_domain text not null,
       sip_username text not null,
       sip_password text not null,
       webhook_token text not null,
       status text check (status in ('provisioned','active','suspended','released')) default 'provisioned',
       created_at timestamptz default now()
     );
     create table public.carrier_events (
       id uuid default gen_random_uuid() primary key,
       tenant_id text not null,
       call_sid text not null,
       direction text,
       event_type text,
       payload jsonb not null,
       received_at timestamptz default now()
     );
     ```
   - Apply via `supabase db push`.

2. **Backend persistence layer**
   - New file `apps/platform-api/src/persistence/voiceStore.ts` with:
     - `async upsertVoiceNumber(record)`
     - `async getVoiceNumberByPhone(phone: string)`
     - `async logCarrierEvent(event)`

3. **Environment variables (set in k8s Secret / .env)**
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_API_KEY`, `TWILIO_API_SECRET` (if using SIP auth)
   - `TWILIO_DEFAULT_AREA_CODE`
   - `TWILIO_VOICE_WEBHOOK_URL`
   - `TWILIO_STATUS_WEBHOOK_URL`
   - `TWILIO_SIP_APP_SID`
   - `TWILIO_CALL_STATUS_CALLBACK_URL`
   - `RTP_BRIDGE_URL`, `RTP_BRIDGE_AUTH_TOKEN`

4. **Docs**
   - `docs/runbooks/telephony-provisioning.md`: includes Twilio console steps, regulatory requirements, porting, cost controls, secrets rotation.

## Phase V2 – Provisioning Automation

1. **Dependencies**
   - `pnpm add twilio` (in backend root).
   - Supabase REST already set up; reuse `supabaseClient.ts`.

2. **Implement `scripts/twilioProvision.ts`**
   - Input: `tenantId`, optional `areaCode`, optional `friendlyName`.
   - Steps:
     ```ts
     const twilio = require("twilio")(accountSid, authToken);
     const number = await twilio.incomingPhoneNumbers.create({ areaCode, voiceUrl, statusCallback: statusUrl });
     const domain = await twilio.sip.domains.create({ friendlyName: `rezovo-${tenantId}`, voiceUrl: rtpBridgeUrl });
     const credentialList = await twilio.sip.credentialLists.create({ friendlyName: `rezovo-${tenantId}` });
     await twilio.sip.credentialLists(credentialList.sid).credentials.create({ username, password });
     await supabase.from("voice_numbers").upsert({
       tenant_id: tenantId,
       phone_number: number.phoneNumber,
       phone_sid: number.sid,
       sip_domain: domain.domainName,
       sip_username: username,
       sip_password: password,
       webhook_token: crypto.randomUUID(),
       status: "provisioned"
     });
     ```
   - CLI usage:
     ```
     pnpm ts-node scripts/twilioProvision.ts \
       --tenant-id tenant-default \
       --area-code 415 \
       --voice-url https://api.dev.rezovo.com/twilio/voice
     ```

3. **Release script** `scripts/twilioRelease.ts`:
   - Deletes number via Twilio API.
   - Updates `voice_numbers.status = 'released'`.

4. **Audit**
   - Add `supabase` trigger or background job to notify if numbers stay in `provisioned` >24h.

## Phase V3 – Carrier Webhooks & PBX Bridge

1. **Platform API routes**
   - New file `apps/platform-api/src/routes/twilio.ts`.
   - Routes:
     - `POST /twilio/voice`:
       - Use `twilio.webhook({ validate: true })`.
       - Lookup `voice_numbers` by `req.body.To`.
       - Log event via `voiceStore.logCarrierEvent`.
       - Respond with TwiML:
         ```js
         const response = new twilio.twiml.VoiceResponse();
         const dial = response.dial({ callerId: req.body.To });
         dial.sip(`sip:${callSid}@${record.sip_domain}`);
         reply.type("text/xml").send(response.toString());
         ```
       - Also emit `BusClient.publish('IncomingCallRequested', { tenantId, callSid, from, to })`.
     - `POST /twilio/status`:
       - Validate signature.
       - Update `carrier_events`.
       - If `CallStatus` is `completed` or `failed`, publish `CallStatusUpdated` event.

2. **PBX bridge enhancement (realtime-core)**
   - `apps/realtime-core/src/telephony/pbxBridge.ts`:
     - `async handleIncomingCall({ callSid, tenantId, from, to })`:
       - Generate `callId = uuid`.
       - Store mapping `callSid -> callId` (Redis or in-memory).
       - Call `callController.handleInboundCall({ callSid, did: to, tenantId, callerNumber: from })`.
     - `async handleStatusUpdate({ callSid, status })`: call `CallController.endCall(callId, status)`.

3. **Security**
   - `TWILIO_WEBHOOK_AUTH` or per-tenant `webhook_token` stored in Supabase. Validate before processing.

## Phase V4 – rTP Bridge & Media Path

1. **rTP bridge service**
   - Implement `apps/rtp-bridge` (Go or Rust):
     - Accept inbound SIP from Twilio (use `pion/webrtc` or `sofia-sip`).
     - Convert RTP → PCM frames; send/receive via gRPC to realtime-core:
       ```proto
       service MediaBridge {
         rpc StartCall(stream AudioPacket) returns (stream AudioPacket);
       }
       message AudioPacket { string call_id; bytes payload; }
       ```
     - Health endpoints: `/healthz`, `/metrics`.

2. **Deployment**
   - Dockerfile + `pnpm run build:rtp-bridge`.
   - K8s manifest `infra/k8s/rtp-bridge-deployment.yaml` with UDP ports exposed via Service/LoadBalancer.

3. **Realtime-core media client**
   - `apps/realtime-core/src/media/rtpBridgeClient.ts`:
     - `connect(callId)` → start gRPC stream.
     - On inbound frames: feed into STT.
     - To send audio: call ElevenLabs TTS, push PCM frames to rTP bridge.

4. **STT and TTS integration**
   - Add `apps/realtime-core/src/media/sttClient.ts` (wrapper around vendor).
   - Update `CallSession` to consume STT transcripts (`await stt.transcribe(frame)`).
   - TTS: already using ElevenLabs; wrap in stream-friendly interface.

5. **Error handling**
   - If rTP bridge disconnects, instruct Twilio to `<Redirect>` to voicemail fallback (configured per tenant in `voice_numbers`).
   - Metrics tracking: `rtp_active_calls`, `rtp_errors_total`.

## Phase V5 – End-to-End Validation

1. **Staging environment**
   - Provision Twilio number pointing to staging domain.
   - Deploy backend via Terraform + k8s.
   - Ensure Secrets Manager contains Twilio/Supabase/Clerk/Redis/Kafka creds.

2. **Automated test script**
   - `scripts/testVoiceCall.ts`:
     ```ts
     const call = await twilio.calls.create({
       to: stagingNumber,
       from: verifiedTestNumber,
       url: "https://s3.amazonaws.com/twilio-test/prompts/hello.xml",
       statusCallback: process.env.TEST_STATUS_WEBHOOK
     });
     await waitUntil(call completes);
     fetch `/analytics/calls?tenantId=...` and assert increment.
     fetch Supabase `carrier_events` for callSid.
     check `/metrics` for call_success_total increment.
     ```
   - Run nightly in CI (GitHub Actions job `voice-e2e` with Twilio test credentials).

3. **Manual QA checklist**
   - Dial live number, confirm:
     - Twilio console shows active call.
     - real customer voice flows to LLM (listen to TTS response).
     - Tools (e.g., `book_appointment`) are invoked.
     - `CallEnded` event contains `callDurationSec`, `endReason`.
     - Supabase tables have entries for call, carrier events, analytics.

4. **Pilot readiness doc (`docs/pilot-readiness/voice.md`)**
   - Include logs, metrics screenshots, Twilio billing snapshot.
   - Sign-off criteria: `>=95% call success over 100 test calls`, `rTP bridge CPU < 70%`, `Twilio cost per call within target`.

## Phase V6 – Production Rollout

1. **Scaling**
   - Configure Twilio Voice Geo permissions per region.
   - Auto-scale rTP bridge deployments (HPA based on CPU/network).
   - Ensure Kafka/Redis capacity sized for call volume.

2. **Monitoring**
   - Grafana dashboard: Twilio call volume, call setup latency, LLM latency, STT/TTS errors.
   - Alert rules (Prometheus + PagerDuty):
     - `CallSetupSuccessRate < 0.95 for 5m` → page on-call.
     - `rTP Bridge Unhealthy` → page.
     - `Twilio billing spike >X% in 1h` → notify finance.

3. **Disaster recovery**
   - Document fallback to Twilio `<Queue>` or human handoff.
   - Backups of Supabase data; Twilio call logs exported daily.
   - Tabletop exercise: simulate Twilio outage → ensure `failClosed` logic routes to voicemail/human.
