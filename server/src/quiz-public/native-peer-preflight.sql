-- Read-only candidate. Use the actual DEV quiz runtime OS identity and its private socket, not SET ROLE.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL statement_timeout = '2s';
SET LOCAL search_path = pg_catalog, pg_temp;
WITH readiness AS (
SELECT current_database() = 'ef_quiz_qa_dev' AND current_user = 'ef_quiz_account_qa_runtime' AND session_user = 'ef_quiz_account_qa_runtime' AND inet_server_addr() IS NULL
  AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole AND NOT r.rolreplication AND NOT r.rolbypassrls
  AND NOT EXISTS (SELECT FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid)
  AND EXISTS (SELECT FROM pg_catalog.pg_namespace n WHERE n.nspname='ef_quiz_account_dev' AND n.nspowner<>r.oid)
  AND NOT pg_catalog.has_schema_privilege(current_user,'ef_quiz_account_dev','CREATE')
  AND NOT pg_catalog.has_table_privilege(current_user,'ef_quiz_account_dev.run_budget','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  AND pg_catalog.has_function_privilege(current_user,'ef_quiz_account_dev.reserve_run_budget(text,text,text,text,bigint,bigint,smallint)','EXECUTE')
  AND pg_catalog.has_function_privilege(current_user,'ef_quiz_account_dev.verified_run_active(text,text,text)','EXECUTE')
  AND pg_catalog.has_column_privilege(current_user,'ef_quiz_account_dev.report','bank_revision','INSERT')
  AND NOT pg_catalog.has_column_privilege(current_user,'ef_quiz_account_dev.report','bank_revision','UPDATE')
  AND NOT pg_catalog.has_column_privilege(current_user,'ef_quiz_account_dev.report','first_saved_at','INSERT,UPDATE')
  AS ready FROM pg_catalog.pg_roles r WHERE r.rolname=current_user
)
SELECT (count(*) = 1 AND coalesce(bool_and(ready), false)) AS quiz_peer_ready FROM readiness;
ROLLBACK;
