-- ═══════════════════════════════════════════════════════════════
-- Rezovo — PostgreSQL + pgvector Schema
-- Compatible with: local Postgres 15 + pgvector, AWS Aurora PostgreSQL
-- Run this once on fresh DB. Idempotent (safe to re-run).
-- ═══════════════════════════════════════════════════════════════

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- ═══════════════════════════════════════════════════════════════
-- 1. TENANTS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tenants (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  business_id   TEXT,
  business_name TEXT,
  email         TEXT,
  phone         TEXT,
  plan_id       TEXT,
  timezone      TEXT DEFAULT 'America/New_York',
  settings      JSONB DEFAULT '{}'::JSONB,
  metadata      JSONB DEFAULT '{}'::JSONB,
  status        TEXT CHECK (status IN ('active','suspended','cancelled')) DEFAULT 'active',
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON public.tenants(status);

-- ═══════════════════════════════════════════════════════════════
-- 2. AGENT CONFIGURATIONS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.agent_configs (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES public.tenants(id),
  config_id   TEXT NOT NULL,
  business_id TEXT NOT NULL,
  lob         TEXT NOT NULL DEFAULT 'default',
  version     INT NOT NULL DEFAULT 1,
  status      TEXT CHECK (status IN ('draft','published')) DEFAULT 'draft',
  config      JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, config_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_tenant ON public.agent_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_agent_configs_status ON public.agent_configs(status);

-- ═══════════════════════════════════════════════════════════════
-- 3. PHONE NUMBERS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.phone_numbers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES public.tenants(id),
  phone_number    TEXT NOT NULL UNIQUE,
  display_name    TEXT,
  twilio_sid      TEXT UNIQUE,
  agent_config_id TEXT,
  route_type      TEXT NOT NULL DEFAULT 'ai'
                    CHECK (route_type IN ('ai', 'human', 'voicemail')),
  lob             TEXT NOT NULL DEFAULT 'default',
  status          TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'suspended')),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_phone_numbers_tenant ON public.phone_numbers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_phone_numbers_status ON public.phone_numbers(status);

-- ═══════════════════════════════════════════════════════════════
-- 4. PLANS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.plans (
  id                       UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES public.tenants(id),
  plan_id                  TEXT NOT NULL,
  concurrent_calls_limit   INT NOT NULL DEFAULT 10,
  monthly_minutes_included INT NOT NULL DEFAULT 1000,
  cost_per_minute          NUMERIC(10,4) NOT NULL DEFAULT 0.05,
  features                 JSONB NOT NULL DEFAULT '{}'::JSONB,
  status                   TEXT CHECK (status IN ('active','cancelled')) DEFAULT 'active',
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, plan_id)
);

CREATE INDEX IF NOT EXISTS idx_plans_tenant ON public.plans(tenant_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. KNOWLEDGE BASE — DOCUMENTS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.kb_documents (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES public.tenants(id),
  business_id     TEXT NOT NULL,
  namespace       TEXT NOT NULL,
  doc_id          TEXT NOT NULL UNIQUE,
  text            TEXT NOT NULL,
  metadata        JSONB DEFAULT '{}'::JSONB,
  ingested_at     TIMESTAMPTZ NOT NULL,
  embedded_chunks INT DEFAULT 0,
  status          TEXT CHECK (status IN ('ingest_requested','processing','embedded','failed'))
                    DEFAULT 'ingest_requested',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_docs_tenant    ON public.kb_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_kb_docs_namespace ON public.kb_documents(namespace);
CREATE INDEX IF NOT EXISTS idx_kb_docs_status    ON public.kb_documents(status);

-- ═══════════════════════════════════════════════════════════════
-- 6. KNOWLEDGE BASE — CHUNKS + VECTORS
--    text-embedding-3-small produces 1536-dim vectors
--    HNSW index for fast approximate nearest neighbor
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.kb_chunks (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  doc_id      TEXT NOT NULL REFERENCES public.kb_documents(doc_id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,
  namespace   TEXT NOT NULL,
  chunk_index INT NOT NULL,
  text        TEXT NOT NULL,
  embedding   vector(1536),
  metadata    JSONB DEFAULT '{}'::JSONB,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(doc_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_doc       ON public.kb_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_kb_chunks_tenant_ns ON public.kb_chunks(tenant_id, namespace);

-- HNSW index for cosine similarity — fast approximate nearest neighbor
-- m=16, ef_construction=64 balances build speed vs recall; fine for <1M vectors
CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding ON public.kb_chunks
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- ═══════════════════════════════════════════════════════════════
-- 7. match_kb_chunks — Vector similarity search function
--    Called by the RAG pipeline to find relevant passages
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.match_kb_chunks(
  query_embedding vector(1536),
  match_tenant_id TEXT,
  match_namespace TEXT,
  match_count INT DEFAULT 5,
  match_threshold FLOAT DEFAULT 0.5
)
RETURNS TABLE (
  id          UUID,
  doc_id      TEXT,
  chunk_index INT,
  text        TEXT,
  metadata    JSONB,
  similarity  FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    kc.id,
    kc.doc_id,
    kc.chunk_index,
    kc.text,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.kb_chunks kc
  WHERE kc.tenant_id = match_tenant_id
    AND kc.namespace = match_namespace
    AND kc.embedding IS NOT NULL
    AND 1 - (kc.embedding <=> query_embedding) > match_threshold
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 8. CALLS — single source of truth for every call
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.calls (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  call_id           TEXT NOT NULL UNIQUE,
  tenant_id         TEXT NOT NULL REFERENCES public.tenants(id),

  -- Routing
  phone_number      TEXT NOT NULL,
  caller_number     TEXT NOT NULL,
  twilio_call_sid   TEXT UNIQUE,
  direction         TEXT NOT NULL DEFAULT 'inbound'
                      CHECK (direction IN ('inbound', 'outbound')),

  -- Classification & Intent
  classified_intent TEXT,
  intent_confidence REAL,
  final_intent      TEXT,

  -- Agent
  agent_config_id   TEXT,
  agent_config_ver  INT,

  -- Lifecycle
  status            TEXT NOT NULL DEFAULT 'initiated'
                      CHECK (status IN (
                        'initiated', 'ringing', 'in_progress',
                        'completed', 'failed', 'abandoned', 'transferred'
                      )),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at       TIMESTAMPTZ,
  ended_at          TIMESTAMPTZ,
  duration_sec      INT,
  end_reason        TEXT
                      CHECK (end_reason IS NULL OR end_reason IN (
                        'caller_hangup', 'agent_end', 'transfer',
                        'error', 'timeout', 'quota_denied'
                      )),
  outcome           TEXT
                      CHECK (outcome IS NULL OR outcome IN (
                        'handled', 'abandoned', 'transferred', 'failed'
                      )),

  -- Collected data
  slots_collected   JSONB DEFAULT '{}'::JSONB,
  summary           TEXT,

  -- Usage / cost tracking
  turn_count        INT DEFAULT 0,
  llm_tokens_in     INT DEFAULT 0,
  llm_tokens_out    INT DEFAULT 0,
  tts_chars         INT DEFAULT 0,
  stt_seconds       REAL DEFAULT 0,

  created_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calls_tenant         ON public.calls(tenant_id);
CREATE INDEX IF NOT EXISTS idx_calls_call_id        ON public.calls(call_id);
CREATE INDEX IF NOT EXISTS idx_calls_twilio         ON public.calls(twilio_call_sid);
CREATE INDEX IF NOT EXISTS idx_calls_started        ON public.calls(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_tenant_started ON public.calls(tenant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_status         ON public.calls(status);

-- ═══════════════════════════════════════════════════════════════
-- 9. CALL TRANSCRIPT — per-utterance with timestamps
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.call_transcript (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  call_id     TEXT NOT NULL REFERENCES public.calls(call_id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,
  sequence    INT NOT NULL,
  speaker     TEXT NOT NULL CHECK (speaker IN ('user', 'agent')),
  text        TEXT NOT NULL,
  confidence  REAL,
  spoken_at   TIMESTAMPTZ NOT NULL,
  duration_ms INT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(call_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_transcript_call   ON public.call_transcript(call_id);
CREATE INDEX IF NOT EXISTS idx_transcript_tenant ON public.call_transcript(tenant_id);

-- ═══════════════════════════════════════════════════════════════
-- 10. CALL EVENTS — structured per-call event log
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.call_events (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  call_id     TEXT NOT NULL REFERENCES public.calls(call_id) ON DELETE CASCADE,
  tenant_id   TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::JSONB,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_events_call   ON public.call_events(call_id);
CREATE INDEX IF NOT EXISTS idx_call_events_tenant ON public.call_events(tenant_id);

-- ═══════════════════════════════════════════════════════════════
-- 11. TOOL RESULTS (idempotency)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.tool_results (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES public.tenants(id),
  tool_name       TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  result          JSONB NOT NULL,
  stored_at       TIMESTAMPTZ DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  UNIQUE(tenant_id, tool_name, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tool_results_tenant  ON public.tool_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tool_results_expires ON public.tool_results(expires_at)
  WHERE expires_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 12. CREDENTIALS
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.credentials (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES public.tenants(id),
  provider    TEXT NOT NULL,
  credentials JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_credentials_tenant ON public.credentials(tenant_id);

-- ═══════════════════════════════════════════════════════════════
-- 13. USAGE RECORDS (billing)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.usage_records (
  id               UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id        TEXT NOT NULL REFERENCES public.tenants(id),
  call_id          TEXT NOT NULL UNIQUE,
  phone_number     TEXT NOT NULL,
  duration_seconds INT NOT NULL,
  ai_enabled       BOOLEAN DEFAULT true,
  cost             NUMERIC(10,4),
  recorded_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_usage_tenant   ON public.usage_records(tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_recorded ON public.usage_records(recorded_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 14. SEED DATA (for local dev / testing)
-- ═══════════════════════════════════════════════════════════════

-- Test tenant
INSERT INTO public.tenants (id, name, business_id, business_name, email, timezone, status)
VALUES ('test-tenant', 'Test Business', 'test-business', 'Test Business', 'test@example.com', 'America/New_York', 'active')
ON CONFLICT (id) DO UPDATE SET
  business_name = 'Test Business',
  timezone      = 'America/New_York';

-- Test phone number (CHANGE to your actual Twilio values)
INSERT INTO public.phone_numbers (
  tenant_id, phone_number, twilio_sid, route_type, status
) VALUES (
  'test-tenant',
  '+18737101393',
  'PNbdbce2ba55feb4f6f716dbe563f90fc8',
  'ai',
  'active'
) ON CONFLICT (phone_number) DO UPDATE SET
  route_type = 'ai',
  status     = 'active';
