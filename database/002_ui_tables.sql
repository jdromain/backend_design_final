-- ================================================================
-- Rezovo -- UI-specific tables (users, contacts, follow-ups, etc.)
-- Run AFTER setup_complete.sql. Idempotent (safe to re-run).
-- ================================================================

-- ================================================================
-- 1. USERS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.users (
  id          TEXT PRIMARY KEY,
  org_id   TEXT NOT NULL REFERENCES public.organizations(id),
  email       TEXT NOT NULL,
  roles       TEXT[] DEFAULT '{viewer}',
  clerk_id    TEXT,
  name        TEXT,
  status      TEXT DEFAULT 'active' CHECK (status IN ('active','invited','disabled')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_org   ON public.users(org_id);
CREATE INDEX IF NOT EXISTS idx_users_email    ON public.users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_email_unique ON public.users(org_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_org_clerk_unique
  ON public.users(org_id, clerk_id)
  WHERE clerk_id IS NOT NULL;

-- ================================================================
-- 2. CONTACTS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.contacts (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES public.organizations(id),
  name              TEXT,
  phone             TEXT NOT NULL,
  email             TEXT,
  tags              TEXT[] DEFAULT '{}',
  sms_opt_out       BOOLEAN DEFAULT false,
  last_contacted_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_org ON public.contacts(org_id);
CREATE INDEX IF NOT EXISTS idx_contacts_phone  ON public.contacts(phone);

-- ================================================================
-- 3. FOLLOW-UPS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.follow_ups (
  id                    UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES public.organizations(id),
  contact_id            UUID REFERENCES public.contacts(id),
  call_id               TEXT REFERENCES public.calls(call_id),
  type                  TEXT NOT NULL CHECK (type IN (
                          'missed_call','booking','estimate_approval','ready_pickup',
                          'payment_pending','large_party','catering','complaint',
                          'reservation','order_issue','general'
                        )),
  status                TEXT DEFAULT 'open' CHECK (status IN (
                          'open','in_progress','waiting_on_customer','scheduled',
                          'snoozed','done','failed','canceled'
                        )),
  priority              INT DEFAULT 1,
  severity              TEXT DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  owner_id              TEXT,
  due_at                TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  recommended_next_step TEXT,
  channel_plan          JSONB DEFAULT '{}',
  attempts              JSONB DEFAULT '[]',
  scheduled_steps       JSONB DEFAULT '[]',
  metadata              JSONB DEFAULT '{}',
  vertical              TEXT DEFAULT 'Common',
  notes                 TEXT,
  tags                  TEXT[] DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_follow_ups_org  ON public.follow_ups(org_id);
CREATE INDEX IF NOT EXISTS idx_follow_ups_status  ON public.follow_ups(status);
CREATE INDEX IF NOT EXISTS idx_follow_ups_contact ON public.follow_ups(contact_id);

-- ================================================================
-- 4. WORKFLOWS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.workflows (
  id                     UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id              TEXT NOT NULL REFERENCES public.organizations(id),
  vertical               TEXT,
  name                   TEXT,
  enabled                BOOLEAN DEFAULT true,
  trigger_key            TEXT,
  conditions             JSONB DEFAULT '{}',
  steps                  JSONB DEFAULT '[]',
  attempt_budget         JSONB DEFAULT '{}',
  escalation_rules       JSONB DEFAULT '[]',
  sla_minutes            INT,
  default_owner_strategy TEXT DEFAULT 'unassigned',
  is_built_in            BOOLEAN DEFAULT false,
  created_at             TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workflows_org ON public.workflows(org_id);

-- ================================================================
-- 5. TEMPLATES
-- ================================================================
CREATE TABLE IF NOT EXISTS public.templates (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id          TEXT NOT NULL REFERENCES public.organizations(id),
  vertical           TEXT,
  type               TEXT,
  title              TEXT,
  sms_template       TEXT,
  email_template     TEXT,
  quick_replies      TEXT[],
  tokens             TEXT[],
  checklist          TEXT[],
  default_next_steps TEXT[],
  links              JSONB DEFAULT '{}',
  created_at         TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_templates_org ON public.templates(org_id);

-- ================================================================
-- 6. NOTIFICATIONS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.notifications (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id   TEXT NOT NULL REFERENCES public.organizations(id),
  type        TEXT DEFAULT 'info' CHECK (type IN ('info','success','warning','error')),
  title       TEXT,
  message     TEXT,
  read        BOOLEAN DEFAULT false,
  timestamp   TIMESTAMPTZ DEFAULT now(),
  action_url  TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_org ON public.notifications(org_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read   ON public.notifications(read) WHERE read = false;

-- ================================================================
-- 7. API KEYS
-- ================================================================
CREATE TABLE IF NOT EXISTS public.api_keys (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id    TEXT NOT NULL REFERENCES public.organizations(id),
  name         TEXT,
  prefix       TEXT,
  key_hash     TEXT,
  status       TEXT DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at   TIMESTAMPTZ DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON public.api_keys(org_id);

-- ================================================================
-- SEED DATA
-- ================================================================

INSERT INTO public.users (id, org_id, email, roles, name, status)
VALUES ('user-admin', 'org_localdemo', 'admin@example.com', '{admin}', 'Admin User', 'active')
ON CONFLICT (email) DO UPDATE SET
  roles = '{admin}',
  org_id = 'org_localdemo';
