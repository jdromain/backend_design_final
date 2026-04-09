-- Add failure diagnostics for call history / analytics and backfill historical rows.

ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS failure_type TEXT;

CREATE INDEX IF NOT EXISTS idx_calls_failure_type
  ON public.calls (failure_type);

-- Backfill from latest Twilio carrier status event when available.
WITH latest_status AS (
  SELECT DISTINCT ON (ce.call_id)
    ce.call_id,
    NULLIF(ce.payload->>'ErrorMessage', '') AS error_message,
    NULLIF(ce.payload->>'ErrorCode', '') AS error_code,
    NULLIF(ce.payload->>'CallStatus', '') AS call_status
  FROM public.call_events ce
  WHERE ce.event_type = 'carrier_status'
  ORDER BY ce.call_id, ce.occurred_at DESC
)
UPDATE public.calls c
SET failure_type = COALESCE(ls.error_message, ls.error_code, ls.call_status)
FROM latest_status ls
WHERE c.call_id = ls.call_id
  AND c.failure_type IS NULL
  AND COALESCE(ls.error_message, ls.error_code, ls.call_status) IS NOT NULL;

-- Fallback backfill for rows without carrier status details.
UPDATE public.calls c
SET failure_type = CASE
  WHEN c.outcome = 'failed' AND c.end_reason = 'timeout' THEN 'timeout'
  WHEN c.outcome = 'failed' AND c.end_reason = 'quota_denied' THEN 'quota_denied'
  WHEN c.outcome = 'failed' AND c.end_reason = 'caller_hangup' THEN 'caller_hangup'
  WHEN c.outcome = 'failed' AND c.end_reason = 'error' THEN COALESCE(NULLIF(c.status, ''), 'error')
  WHEN c.status = 'failed' THEN COALESCE(NULLIF(c.end_reason, ''), 'failed')
  WHEN c.status = 'abandoned' THEN COALESCE(NULLIF(c.end_reason, ''), 'abandoned')
  ELSE c.failure_type
END
WHERE c.failure_type IS NULL
  AND (c.outcome = 'failed' OR c.status IN ('failed', 'abandoned'));
