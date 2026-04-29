-- Allow "normal_completion" as a first-class terminal reason while keeping
-- legacy "agent_end" rows valid/readable.
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.calls'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%end_reason%'
  LOOP
    EXECUTE format('ALTER TABLE public.calls DROP CONSTRAINT %I', rec.conname);
  END LOOP;

  ALTER TABLE public.calls
    ADD CONSTRAINT calls_end_reason_check
      CHECK (
        end_reason IS NULL OR end_reason IN (
          'caller_hangup',
          'agent_end',
          'normal_completion',
          'transfer',
          'error',
          'timeout',
          'quota_denied'
        )
      );
END $$;
