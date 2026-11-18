# EF-388–392: tests-first frontend demo

This is an opt-in frontend build, not a deployment or a production release. It implements the November 18 tests-and-login scope; the existing default DEV build, legacy chat, patterns, practice and path code are unchanged.

## Run locally

From the repo root, install the existing lockfile with pnpm 9. From `client`:

- `pnpm demo:tests`: local development preview.
- `pnpm build:tests-demo`: static web export to `dist/tests-demo`.
- `pnpm test:tests-demo`: deterministic state/route-boundary checks.

`EXPO_PUBLIC_TESTS_DEMO=1` selects the independent `tests-app` Expo Router root. Do not set this flag in an existing deployment without separate authorization. The default `app` root is unchanged. Old paths in the tests-only build redirect to the test list, never mounting legacy providers/screens. This is a UI routing boundary, not real authentication security.

## Implemented scope

- EF-388: minimal mobile tests landing, no bottom tab placeholders, safe Screen/Provider presentation reuse.
- EF-389: three bundled fictional tests, six questions each, introduction and disclosures; data-driven list; local loading/empty/error controls.
- EF-390: visitor answers, progress, required answers, back/edit, resume after list/introduction interruption.
- EF-391: explicit simulated login with fictional A/B identities; no phone input, SMS, real consent or account; invalid/expired/failure fixtures and cancellation preserve answers; switching identity or logging out clears prior in-memory content.
- EF-392: deterministic local example result, completion time, return/edit; only the current result, no history, saving, path record or cross-session retrieval.

All screens identify the frontend simulation. Refresh discards memory. Nothing reads or writes existing accounts, chat data or browser storage. No backend, API, model, permissions or deployment changes.

## Browser acceptance checklist

Use the static export in an isolated local browser session. Capture actual network requests throughout, not mocked success. Business API requests must be zero; static JS/CSS/fonts/images are allowed. If unavailable, record Not Run, not Passed.

1. At 320px and 390px widths, list all three cards with description/question count/time; no horizontal overflow or hidden CTA.
2. Open an intro; return; start; try Next without an answer; answer and move back; edit; return to list and resume.
3. Finish as guest; cancel login; recover same answers; try invalid/expired/failure fixtures; then simulate successful login.
4. Verify same test result, example disclaimer and completion time; repeat clicks; edit answers and recompute.
5. Already logged in: complete another test without another login; switch identity B and check no prior result; log out and check reset.
6. Local catalog/result loading, empty and error controls recover through local retry/return.
7. Refresh resets; direct `/chat`, `/demo`, `/my-path` URLs in this build show tests only; browser Back/Forward never exposes legacy module.
8. Complete all three tests and review network evidence, console and screenshots. No actual-user or clinical assessment claim.

## Verification

Execution results are recorded in the PR/Jira after running. The checklist alone is not evidence of passage. True login, persistence, formal scoring, online service integration and production readiness are excluded.

### Execution record — 2026-11-18

- Existing frozen lockfile installed using pnpm 9; no dependency/version changes.
- `pnpm --dir client test:tests-demo`: **17/17 passed**. An independent source reviewer reproduced the earlier 17 scenarios and confirmed fixes for interrupted login copy, repeated login/cancel and quiz-bound completion timestamps. The final portable runner uses Node with the existing tsx loader (no tsx CLI IPC requirement).
- Client `lint` (TSC then ESLint): **passed**. Server TSC: **passed**. An initial reducer typing error was corrected before the final successful client run.
- `pnpm test:release`: **22 Jest suites / 213 tests passed**, runtime data static guard passed; 2 approved isolated suites passed.
- `node --test scripts/__tests__/run-release-regression.test.mjs`: **25/25 passed** after dependencies were available. Initial pre-install attempt had one dependency-related canonical-run failure; final execution supersedes it.
- Final `pnpm --dir client build:tests-demo`: **passed**, static bundle `entry-f0dfbfe18b8c5187f41bca61f221bb0a.js`.
- `git diff --check`: **passed**.
- Browser UI and Network acceptance: **NOT RUN**. Chromium could not create its IPC socket (`Operation not permitted`), including one supported escalation attempt. A supported cloud-browser attempt to localhost returned `ERR_CONNECTION_REFUSED`; an alive local server session was also unreachable from a separate command session. No upload, DEV-hosted workaround or alternate public route was used.
- Business requests sent in this task: **0**. This is not a runtime Network proof for the application; that acceptance remains pending.
- No merge, deployment, real login, persistence or actual-user testing. Tickets remain In Progress.

Next supported verification step: run the documented static export in an environment where the test browser and local server share a reachable loopback interface and the browser is permitted to create its own fresh profile. Then execute the browser checklist and capture network/screen evidence. Do not treat a new remote deployment as a workaround for this local capability restriction.
