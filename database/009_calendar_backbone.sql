-- Calendar backbone tables for provider-first booking orchestration.

CREATE TABLE IF NOT EXISTS public.calendar_resources (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  timezone          TEXT NOT NULL DEFAULT 'America/New_York',
  slot_interval_min INT NOT NULL DEFAULT 10 CHECK (slot_interval_min > 0 AND slot_interval_min <= 240),
  capacity_per_slot INT NOT NULL DEFAULT 1 CHECK (capacity_per_slot > 0 AND capacity_per_slot <= 1000),
  provider_binding  JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_calendar_resources_org
  ON public.calendar_resources (org_id);
CREATE INDEX IF NOT EXISTS idx_calendar_resources_org_active
  ON public.calendar_resources (org_id, is_active);

CREATE TABLE IF NOT EXISTS public.calendar_bookings (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_id        UUID NOT NULL REFERENCES public.calendar_resources(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'confirmed'
                      CHECK (status IN ('confirmed', 'canceled', 'pending', 'failed')),
  starts_at          TIMESTAMPTZ NOT NULL,
  ends_at            TIMESTAMPTZ NOT NULL CHECK (ends_at > starts_at),
  customer_name      TEXT,
  customer_phone     TEXT,
  customer_email     TEXT,
  party_size         INT NOT NULL DEFAULT 1 CHECK (party_size > 0),
  notes              TEXT,
  source             TEXT NOT NULL DEFAULT 'local_manual'
                      CHECK (source IN ('local_manual', 'voice_agent', 'provider_synced', 'provider_reconciled')),
  provider_type      TEXT
                      CHECK (provider_type IS NULL OR provider_type IN ('google_calendar', 'calendly')),
  provider_event_id  TEXT,
  metadata           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_bookings_org
  ON public.calendar_bookings (org_id);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_org_range
  ON public.calendar_bookings (org_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_resource_range
  ON public.calendar_bookings (resource_id, starts_at, ends_at);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_status
  ON public.calendar_bookings (status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_bookings_provider_event
  ON public.calendar_bookings (org_id, provider_type, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.calendar_booking_events (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id          UUID REFERENCES public.calendar_bookings(id) ON DELETE CASCADE,
  org_id              TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  resource_id         UUID REFERENCES public.calendar_resources(id) ON DELETE SET NULL,
  event_type          TEXT NOT NULL CHECK (
                        event_type IN ('create', 'update', 'cancel', 'sync', 'provider_error', 'oauth_refresh')
                      ),
  provider_type       TEXT
                      CHECK (provider_type IS NULL OR provider_type IN ('google_calendar', 'calendly')),
  provider_latency_ms INT,
  total_latency_ms    INT,
  result              TEXT NOT NULL CHECK (result IN ('success', 'failure')),
  error_code          TEXT,
  error_message       TEXT,
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_booking_events_org
  ON public.calendar_booking_events (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_booking_events_booking
  ON public.calendar_booking_events (booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_booking_events_result
  ON public.calendar_booking_events (result, created_at DESC);

CREATE TABLE IF NOT EXISTS public.calendar_oauth_accounts (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider                TEXT NOT NULL CHECK (provider IN ('google_calendar', 'calendly')),
  account_id              TEXT,
  account_email           TEXT,
  encrypted_access_token  TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  token_expires_at        TIMESTAMPTZ,
  scopes                  TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  metadata                JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active               BOOLEAN NOT NULL DEFAULT false,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_calendar_oauth_single_active_provider
  ON public.calendar_oauth_accounts (org_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_calendar_oauth_accounts_org
  ON public.calendar_oauth_accounts (org_id, provider);
CREATE INDEX IF NOT EXISTS idx_calendar_oauth_accounts_expiry
  ON public.calendar_oauth_accounts (token_expires_at);

CREATE TABLE IF NOT EXISTS public.calendar_oauth_states (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        TEXT NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider      TEXT NOT NULL CHECK (provider IN ('google_calendar', 'calendly')),
  state         TEXT NOT NULL UNIQUE,
  code_verifier TEXT,
  code_challenge TEXT,
  redirect_uri  TEXT NOT NULL,
  expires_at    TIMESTAMPTZ NOT NULL,
  consumed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_calendar_oauth_states_org_provider
  ON public.calendar_oauth_states (org_id, provider, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_oauth_states_expiry
  ON public.calendar_oauth_states (expires_at);
