# EF-385: bounded, same-session DEV context

- Jira registration and acceptance criteria: https://douhaoyu.atlassian.net/browse/EF-385
- Current journey: https://douhaoyu.atlassian.net/wiki/spaces/PM/pages/398786561
- Existing contracts: https://douhaoyu.atlassian.net/wiki/spaces/PM/pages/394067997 and https://douhaoyu.atlassian.net/wiki/spaces/PM/pages/394526729
- Exact deployed base: `61a69dae9baeab1d9aa0f2e03d79326312d60e21`.
- Scope was registered before code changes. This is a separate feature, not PR167 or a release/admission change.

## User-visible behavior

DEV `/demo` now allows sequential, explicit sends in the same conversation. Successful nonempty Deep plus the successful protocol terminal enables the next send. Input editing, login, navigation, reopening, reset, failure and completion never auto-send or retry. Composer text and any edited understanding are discarded only after the controller accepts a send and publishes `starting`, or on the existing end/failure/expiry cleanup paths. A retryable request-ID preflight failure keeps both drafts available and does not call transport. Only the last three prior completed turns are displayed alongside the current turn in the shared chat views.

The model may receive at most the three most recent successfully completed raw user/final-Deep pairs, in separate `user`/`assistant` roles. Their combined JavaScript `String.length` is capped at 6000 characters. Eviction removes whole oldest pairs; a single oversized pair is excluded without deleting otherwise valid retained pairs. There is no summary or clipped paraphrase. The current input remains capped at 1000 characters and is not included in the 6000 prior-context budget. A closed, failed, cancelled or incomplete turn is never reusable.

The screen discloses these limits, the absolute ten-minute conversation lifetime, fictional-input requirement, API cost possibility, and best-effort cleanup. A reply may use current-session context, but no semantic-grounding or upstream supplier/model/cost claim is made from the tests.

## Closed wire contract and ownership

`POST /api/v1/chat/dev-journey/start` keeps the explicit `dev-ephemeral-v1` mode and exact DEV/development guards. A first send accepts only `requestMode`, `roleId: clever-fox`, `message`, and `requestId`. A continuation additionally requires the server-issued `devConversationId` and the immediately preceding successfully completed `afterRequestId`. The server, not the client, owns the turn number and prior text. All other fields, including user/account IDs, history, summaries, local patterns and durable conversation IDs, are rejected.

A successful receipt adds `devConversationId`, `userTurn`, server `expiresAt`, and `remainingLifetimeMs` to the existing response. Client continuation state exists only in the current controller/component memory. It is never written to local/session storage or placed in route parameters. The client validates string IDs, finite bounded lifetime, unchanged server conversation/expiry on continuation, and affirmative mode receipt. No downgrade to ordinary chat is attempted.

The existing anonymous authentication remains mandatory; start and end retain CSRF enforcement. Ownership is checked before continuation or stream admission. Fake local accounts are not authentication principals and their IDs are never sent. Local account/repository validity is checked before an explicit send. Storage account-boundary events clear the mounted conversation/drafts; route navigation, logout and pagehide also retire it. Ordinary browser focus loss does not end a conversation. The existing single-active-tab local pattern repository is not converted into a concurrent-write system. Use one active chat tab for this Demo. The conservative pre-send revision check also resets context after an unrelated same-account pattern write in another tab, even when login identity is unchanged. That reset shows a notice, preserves saved data, and requires a new explicit input/send; no login-generation or concurrent-tab feature is added.

A request ID is `${clientEpochMilliseconds}_${randomUUID}` (maximum 100 safe characters). It is freshness metadata, not identity or a credential. Server checks reject age at or above ten minutes and future skew greater than five minutes, before and after authentication waits. Server conversation expiry is always ten minutes from the first request's server arrival; a future client timestamp cannot extend it. Client timers use the server remaining duration, not server expiry minus client wall time. The server remains authoritative; clock independence is not claimed. Expiry/clock rejection is shown safely and never triggers an automatic regenerated request.

## Lifecycle, replay and resource bounds

Only one accepted turn and one SSE attachment may be in progress. Duplicate IDs, overlap, stale anchors, foreign owners and ended/expired IDs fail closed before additional provider work. Successful context is committed only at the server terminal boundary. Per-turn source and output references are then removed, leaving only the bounded pair window.

`POST /api/v1/chat/dev-journey/end` accepts only `requestMode` and `requestId`, with existing auth/CSRF. The owner/request index locates the conversation even if Stop happened before the start receipt arrived. Cancellation can create a no-text tombstone before a delayed start. Tombstones/replay markers are owner-scoped, keep no input or output, and expire no earlier than the request timestamp plus ten minutes, including accepted future skew. Capacity is 64 live request markers per owner and 2048 globally; overflow rejects rather than evicting a live marker. Expired indexes are swept. Exact replay within the freshness window is blocked; a deliberately changed timestamp/UUID is a new request, not a replay-protection guarantee against arbitrary resubmission.

New Chat, explicit end, stop, failure, timeout, logout, actual navigation, pagehide and unmount revoke local callbacks, clear conversation/draft references and attempt authenticated end. Failure also invalidates server context without requiring SSE attachment. Incomplete DEV SSE response close invalidates context; a successful terminal's normal close does not. Late provider results cannot restore closed context. End and stream access perform authoritative expiry checks, and each active conversation has one cancellable expiry timer, with a periodic memory sweep as a backstop. The timer checks the exact conversation object before cleanup, so a stale timer cannot close a newer conversation. Timer execution can be delayed by event-loop scheduling; access-time expiry checks remain authoritative.

Abrupt browser termination, network failure or failed end delivery cannot guarantee immediate remote cleanup. The server absolute expiry bounds reuse. Removing application references and best-effort abort/cancel does not promise physical memory erasure, provider deletion, stopped upstream work or stopped billing.

## Safety and unchanged paths

DEV isolation is independent of actual turn count, including turn three and later. It never acquires neural/profile/FlowChange/LTU/evolution or persisted-conversation state, and never writes those systems, including asynchronous provider completion or SSE close. It continues the existing entry-turn prompt/validator and local front-layer safety behavior rather than entering ordinary later-turn persona/biography logic.

Only narrow DEV prompt truthfulness changes: the displayed turn is accurate and the factual source can include the bounded current-session user words. Assistant text can supply conversational continuity but never becomes a user fact. The validator's allowed fact source is only retained user messages plus the current user message; intent/overload classification still sees the current input alone. Lexical history, persona, unsupported-fact, question and length gates remain in place. These gates are conservative checks, not proof of all semantic grounding. Ordinary prompt/validator and chat behavior remain unchanged.

Existing explicitly saved patterns and practice/path history remain intact. Confirmation still requires the current completed reply, an editable understanding and explicit destination/version choice. It saves only the selected current input/request ID and user-confirmed understanding, never the complete multi-turn transcript. New source labels truthfully mention possible same-session context. Unsaved drafts clear on failure/expiry/end/logout; no automatic psychological-pattern logic or save is added.

## PR167 separation

The denied PR167 short-content cleaner/admission fix and ordinary/global empty-terminal repair are not included. The exact short content-only `我听到了。` is still discarded by the deployed cleaner before validation. Empty/short output still emits the baseline `deep.completed` and `turn.completed` events on both ordinary and DEV routes. The existing client rejects empty Deep. The only additional same-session action is clearing DEV context and refusing continuation, without a new empty-output error terminal, provider classification or retry. Consequently the known PR167 user-visible limitation remains, and this feature is not evidence that PR167 is fixed or mergeable.

## Verification

Existing CI already invokes the expanded EF-385 backend suite, all DEV controller/helper/adapter `.test.mjs` files, repository guards, all client Jest tests, client typecheck/lint, DEV export, selected existing backend Jest contracts, backend build and runtime-data check. No workflow, release gate, admission registry, branch protection, deployment trigger, credential or access setting is changed.

Local Node24 offline results and artifact identities are supplied with the candidate manifest. Tests use actual source with hermetic provider/auth/clock/storage mocks and explicitly identify mocked stream serialization. They are not real transport/browser/model evidence. React/Jest, full semantic typecheck/lint, web export/build and complete runtime-data checks remain Not Run locally because this is a verified partial source materialization without dependencies. No installation bypass, file-origin browser bypass, live API call, real-user data, remote push, PR, merge or deployment is part of these local results.
