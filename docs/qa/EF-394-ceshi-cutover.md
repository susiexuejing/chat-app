# EF-394 / EF-395: only the existing /ceshi/ entry

Review-only handoff; not an applied Nginx unit, migration, deployment or approval.
Source baseline: draft PR 215 a7d98311fd5db4c922f7641ce34b8ac71cf6e82b.
Native observations are historic receipts EF-394 #13552 and EF-395 #13584,
not fresh observations. Current vhost content and ownership are authoritative.

## Preflight, before any route change

1. Build the exact reviewed bundle using the public DEV flags in the existing
   CI; fixture flags zero, same /ceshi base and no credentials in static files.
   Record commit and manifest of file hashes for a reviewed immutable directory.
   Keep the existing service on 19439 untouched; do not use whole-dev deploy.
2. Read effective relevant Nginx vhost/rule and checksum the exact file governing
   /ceshi/. Record /ceshi redirect, /ceshi/ HTML and representative shipped
   asset fingerprints, plus existing chat HTML/health and service identity.
   Ignore unrelated config/credentials; don't record bodies or logging values
   for auth traffic. Verify the old complete site is still available for restore.
3. Keep the questionnaire independent of the timed backend. Route the four
   existing path names challenge, verify, result and logout under
   /ceshi/api/auth/v1/ only to a dedicated filesystem Unix socket. Use exact
   locations, or one narrow namespace with closed-deny default, never fall
   back to static HTML or the chat upstream for an API miss. Serve static
   bundle and deep assets only via /ceshi/. Keep existing /ceshi redirect,
   host, TLS and chat routes unchanged. Review Host/Origin preservation,
   duplicate handling before normalization, cache/retry off for the auth
   namespace, and no query/body/cookie logging on those requests.
4. Native database: use the actual dedicated OS runtime identity and private
   socket /run/ef-quiz-postgres-dev (port 55439), DB ef_quiz_qa_dev;
   do not use SET ROLE as proof of OS peer identity. After the scoped
   candidate schema and role exist, run native-peer-preflight.sql using
   psql -X -w -h /run/ef-quiz-postgres-dev -p 55439 -d ef_quiz_qa_dev
   -U ef_quiz_account_qa_runtime -f native-peer-preflight.sql, under that
   identity. Sole success is quiz_peer_ready=t with psql exit 0. A PostgreSQL
   error is not a pass. Confirm version, peer-only mapping, ownership and
   staged migration checksum separately; no access or changes to quiz_auth
   or shared auth. This check does not prove credentials or application IO.
5. Record the runtime filename/version, private socket ownership/mode and
   actual service user. Test closed auth and static dispatch before any active
   real-provider window; never pass readiness just because a process started.
   Complete the dedicated role/schema/identity/target-unit and SMS consent
   scope reviews before loading secrets or enabling vendor traffic.

## Cutover and restore (after exact target review and applicable authorization)

Retain a byte-identical rollback of the current scoped config and prior
static package/19439 process. Abort if the reviewed live config fingerprint
changed. Validate the candidate with nginx -t, atomically replace only the
scoped quiz config and use a graceful Nginx reload, not a restart of any
chat/app service. If validation fails before reload, restore without activating
the candidate. If an after-reload guard trips, close candidate auth, restore
the previous exact scoped config, nginx -t, graceful reload, and verify the
legacy quiz and unchanged chat/health fingerprints. Do not remove data in
rollback; isolation permits the new code to stay disabled. Do not declare an
exact-host pass until the pinned release serves the original link and the
authorized timed real journey has passed in independent browser QA; only
then hand the same link to Susie.
