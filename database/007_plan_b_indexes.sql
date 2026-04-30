-- Plan B: indexes for org-scoped queries (idempotent). Complement setup_complete.sql.

-- GET /calls tool events: WHERE org_id = $1 AND call_id = ANY($2)
CREATE INDEX IF NOT EXISTS idx_call_events_org_call ON public.call_events (org_id, call_id);

-- ConfigStore: latest published config per org + lob
CREATE INDEX IF NOT EXISTS idx_agent_configs_org_lob_published_version
  ON public.agent_configs (org_id, lob, version DESC)
  WHERE status = 'published';

-- Optional: window queries on ended_at (dashboards / reporting)
CREATE INDEX IF NOT EXISTS idx_calls_org_ended_at ON public.calls (org_id, ended_at DESC)
  WHERE ended_at IS NOT NULL;
