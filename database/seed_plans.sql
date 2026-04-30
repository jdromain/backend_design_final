-- Seed default plan rows for known orgs.
-- Idempotent: ON CONFLICT (org_id, plan_id) DO NOTHING.
-- Application code falls back to a hardcoded limit when no plan row exists,
-- so this seed is safe and optional.

INSERT INTO public.plans (
  org_id,
  plan_id,
  concurrent_calls_limit,
  monthly_minutes_included,
  cost_per_minute,
  status
)
VALUES
  ('org_3BwrvQseDzqwwsLvrisY2DNJwyK', 'starter', 5, 1000, 0.05, 'active')
ON CONFLICT (org_id, plan_id) DO NOTHING;
