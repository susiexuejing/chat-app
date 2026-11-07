# EF-385: shared native chat presentation and explicit DEV requests

Ticket: https://douhaoyu.atlassian.net/browse/EF-385

Requirements: https://douhaoyu.atlassian.net/wiki/spaces/PM/pages/398786561/EmotionFlow+MVP+User+journey

Base: `67a4e46c4428d77216443ca289cf4e06eb5f45c1` (EF-384 / PR #161).
This document supersedes EF-384's no-model description only for the DEV journey's explicit send operation. Existing historical synthetic entries keep their original labels and facts.

## Implemented boundary

- Original `/` and `/chat`, history, new conversation and live ChatProvider behavior remain. The DEV entry still waits for live hydration/sending to settle before replacing the route. It now truthfully labels the new experience as using real API calls.
- `/demo` remains the compatible DEV-only route for the local journey. Its chat uses the same extracted `MessageBubbleView`, `MessageListView`, and `MultimodalInputView` as the original app, rather than separate example bubbles or embedded HTML. Existing live wrappers retain their effects and handlers. The journey imports pure views directly, never the live provider, history hydration, or microphone-permission wrapper.
- A current-input-only controller uses the shared start helper against `/api/v1/chat/dev-journey/start`, plus the existing versioned stream endpoint, role `clever-fox`, a fresh request ID and no conversation ID. It does not send synthetic-account identifiers, saved patterns, practices, paths, prior conversations, or diagnostic markers. A new explicit chat allows one accepted turn; there is no automatic retry or multi-turn context.
- Mount, login, navigation, refresh, reset and text editing do not send. Only an explicit send starts work. Duplicate sends are refused synchronously. Stop, navigation, reset and unmount revoke the request's local authority. Late start/stream/auth responses cannot revive it. The 165-second local deadline does not retry.
- `chatStart` adds an optional final AbortSignal argument, preserving existing callers. Both helpers check cancellation after asynchronous authentication; native SSE also checks after dynamic import. Shared anonymous-auth issuance may finish after local stop. Already accepted server/provider work and billing cannot be guaranteed cancelled.
- The dedicated start route is registered only in backend development mode and requires an explicit `dev-ephemeral-v1` mode. Existing authentication/CSRF and SSE ownership remain mandatory. An older backend returns 404, with no fallback to ordinary chat/start; the client also requires an affirmative isolation receipt.
- Local Reaction/Companion text is not called API/model success. The journey requires nonempty Deep text and the protocol's successful terminal event before offering confirmation. Even then it says only that backend Deep output was received: supplier, model, fallback status, upstream success, request count and fees remain unverified.

## Data and confirmation

Independent review found that merely omitting conversationId still allowed the shared anonymous identity to update flow/change history, LTU, neural profiles and evolution. The corrected dedicated DEV route keeps that identity only for authenticated ownership. It uses a fresh neutral in-memory profile and first-turn prompt, skips those profile/history reads and writes, and does not create a durable conversation. Existing category-only diagnostics and anonymous authentication remain; no raw-content logging, credentials, provider settings, permission expansion, deployment path or IP change is introduced. The ordinary chat route without the mode keeps its existing behavior. The new start endpoint is an explicit additional route and must be reviewed before deployment. Users are told to enter fictional content and that an explicit request may cost money. No additional paid API tests were made during implementation.

After a completed Deep response, the user may edit and explicitly save an understanding. When a saved mode already exists, saving is blocked until the user explicitly chooses that this is a correction to the current mode and accepts retaining its practice/history. Unrelated topics must be cancelled rather than automatically linked; this scope does not create multiple modes. Saving creates a local record in the existing `emotionflow.ef384.native.v1` namespace with the exact submitted input and request ID. It is a user-confirmed understanding, not an automatically identified psychological pattern. New practices require the user to write the cue and action; the old fixed fatigue/self-blame/child example is not attached to new API-derived entries. Cancel/reject/unsure/navigation do not save.

Legacy saved data remains readable without migration or overwrite. Prior immutable facts and source labels remain intact. Changes to understanding append old/new correction history atomically. Practice records retain the source/origin of the practice they actually record, even after a later understanding correction. A legacy practice is not silently relabelled as a new API-derived practice. Editable path feelings/explanations retain their existing behavior. No exception-creation flow is added.

## Verification status at initial review

- Passed locally: 43 Node repository/source-boundary checks and 39 hermetic transport/helper/controller checks using actual TypeScript source with mocked imports.
- Renderer/Jest, complete TypeScript, lint, web export and runtime-data check: prepared for the draft PR workflow; not yet run locally because this workspace is a partial materialization without dependencies. The pnpm shim failed before Jest/bootstrap completed; no dependency installation succeeded.
- Node20 test-harness fallback uses the existing client TypeScript dev dependency; local run used Node24's type stripping. CI must verify the Node20 path.
- Browser/visual, keyboard/responsive, live provider end-to-end and upstream model/fees: Not Run for this candidate. A prior file:// browser-policy refusal was not bypassed or retried through another source. Existing DEV remains unchanged until separately authorized review and deployment.
- The earlier one-message test on the original deployed chat returned visible Deep text but did not attest an upstream provider/model/cost. It is not acceptance evidence for this new candidate.

## Review and release

The feature branch is for a draft PR targeting `dev`; do not merge or deploy without review. Existing deployment triggers remain push-to-dev or manual dispatch, not a feature-branch PR. The verification workflow adds mocked controller/helper tests without weakening existing checks, retains exact-head checkout, read-only permissions, all client tests, type checking, lint, DEV export and runtime-data checks. Review the exact head and CI results before asking the user to hand-test a separately authorized DEV release.

## Follow-up verification after initial draft

At `ca5f6de4de723efce1b954439ab0286da1fe7a33`, the full client Jest run passed 44 suites and 389 tests (17 skipped), and client type checking passed. Lint reported synchronous effect initialization, subsequently corrected locally. That head still had the shared-identity and implicit-mode-association issues found in independent review and was not accepted for merge. The isolation correction must receive its own exact-head full CI, including mocked backend route/provider/profile regressions. No browser or paid request is implied by these checks.

The frozen isolation revision passes 139 local Node checks: 45 repository/boundary, 43 client transport/helper/controller, and 51 actual backend handler/provider/SSE checks with mocked external services. Backend regression CI also covers the existing EM43, EF41, EF102, EF118 and EF75 ownership suites under NODE_ENV=test and builds the backend without deployment. Full exact-head results remain pending until that revision runs.
