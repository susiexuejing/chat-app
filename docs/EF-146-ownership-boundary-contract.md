# EF-146 Ownership Boundary and Negative Verification Contract

## Status, purpose, and non-goals

This is the implementation contract for Cell 3's EF-75 ownership work. It
consolidates the evidence currently available to EF-146; it is **not** a claim
that EF-75 or EF-107 has passed. It neither changes an endpoint nor authorizes
runtime, database, Provider, credential, or deployment access.

The contract is fail-closed. A request is authorized only after a server-derived
principal, the requested resource's recorded owner, and every relevant binding
agree. Client headers, query parameters, route IDs, body IDs, browser storage,
and retry metadata are attacker-controlled until the server verifies them.

## Evidence basis and traceability

| Ref | What it establishes | Status |
| --- | --- | --- |
| `origin/dev@792a4a0`, `server/src/index.ts:795-1070` | `chat/start` accepts body `userId` or creates an anonymous fallback; `chat/stream` reads a session by `sessionId` without a principal comparison. | Existing gap; **not EF-75 compliant**. |
| `origin/dev@792a4a0`, `server/src/routes/conversations.ts:62-363` | create/read/list/message-persist/message-list routes use client-controlled identifiers and their queries do not uniformly bind an authenticated owner. | Existing gap; **not EF-75 compliant**. |
| `codex/ef-107-backend-identity-r3@dbcb81b`, `server/src/auth/backendIdentity.ts:21-45` and `server/src/__tests__/ef107-backend-identity.test.ts:13-31` | EF-107 candidate validates UUID form and header/body equality. | EF-107 finding only; **unverified as authentication**. A client-supplied UUID/header/body `userId` is not a trusted principal. |
| EF-75 source material | No authoritative EF-75 design/acceptance artifact was available in the supplied workspace. | **Open/unverified.** |

Every "required" entry below traces to EF-75's ownership-boundary purpose.
Statements specifically about client UUID/header/body identity additionally
trace to the EF-107 finding above. No other historical claim is implied.

## Trust model

### Trusted input (required, unresolved source)

`principal.userId` must be derived server-side from a verified authentication
mechanism (for example, a verified bearer/session credential validated by the
server's chosen identity provider). The exact authoritative identity source,
credential validation mechanism, expiry/revocation behavior, and server
middleware location are **open decisions**. No implementation may substitute a
body field, client header, query value, or generated anonymous ID for this
principal.

### Untrusted input (always attacker-controlled)

- `X-EmotionFlow-User-Id`, `X-EmotionFlow-Conversation-Id`, and every other
  request header not established by trusted server authentication;
- body `userId`, `conversationId`, `sessionId`, `requestId`, message IDs, role,
  retry flags, and idempotency keys;
- route/query IDs, including `:id` and `sessionId`;
- persisted client retry/recovery snapshots and all client diagnostic metadata.

## Ownership-boundary matrix

`owner` means the durable owner stored by the server for the target resource.
Comparison is exact, server-side equality: `owner.userId === principal.userId`.
For a conversation/session relationship, both the owner and bound conversation
must match. The listed status is the required public result; the response must
not reveal whether another owner's resource exists.

| Operation | Trusted principal source | Untrusted inputs | Required owner/binding check | Fail-closed result | Required proof artifact |
| --- | --- | --- | --- | --- | --- |
| Create conversation | Verified server principal | body/header `userId`, role ID, client conversation ID | Ignore/reject supplied owner; persist `principal.userId` only. Validate role independently. | `401 invalid_identity_context` for no/invalid principal; `400` only for non-identity validation. No write. | Two-principal create test proves stored owner is A despite forged B body/header; DB/repository spy proves one A-owned insert. |
| Read conversation | Verified server principal | route conversation ID; supplied owner/conversation header | Query/verify `conversation.id` and `conversation.user_id` against principal before returning conversation or messages. | `401` invalid principal; `404` for absent **or non-owned** ID; no resource fields. | A reads A succeeds; B reads A gets indistinguishable `404`; response/log scan excludes IDs/content. |
| List conversations/messages | Verified server principal | pagination/filter IDs, header/body owner | Every list query has mandatory owner predicate derived from principal; nested message list first verifies owned conversation. | `401` invalid principal; non-owned nested conversation `404`; never return partial cross-owner rows. | Seed A/B deterministic fixtures; A list contains only A; B cannot enumerate A via filters/pagination. |
| Mutate conversation/message | Verified server principal | route IDs, body conversation/message owner, request ID | Resolve target through `id + owner`; enforce immutable owner and conversation binding; update predicate includes owner. | `401` invalid principal; `404` non-owned/missing; no update. | B mutation of A returns `404`; repository spy shows no update; owner field cannot change. |
| Delete conversation/message | Verified server principal | route IDs, body/header owner | Resolve through owner-bound predicate; cascade/child delete must be scoped to the same owned conversation. | `401` invalid principal; `404` non-owned/missing; no deletion. | B delete of A and child-message substitution leave all A records unchanged. |
| Start stream/session | Verified server principal | body/header `userId`, conversation ID, request ID, role/message | Verify principal owns conversation before creating a session; persist session owner and conversation binding from verified values. | `401` invalid principal; `404` non-owned/missing conversation; no session/provider work. | Forged B owner with A conversation creates no session; spy proves no Provider invocation. |
| Consume stream | Verified server principal | `sessionId` query, client conversation header, retry data | Require `session.userId === principal.userId` **and** `session.conversationId === requested/verified conversation binding`. Validate before SSE headers/events. | `401` invalid principal; `404` non-owned/missing/expired session, identical body; no SSE event. | B's session-ID substitution receives no SSE headers/events; A still streams; audit/trace contains categories only. |
| Retry | Verified server principal | request ID, prior session/conversation/message IDs, retry flag | Resolve original pending turn through owner-bound conversation; request ID is valid only within `(principal, conversation, turn)` binding. | `401` invalid principal; `404` non-owned/missing source; `409` only for an owner-valid conflicting replay, with safe code. | A retry reuses A request ID; B replay/substitution cannot read/write A result or trigger provider work. |
| Recovery | Verified server principal | persisted snapshot/session/conversation/request/message IDs | Treat snapshot as a locator, not authority; reload durable record and compare owner/conversation/request binding before recovery. | `401` invalid principal; `404` non-owned/missing; discard untrusted recovery reference without state change. | Cross-user recovered snapshot produces no message/session mutation; valid same-user recovery preserves exactly one turn. |

## Negative-test contract

All tests use deterministic, synthetic principals A and B, fixed resource IDs,
and an in-process repository/session fake. They must not use a real database,
Provider, Coze, DEV, Production, or secrets. Tests must assert both the HTTP
surface and the absence of an unauthorized side effect.

| Attack/negative case | Required assertion |
| --- | --- |
| Forged owner body/header | A valid-looking B UUID in a body/header never becomes the principal. Mismatch is rejected before any repository/provider call. |
| Missing identity | Each operation returns `401 invalid_identity_context`; no lookup that could reveal resource existence, no write, no SSE start. |
| Malformed/invalid identity | Reject malformed credential/principal with the same safe `401`; do not echo the value. |
| Expired/revoked identity | Authentication layer rejects before owner lookup. The exact status/code is an open identity-source decision, but it must be stable, non-enumerating, and non-success. |
| Principal/body/header mismatch | `401 invalid_identity_context`; no fallback to either client value. |
| Cross-user substitution | For every matrix operation, B substitutes A's conversation/session/message/request ID. Read/list/mutate/delete/stream/retry/recovery must neither disclose nor change A's data. |
| Idempotency binding | Same request ID is idempotent only for the same verified principal and conversation/turn. Cross-user or cross-conversation replay is not a replay of another owner's result. |
| Session/conversation binding | A session ID is usable only with its durable owner and conversation. Swapping either ID fails before SSE or provider work. |
| Privacy/diagnostics | Denials contain only stable safe codes. Assertions scan JSON, headers, SSE, logs, and diagnostic serialization for no raw user/session/conversation/request/message IDs, message text, credential, error message, or stack. |

## Failure semantics and evidence requirements

1. **Order:** authenticate -> validate principal -> resolve owner-bound target ->
   apply operation. Do not query an unscoped target first.
2. **Public behavior:** `401` is reserved for invalid/missing principal; `404`
   is indistinguishable for missing and non-owned resource/session. No owner,
   existence, query, credential, or stack detail is returned.
3. **No side effects:** failed ownership checks create no session, queue item,
   retry, message, provider request, stream response, or audit record with raw
   identifiers. A categorized, sanitized audit event is permitted.
4. **Deterministic fixtures:** test IDs and timestamps are fixed synthetic
   values; each case independently seeds A/B resources and verifies both before
   and after state. No test may rely on process-global session leftovers.
5. **Required evidence:** Cell 3 supplies the exact canonical command, complete
   test inventory with passed/failed/skipped counts, raw test output, changed
   paths, candidate/base/parent SHAs, clean status, and a diff check. A passing
   assertion alone is insufficient; repository/session/provider spies must
   prove denial occurred before the side effect.
6. **Traceability:** each test name includes its operation and one of
   `EF-75-owner-boundary` or `EF-107-untrusted-client-identity`. Tests based on
   unresolved decisions must be labelled pending rather than claimed passing.

## Not authorized / unresolved decisions

1. **Authoritative principal source:** no approved server authentication source
   is available in the evidence. Cell 3 must stop for CTO/PM direction before
   selecting a cookie, bearer token, gateway assertion, or identity provider.
2. **EF-75 acceptance source:** the actual EF-75 artifact was unavailable. This
   document specifies the minimum ownership contract but does not claim it is
   the complete original EF-75 scope.
3. **Identity expiry/revocation semantics:** exact credential lifecycle and
   error code are unresolved; only fail-closed, non-disclosing behavior is
   required here.
4. **Deletion/retry/recovery endpoints:** no authoritative route/contract was
   found in the inspected baseline. Their matrix rows are implementation
   requirements, not evidence of existing coverage.
5. **EF-107 status:** EF-107 is not represented as passed. Its UUID/header/body
   validation finding is insufficient authentication because a caller controls
   those values.

## Unique next action

**Cell2 CTO Management:** provide the approved, server-verifiable principal
source and the authoritative EF-75 acceptance artifact. Until both are supplied,
Cell 3 must not implement owner checks or treat client IDs/headers as identity.
