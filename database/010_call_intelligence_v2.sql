-- ================================================================
-- 010_call_intelligence_v2.sql
-- Agentic call intelligence v2 envelope + workflow metadata.
-- ================================================================

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS classification_v2 JSONB,
  ADD COLUMN IF NOT EXISTS classification_v2_phase TEXT DEFAULT 'provisional',
  ADD COLUMN IF NOT EXISTS classification_v2_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS call_intelligence_manual_lock BOOLEAN DEFAULT false;

UPDATE public.calls
SET classification_v2_phase = 'provisional'
WHERE classification_v2_phase IS NULL
   OR classification_v2_phase NOT IN ('provisional', 'pending_context', 'final', 'failed');

ALTER TABLE public.calls
  ALTER COLUMN classification_v2_phase SET DEFAULT 'provisional',
  ALTER COLUMN classification_v2_phase SET NOT NULL,
  ALTER COLUMN call_intelligence_manual_lock SET DEFAULT false,
  ALTER COLUMN call_intelligence_manual_lock SET NOT NULL;

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_classification_v2_phase_check,
  ADD CONSTRAINT calls_classification_v2_phase_check
    CHECK (classification_v2_phase IN ('provisional', 'pending_context', 'final', 'failed'));

CREATE INDEX IF NOT EXISTS idx_calls_intel_phase ON public.calls(classification_v2_phase);
CREATE INDEX IF NOT EXISTS idx_calls_intel_updated ON public.calls(classification_v2_updated_at DESC);
