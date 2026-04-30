-- Optional column for KB ingest failure messages (see apps/platform-api/scripts/sanity-kb-ingest.ts).
-- Idempotent: safe if column already exists from a full reset via setup_complete.sql in the future.

ALTER TABLE public.kb_documents
  ADD COLUMN IF NOT EXISTS last_error TEXT;
