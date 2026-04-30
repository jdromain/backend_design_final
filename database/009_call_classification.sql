-- ================================================================
-- 009_call_classification.sql
-- Durable categorization fields used by UI filters and analytics.
-- ================================================================

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS failure_category TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS action_class TEXT DEFAULT 'no_action';

UPDATE public.calls
SET failure_category = 'unknown'
WHERE failure_category IS NULL
   OR failure_category NOT IN (
    'carrier_error','stt_error','tts_error','llm_error','tool_error',
    'config_error','auth_error','quota_error','unknown'
  );

UPDATE public.calls
SET action_class = CASE
  WHEN outcome = 'transferred' THEN 'escalate_human'
  WHEN outcome = 'abandoned' THEN 'review_required'
  WHEN outcome = 'failed' THEN 'engineering_investigate'
  ELSE 'no_action'
END
WHERE action_class IS NULL
   OR action_class NOT IN (
    'no_action','review_required','followup_required','escalate_human','engineering_investigate'
  );

ALTER TABLE public.calls
  ALTER COLUMN failure_category SET DEFAULT 'unknown',
  ALTER COLUMN failure_category SET NOT NULL,
  ALTER COLUMN action_class SET DEFAULT 'no_action',
  ALTER COLUMN action_class SET NOT NULL;

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_failure_category_check,
  ADD CONSTRAINT calls_failure_category_check
    CHECK (failure_category IN (
      'carrier_error','stt_error','tts_error','llm_error','tool_error',
      'config_error','auth_error','quota_error','unknown'
    ));

ALTER TABLE public.calls
  DROP CONSTRAINT IF EXISTS calls_action_class_check,
  ADD CONSTRAINT calls_action_class_check
    CHECK (action_class IN (
      'no_action','review_required','followup_required','escalate_human','engineering_investigate'
    ));

CREATE INDEX IF NOT EXISTS idx_calls_outcome ON public.calls(outcome);
CREATE INDEX IF NOT EXISTS idx_calls_end_reason ON public.calls(end_reason);
CREATE INDEX IF NOT EXISTS idx_calls_failure_category ON public.calls(failure_category);
CREATE INDEX IF NOT EXISTS idx_calls_action_class ON public.calls(action_class);
