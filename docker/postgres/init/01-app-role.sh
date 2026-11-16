#!/usr/bin/env bash
set -euo pipefail

: "${MEMORA_APP_PASSWORD:?MEMORA_APP_PASSWORD is required to provision the runtime database role}"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$MEMORA_APP_PASSWORD" \
  --set=owner_role="$POSTGRES_USER" \
  --set=db_name="$POSTGRES_DB" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'memora_app') THEN
    EXECUTE 'CREATE ROLE memora_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE';
  END IF;
END
$$;

ALTER ROLE memora_app NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
SELECT format('ALTER ROLE memora_app PASSWORD %L', :'app_password') \gexec
GRANT CONNECT ON DATABASE :"db_name" TO memora_app;
GRANT USAGE ON SCHEMA public TO memora_app;

ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO memora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO memora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO memora_app;
SQL
