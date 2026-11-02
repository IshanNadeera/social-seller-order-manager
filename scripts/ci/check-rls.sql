-- CI gate (docs/DEVELOPMENT.md §11.3, §13.3, ADR-004), run right after `prisma migrate deploy`:
--   1. every table in the private `app` schema has row-level security enabled;
--   2. Supabase's API roles (anon, authenticated, service_role) have no privilege at all on the
--      `app` schema or anything in it.
-- Raises an error (non-zero exit with psql -v ON_ERROR_STOP=1) that names what is wrong.
-- A new table must re-run the ENABLE ROW LEVEL SECURITY step in its own migration (§8.5).
DO $$
DECLARE
  missing_rls text;
  granted text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO missing_rls
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'app'
     AND c.relkind IN ('r', 'p')   -- ordinary and partitioned tables
     AND NOT c.relrowsecurity;
  IF missing_rls IS NOT NULL THEN
    RAISE EXCEPTION 'Row-level security is disabled on app tables: %', missing_rls
      USING HINT = 'Add ALTER TABLE app.<table> ENABLE ROW LEVEL SECURITY; to the migration that creates the table.';
  END IF;

  SELECT string_agg(DISTINCT grant_line, '; ')
    INTO granted
    FROM (
      SELECT r.rolname || ' has ' || p.privilege || ' on schema app' AS grant_line
        FROM pg_roles r
        CROSS JOIN (VALUES ('USAGE'), ('CREATE')) AS p(privilege)
       WHERE r.rolname IN ('anon', 'authenticated', 'service_role')
         AND has_schema_privilege(r.rolname, 'app', p.privilege)
      UNION ALL
      SELECT grantee || ' has ' || privilege_type || ' on app.' || table_name
        FROM information_schema.role_table_grants
       WHERE table_schema = 'app'
         AND grantee IN ('anon', 'authenticated', 'service_role')
    ) AS grants;
  IF granted IS NOT NULL THEN
    RAISE EXCEPTION 'Supabase API roles can reach the app schema: %', granted
      USING HINT = 'The app schema must stay private: REVOKE these grants in a migration (ADR-004).';
  END IF;

  RAISE NOTICE 'RLS check passed: every app table has RLS, and the API roles have no access.';
END $$;
