# Public quiz login boundary, DEV QA only, unmounted

The existing public questionnaire is independent of this runtime and may
remain anonymous. This backend does not mount into Express, transfer, create
DB roles, migrate, seed, issue a cookie, or instantiate Aliyun PNVS by default.
It does not contain a synthetic authentication fallback. Only
`EF_QUIZ_ACCOUNT_MODE=qa-live-dev` may start this building block; any
unavailable dependency, false native peer/role check, invalid configuration
or expired window is closed 404. It is not a broad signup mode.

Wire contract under exact same-origin DEV path `/ceshi/api/auth/v1/`:

- POST `challenge`: `{phone,requestId,consent:true}`; POST `verify`:
  `{phone,code,challengeId,consent:true}`. Missing/non-true assent is rejected
  before provider or DB activity. New/repeat accounts share a flow and
  challenge failures do not disclose account existence.
- POST `result`: `{submissionId,choices:[{id,option}]}`; GET `result`
  authorizes the current session and returns the last own report or null;
  POST `logout` with `{}` invalidates the session and clears its cookies.
- The caller must implement and prove a private dedicated Unix-only ingress,
  no host-wide proxy or arbitrary forwarding, and supply the transport trust
  boolean from its own listener boundary (never from a header). Bound request
  bytes and duplicate headers before converting to the transport shape; never
  log raw body or cookie. Require exact canonical Host and browser Origin
  for writes, keep cookies HttpOnly/SameSite=Strict/Secure, `Cache-Control:
  no-store` and no proxy caching. Scope on the same origin is not an isolation
  boundary against scripts loaded on that origin; audit all same-origin
  deployments and CSP before enabling real accounts.

Required private env (names only; no template env values are appended):

- `EF_QUIZ_DEV_QA_PLAN`: exact JSON object `runId,release,from,until,subjects`;
  one or two approved phone digests with per-operation quota 1 or 2,
  combined at most 3 across the subjects, short <=15 minute window. No raw
  phone numbers in this env, logs, or SQL seed. Privileged operators must
  separately verify approvals, real release, actual clock and exact budgets.
- `EF_QUIZ_PHONE_HMAC`, `EF_QUIZ_BROWSER_HMAC`, `EF_QUIZ_ACCOUNT_HMAC`,
  `EF_QUIZ_SESSION_HMAC`: 4 distinct generated independent keys, 32 bytes
  each, hex. Don't reuse fixture, DEV app, or production keys; real persistence
  requires a governed account HMAC lifecycle.
- `EF_QUIZ_CONSENT_VERSION`: explicitly reviewed short DEV QA policy version
  (`dev-qa-…`); server records first successful version only. This is not
  public consent, does not bind to public policy URLs, and is not a substitute
  for approved agreement, data purpose, age confirmation, privacy notice and
  separately designed version enforcement for actual users.
- `EF_QUIZ_PNVS_STS_ID`, `EF_QUIZ_PNVS_STS_SECRET`,
  `EF_QUIZ_PNVS_STS_TOKEN`, `EF_QUIZ_PNVS_SCHEME`, `EF_QUIZ_PNVS_SIGN`,
  `EF_QUIZ_PNVS_TEMPLATE`: verified dedicated ephemeral STS identity, and
  matching approved send/check scheme and template; no other provider service.
  Environment provisioning must be owner controlled with no credential output.
  Official `@alicloud/dypnsapi20170525` 2.0.0 and transitive dependencies
  are locked independently under `pnvs-deps/`. Install the lock with
  `npm ci --prefix server/src/quiz-public/pnvs-deps --ignore-scripts --no-audit --no-fund`.
  Run `node --test server/src/quiz-public/pnvs-sdk.test.mjs` using Node 20
  to verify module exports, signing, request/response serialization and
  single-attempt failures using synthetic credentials and a blocked
  transport. This does not prove live connectivity, provider setup,
  delivery, or actual signature acceptance.
  [Send terms](https://help.aliyun.com/en/pnvs/developer-reference/api-dypnsapi-2017-05-25-sendsmsverifycode)
  and [Check terms](https://help.aliyun.com/en/pnvs/developer-reference/api-dypnsapi-2017-05-25-checksmsverifycode).

The fixed Postgres target is the dedicated DEV socket
`/run/ef-quiz-postgres-dev:55439`, database `ef_quiz_qa_dev`, proposed
**new** runtime role `ef_quiz_account_qa_runtime` (not assumed to exist).
The existing six-table `quiz_auth` and its role are not migrated or reused.
No PG environment override, SSL TCP, shared identity, or seed fallback.
The local candidate migration creates `ef_quiz_account_dev` and requires
a distinct owner and the pre-created peer role. Review least privileges,
native PG13 parser and connection, no public/cross-database access, and
exact schema/trigger hashes before any runtime start; never run outside
that DB. Grant no direct ledger access to runtime, and run seeding/removal
as separately authorized owner. App requires durable pseudonymous report
and idempotency semantics, does not persist raw answers/codes/phone.
Configure approved retention/deletion, cleanup, abuse protection and
operations before any actual public registration. Do not open broad SMS
using a QA-only time/number budget design.

Run local `node --test server/src/quiz-public/runtime.test.mjs` with the
existing isolated QA dependency installation. Tests use PGlite with actual
SQL/grants but stub the native peer proof and Alibaba model calls.
