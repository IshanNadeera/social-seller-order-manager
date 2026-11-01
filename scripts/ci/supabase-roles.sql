-- Creates the API roles that every Supabase database has (anon, authenticated, service_role), so CI
-- runs migrations against a plain PostgreSQL the way they run on Supabase (docs/DEVELOPMENT.md §13.3).
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
