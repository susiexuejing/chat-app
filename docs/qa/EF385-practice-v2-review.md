# EF-385 default-off single-source practice v2

Base: dev d29aabde47bf1ac333590e4aae2c933d83db2ca1, after real QA in Jira EF-385 comment 13360.

## Implemented
- A separately negotiated `dev-reply-practice-v2` retains a narrative and one generated cue/action object. The server projects the visible exercise segment from that same object, and both client schema/controller check the canonical equality.
- Both narrative and complete visible reply pass the existing unchanged output validator; any refusal, rewrite or length failure rejects the v2 output. No action is appended after validation.
- `discoveryText` is the narrative before exercise projection. The editable discovery preview uses it rather than copying the canonical action into a pattern. It remains unverified AI understanding, not a proven user fact.
- Correction and refusal/exit are separate evidence fields. A correction with fresh current-user request no longer automatically vetoes v2. Refusal, missing permission or unmatched quotes still fail. This fixes a representational defect, not the established cause of the observed no-card turn (which remains unknown).
- Status says “回复已接收”, not “本轮已完成”. No auto-save, auto-start, auto-retry or extra model calls.

## Disabled by default
Server `DEV_PRACTICE_V2=1` and client `EXPO_PUBLIC_DEV_PRACTICE_V2=1` are explicit opt-ins. No settings are enabled in this PR. V2 requests on a disabled server explicitly negotiate v1 fallback. V1 behavior remains unchanged. No merge, deployment or real request performed for this work.

## Verification
- Client focused original node suites: 90/90; real component under mocked RN audit runtime: 81/81.
- Server existing aggregate: 1211/1211; em43: 69/69; server TypeScript passes. New v2 cases enter the existing CI aggregate.
- Independent client review reran 90 tests and separately checked v2 success -> v1 success -> reset, no discovery text retention. Full repository CI must pass before release readiness; local complete client tsc is blocked by incomplete snapshot/platform dependencies.

## Not solved / not acceptance
- The existing validator is not a general exercise-safety classifier; after turn 2 it accepts outputs unchanged. A regression deliberately demonstrates that a direct-sending bad instruction may still pass. No claim that unsafe instructions are blocked.
- The canonical exercise segment/card are exactly identical, but free narrative may still violate instructions and contain another action or an empty promise. This is not proof of complete semantic consistency.
- A model-null ordinary response may still promise but not deliver a practice. No blanket null-as-error rule was added because ordinary chat and legitimate refusal need to work.
- Model labels remain fallible. No claim that real correction follow-up now generates a suitable candidate, nor any inference about the prior missing-card stage.
- No real-model effectiveness, stable generation, crisis evaluation, or real-user release approval. EF-385 and EF-353 must not close on these tests alone.
