# EF-376/377 fixed integrated Demo: source admission and release review

## Fixed source

Imported without changes from EmotionFlow-EF377-Integrated-v0.1.zip, SHA-256
`7e975cc8b6f8e658f8214cae1fb817f3aa51aa60eca354935dc71caaf3da4f1e`.
The two original source/QA directories retain their relative layout. No archive
or duplicate root HTML is needed in git. See PROVENANCE.md for module identities.
EF-378/379 are deferred until this application is delivered.

Run from the repository root: `node demos/ef377/verify.mjs`.
This builds and checks the fixed 32,816-byte HTML. Its SHA-256 must remain
`e40ae524f7f48a5304e0bb14b7fb3008fa5c97f8a737b55f4b510a5ef39a4771`.
The wrapper sets the original QA working directory rather than changing frozen
QA scripts. The imported report describes historical independent QA; replay by
the integration owner is not fresh independent QA. Local replay on 2026-11-01
used Node v24.22.1, not the deployment workflow's Node 20. Owner checks and all
42 synthetic assertions passed. Browser rendering/E2E remain Not Run.

## Existing release chain: read-only findings, 2026-11-01

- Application repository: susiexuejing/chat-app; default/release branch: dev.
- Read HEAD: `392161d20f86bb2d710a8cb6a25e32253dff6b5a`.
- `.github/workflows/deploy-dev.yml` (blob
  `c933c4d2e037f0889e7a2470c6711ba18f70b04f`) triggers on dev push or manual
  workflow_dispatch. It uses Node 20/pnpm 9, frozen install, client/server tests,
  Expo frontend export and backend build, then SSH/rsync activation.
- Run 37212217957 completed successfully for this HEAD; upload, activation,
  domain verification and audit-file metadata steps succeeded. Public
  https://dev.douhaoyu.cn/deployment-sha.txt returned this same HEAD during
  this review. This proves domain version agreement, not ECS instance identity.
- Existing activation replaces `/var/www/chat-app/dev` and server dist under
  `/var/www/chat-app/server`, restarts the backend via PM2, and has backup/rollback.
  Host identity is referenced by DEV_SSH_HOST; its value was not read.
- Repository source does not bind that protected host to the designated ECS
  `i-0jlbuvzvw9afq1ssgkj1`. Historical EF-377 #12972 is not a fresh host attestation.

## Exact difference and shortest remaining release action

This PR adds only `demos/ef377/**`. It creates no public route, changes no
workflow/runtime/secret/access policy, and does not copy the Demo into the Expo
public export. Merging would still trigger the existing whole-application DEV
workflow, so merge/dispatch are not part of this source-import action.

The missing capability is a reviewed, target-bound **single-file EF-377 publish
operation**. The existing whole-app pipeline cannot be treated as that operation:
it does not publish `/srv/emotionflow-internal`, configure a restricted location,
or enforce the Demo's fixed digest. Do not dispatch it as a substitute.

Shortest action: the existing DEV deployment owner uses the established protected
host channel to attest that it targets the designated ECS, then prepares one
bounded publish operation for the fixed HTML and exact nginx location below.
No new host connection, service, port, security group, backend restart or model
call is required for that operation. Its target/source-access details must be
completed and reviewed before execution.

| Item | Existing workflow | EF-377 proposal (not applied) |
| --- | --- | --- |
| Frontend destination | /var/www/chat-app/dev | /srv/emotionflow-internal/ef377/a-e40ae524/index.html |
| URL | Existing application on dev.douhaoyu.cn | /_internal/ef377/a-e40ae524/index.html on existing 443 vhost |
| Content | Entire frontend and backend builds | Only the fixed 32,816-byte HTML |
| Allowed source | No EF-377 rule in workflow | 154.40.33.211/32 is a candidate from historical QA observation; actual DEV remote_addr still unverified |
| Activation | Backend restart | nginx test/reload only after exact configuration review |
| Rollback | Full application backups | Remove only this file/location; stop on configuration drift |

The proposed path/IP are inherited draft values, not approved or newly deployed.
Fresh read-only checks must cover the designated instance, vhost/includes,
directory ownership/symlinks, route conflicts, previous-page baseline and
effective access-control source (including trusted-proxy configuration).

Preserve the draft restrictions: exact file GET/HEAD, other sources denied,
no-store/no-referrer/nosniff/DENY headers, CSP default-src/connect-src 'none',
img-src data:, object-src/base-uri/form-action 'none', style-src 'unsafe-inline',
script-src 'sha256-tr9aai8ZEQaonZ7PyuvL8d6jXGFwLKNVni4A8/MxpSs=',
frame-ancestors 'none'. Do not use storage-breaking CSP sandbox.

No server write, deployment, browser QA, fresh independent QA, or Epic acceptance
is claimed by this PR. Real phone numbers/text/users, SMS, keys/models and
production remain outside scope. This application import must not be used to
bypass a browser tool's earlier file-access denial.
