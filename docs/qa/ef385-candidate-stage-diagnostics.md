# EF-385 opt-in candidate stage diagnostics

Default-off, DEV-only diagnostic code. This change does not fix or prove model semantics and does not authorize additional provider calls.

Server requires NODE_ENV=development, DEV_CANDIDATE_DIAGNOSTICS=1, the existing authenticated DEV ephemeral route, retry/reply contract negotiation and X-Dev-Candidate-Diagnostic: dev-candidate-diagnostic-v1. Deployment workflow is unchanged and does not set the new variable. Enabling/disabling runtime configuration is a separate controlled operation; do not print or rewrite protected environment data. Set the flag explicitly to 0 to disable through that same process rather than assuming a PM2 restart removes an inherited value.

Official client shows a one-send opt-in only in the DEV temporary test space. No automatic send/retry or persistence. The server cannot authenticate the browser storage mode from the header; it independently checks environment, contract and owner authorization.

Only model_null, candidate_filtered, candidate_ready, reply_rejected, provider_incomplete or unavailable are returned in the existing owner SSE terminal. No input, reply, quotations, evidence labels, identifiers or raw model output are added to diagnostics. No new logs, storage or debug endpoint. Labels describe parser paths, not semantic truth. callback_accepted is not proof of card visibility; inspect the real UI separately.

Local validation: 357 focused Node tests and 80 React renderer tests passed; server type check and targeted UI strict type check passed. Independent review covered 28 cases included in the Node total, including default-off, owner isolation, strict schemas, unchanged response gates, no sentinel content leakage, single use and expiry. Full client type check/build was not completed in the partial local checkout because platform dependencies were missing. CI/full checkout validation remains required. No real browser/provider validation was performed for this patch. EF-353 crisis safety gaps remain open.

Run focused Node tests with NODE_OPTIONS=--experimental-vm-modules and node --test server/src/__tests__/devPracticeCandidate.test.mjs server/src/__tests__/candidate-diagnostic-review.test.mjs client/features/dev-journey/__tests__/*.test.mjs. Run the DevConversation renderer suite with the repository client Jest configuration. Also run repository lint and full build before considering merge.
