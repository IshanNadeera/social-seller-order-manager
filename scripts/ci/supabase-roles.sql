-- Makes a plain PostgreSQL behave like a Supabase database where it matters to us, so CI runs
-- migrations and checks the way they run on Supabase (docs/DEVELOPMENT.md §13.3):
--   1. the API roles every Supabase database has (anon, authenticated, service_role);
--   2. Supabase's search path, which includes the `extensions` schema (see the end of this file).
-- The init migration revokes all access to the private `app` schema from these roles, and
-- test/migration.db-spec.ts checks that they really have none. Without the roles, that check
-- would be skipped. Safe to run more than once.
DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('CREATE ROLE %I NOLOGIN', r);
    END IF;
  END LOOP;
END $$;

-- Like Supabase, let the API roles see the public schema, so the REVOKE on `app` is what keeps
-- them out (and not merely the absence of any grant).
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Supabase's search path includes `extensions` (where pg_trgm lives), so extension functions and
-- operators resolve the same way in CI as on Supabase, e.g. for a later migration or raw query that
-- uses a pg_trgm function without the schema prefix. Applies to new connections (every later step).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET search_path TO "$user", public, extensions', current_database());
END $$;
