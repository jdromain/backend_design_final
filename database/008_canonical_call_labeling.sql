-- ================================================================
-- 008_canonical_call_labeling.sql
-- Canonical labeling metadata for terminal status, intent provenance,
-- and deterministic confidence-banding.
-- ================================================================

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS terminal_status_source TEXT,
  ADD COLUMN IF NOT EXISTS intent_source TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS intent_confidence_band TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS label_version INT DEFAULT 1;

-- Backfill first (safe for existing data)
UPDATE public.calls
SET terminal_status_source = 'unknown'
WHERE terminal_status_source IS NULL
   OR terminal_status_source NOT IN ('realtime','carrier','system','unknown');

UPDATE public.calls
SET intent_source = 'unknown'
WHERE intent_source IS NULL
   OR intent_source NOT IN ('model_classifier','agent_inference','human_override','unknown');

UPDATE public.calls
SET intent_confidence_band = CASE
  WHEN intent_confidence IS NULL THEN 'unknown'
  WHEN intent_confidence >= 0.8 THEN 'high'
  WHEN intent_confidence >= 0.5 THEN 'medium'
  ELSE 'low'
END
WHERE intent_confidence_band IS NULL
   OR intent_confidence_band NOT IN ('high','medium','low','unknown');

UPDATE public.calls
SET label_version = 1
WHERE label_version IS NULL OR label_version < 1;

ALTER TABLE public.calls
  ALTER COLUMN terminal_status_source SET DEFAULT 'unknown',
  ALTER COLUMN terminal_status_source SET NOT NULL,
  ALTER COLUMN intent_source SET DEFAULT 'unknown',
  ALTER COLUMN intent_source SET NOT NULL,
  ALTER COLUMN intent_confidence_band SET DEFAULT 'unknown',
  ALTER COLUMN intent_confidence_band SET NOT NULL,
  ALTER COLUMN label_version SET DEFAULT 1,
  ALTER COLUMN label_version SET NOT NULL;

-- Constraint hardening after backfill
ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_terminal_status_source_check,
  ADD CONSTRAINT calls_terminal_status_source_check
    CHECK (terminal_status_source IN ('realtime','carrier','system','unknown'));

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_intent_source_check,
  ADD CONSTRAINT calls_intent_source_check
    CHECK (intent_source IN ('model_classifier','agent_inference','human_override','unknown'));

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_intent_confidence_band_check,
  ADD CONSTRAINT calls_intent_confidence_band_check
    CHECK (intent_confidence_band IN ('high','medium','low','unknown'));

-- Allow explicit unknown terminal reason marker
ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_end_reason_check,
  ADD CONSTRAINT calls_end_reason_check
    CHECK (end_reason IS NULL OR end_reason IN (
      'caller_hangup', 'agent_end', 'transfer',
      'error', 'timeout', 'quota_denied', 'unknown'
    ));

CREATE INDEX IF NOT EXISTS idx_calls_terminal_status_source ON public.calls(terminal_status_source);
CREATE INDEX IF NOT EXISTS idx_calls_intent_source ON public.calls(intent_source);
CREATE INDEX IF NOT EXISTS idx_calls_intent_confidence_band ON public.calls(intent_confidence_band);
