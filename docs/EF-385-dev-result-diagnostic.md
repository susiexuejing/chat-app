# EF-385 temporary DEV result categories

This is a diagnostic, not a semantic-response fix. PR169's earlier single fictional T1 returned only “我听到了。”; its cause remains unknown. No retrospective attribution is possible. The pure-short-content admission rule, empty-completed terminal, validator outputs, model request/body/count, ordinary chat, persistence and public interfaces remain unchanged.

The scope was registered in [EF-385](https://douhaoyu.atlassian.net/browse/EF-385) before implementation. The immutable hard stop is **2026-11-10T00:00:00Z**. A manual window lasts at most five minutes from the empty arm file's modification time, shortened by that hard stop. No event, polling, completion or repeat arm extends a live window.

## Private mechanism

Only `NODE_ENV=development` and the server-created immutable `dev-ephemeral-v1` mode are eligible. There is no HTTP route, frontend switch, EF45 marker, new workflow, credential, permission change, provider message or automatic model call. The module is inert on import. Its runtime factory starts fixed-path polling only on DEV with a valid full runtime `GIT_COMMIT` supplied by the existing deployment. With no arm it creates no records. DEV startup invalidates and clears prior safe diagnostic artifacts.

Only these two fixed files are used:

- `/var/log/emotionflow/ef385-deep-result.arm`: empty manual signal, exclusive creation, 0600.
- `/var/log/emotionflow/ef385-deep-result.json`: one receipt, at most 4096 UTF-8 bytes, 0600.

The existing directory must already exist, be owned by the runtime/operator process UID, have no group/other write access, and have safe non-symlink ancestors. Existing 0700/0750 directory modes work. File symlinks, hardlinks, nonregular files, unexpected owners or permissions are rejected without changing them. No old EF118 log is read, deleted or modified. Failure is silent and cannot change chat. A failed helper exits nonzero; do not infer that cleanup succeeded.

The only envelope fields are `deploymentSha`, `armedAt`, `expiresAt`, `observedAt`, `windowState`, and `result`. Times are ISO UTC window/retention metadata. `result` is null for pending/incomplete/ambiguous, or exactly:

| Field | Closed literals |
| --- | --- |
| contentClass | empty, exact_ack, other |
| cleanedClass | empty, exact_ack, other |
| selection | none, cleaned, last_resort, reasoning |
| candidateClass | not_selected, exact_ack, other |
| validation | not_called, passthrough_later_turn, accepted_plain, accepted_ef41_sentence, accepted_ef41_default, raw_fact_fallback, empty_candidate_fallback, budget_fallback, post_selection_fact_fallback, question_fallback |
| finalClass | empty, exact_ack, other |

`exact_ack` compares to the existing neutral acknowledgement after trimming for classification only. Actual output bytes are unchanged. `contentClass` precedes cleaning; `cleanedClass` observes its return. `selection` and `candidateClass` refer to the actual selected validator input. `validation` is the first decisive real validator branch, not inferred from output equality. `finalClass` observes joined Deep chunks just before `deepDone`, not UI/SSE completion. `empty_candidate_fallback` is not reachable after the present handler's nonempty admission, and `passthrough_later_turn` is not a DEV outcome because DEV retains entry-turn validation; differential tests still cover both validator branches.

No content, reasoning, prompt, errors, identity, marker, request/session/conversation/owner ID, content hash/length, model/role/IP, or environment dump is stored or printed. Whitelisting reconstructs objects and rejects unknown fields/literals, accessors, incorrect deployment or invalid window metadata. The operator reads at most 4097 bytes and never prints malformed data or raw errors.

One tuple comes from one local invocation closure. Another eligible invocation in the live window makes it ambiguous, including a request already in flight when arming occurs. No IDs are introduced. File inode checks only protect cleanup ownership in memory and are never serialized. Clear/read-clear revokes late writes. Old timers cannot delete a newer explicit arm or replacement receipt. The helper cannot prove which browser sent a request, and multiple backend processes are an operational stop condition, not an invitation to correlate by timing.

## Build and deployment

The existing `server/build.js` adds exactly one standalone entry, yielding `dist/ef385DevResultOperator.js`; `dist/index.js` and its options stay unchanged. The helper imports only the private module and its pure DEV-mode constant, never the server entry. It does not load dotenv, listen on a port or start chat. Existing `deploy-dev.yml` already uploads all `server/dist/` and supplies runtime `NODE_ENV=development GIT_COMMIT="$DEPLOY_SHA"`. That workflow is unchanged.

## Bounded operator procedure

The prior WorkBench tab/session was unavailable. Restore and verify the existing authorized WorkBench session normally before live operations; log in only if reopening requires it. Do not introduce another access route. No host operation or live model call was performed during this implementation.

1. Verify this diagnostic's deployed frontend/backend full commit SHA, the existing single backend process and no known competing DEV activity using the existing approved non-secret checks. Never dump the environment or full process metadata. Set `EXPECTED_SHA` explicitly to that verified 40-character lowercase build SHA. The CLI validates this explicit metadata's syntax; it does not independently attest deployment. The runtime writes its own `GIT_COMMIT`, and read-clear must match it exactly.
2. Run from the normal deployed server directory under the already authorized identity. Check exit status for each command:

   ```sh
   node dist/ef385DevResultOperator.js clear
   test ! -e /var/log/emotionflow/ef385-deep-result.arm && test ! -L /var/log/emotionflow/ef385-deep-result.arm
   test ! -e /var/log/emotionflow/ef385-deep-result.json && test ! -L /var/log/emotionflow/ef385-deep-result.json
   NODE_ENV=development node dist/ef385DevResultOperator.js arm "$EXPECTED_SHA"
   ```

   Arm is silent. It refuses any live arm or existing receipt instead of extending it. Expired empty safe arm files may be removed before a new explicit arm. A receipt requires explicit clear/read-clear first. Never arm before server startup cleanup has finished.
3. Only under the coordinator's bounded QA decision, make the one purposeful fictional T1 send on the official DEV page. No provider control request, automatic retry, extra sample or content padding is authorized by this helper.
4. Promptly read and clear:

   ```sh
   NODE_ENV=development node dist/ef385DevResultOperator.js read-clear "$EXPECTED_SHA"
   ```

   Only a validated unexpired envelope is printed. Files are cleared before printing; if cleanup fails, no receipt is printed. Pending, incomplete or ambiguous receipts do not establish a cause. Missing, expired, mismatched or competing-process evidence is **not attributable**. Stop rather than adding identifiers or repeating the paid request.
5. Verify both fixed paths are absent with the two `test` commands above. If read-clear failed, use explicit `clear`, then verify. Never use `cat`, directory dumps or the old EF118 file. Clear/read-clear ends a window; no automatic rearm occurs. Any further attempt is a separate coordinator decision.

## Expiry and removal

Running timers clear an unused or captured window at its original deadline. Startup clears stale safe diagnostic files. After expiry the helper will not return data; completion cannot restore it. File replacement, failed access or disk failures may prevent cleanup, and application timers cannot physically delete anything while the process or host is stopped. Logical invalidation is not guaranteed physical deletion during an outage. Startup/manual verification is required; retain a cleanup blocker if host access is unavailable.

After bounded QA, verify both new files are absent and remove the diagnostic through a normal follow-up release. Remove the runtime calls, observer-only hook if no longer needed, module/helper and extra build entry, while retaining relevant unchanged-output regressions. Do not remove old logs or repair directory permissions. The absolute deadline cannot be renewed without a separate reviewed scope change.

## Verification limits

Node 24 hermetic tests exercise real validator parity, registered handlers with mock providers, injected private filesystem/timers, operator validation and build-entry configuration. They make no live model calls. Native TypeScript stripping is not type checking. Full Jest, TypeScript, esbuild and normal exact-head CI still require the installed full repository/CI environment; no dependencies were installed for this partial materialization.
