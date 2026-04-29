-- Normalize legacy call termination semantics and close stale orphaned live calls.
-- Safe to run repeatedly.

-- 1) Legacy default "agent_end" rows from realtime fallback should display as
-- neutral normal completions unless explicitly ended by dashboard action.
UPDATE calls c
SET end_reason = 'normal_completion'
WHERE c.outcome = 'handled'
  AND c.end_reason = 'agent_end'
  AND NOT EXISTS (
    SELECT 1
    FROM call_events ce
    WHERE ce.call_id = c.call_id
      AND ce.event_type = 'call_ended'
      AND ce.payload->>'source' = 'dashboard_action'
  );

-- 2) Reconcile stale live calls older than 15 minutes into an explicit terminal state.
WITH closed AS (
  UPDATE calls c
  SET status = 'abandoned',
      outcome = 'abandoned',
      end_reason = 'timeout',
      failure_type = COALESCE(c.failure_type, 'stale_live_timeout'),
      ended_at = COALESCE(c.ended_at, now()),
      duration_sec = COALESCE(
        c.duration_sec,
        GREATEST(0, EXTRACT(EPOCH FROM (now() - c.started_at))::int)
      )
  WHERE c.status IN ('initiated', 'ringing', 'in_progress')
    AND c.ended_at IS NULL
    AND c.started_at < now() - interval '15 minutes'
  RETURNING c.call_id, c.org_id
)
INSERT INTO call_events (call_id, org_id, event_type, payload, occurred_at)
SELECT
  closed.call_id,
  closed.org_id,
  'call_ended',
  jsonb_build_object(
    'source', 'migration_backfill',
    'outcome', 'abandoned',
    'endReason', 'timeout'
  ),
  now()
FROM closed;
