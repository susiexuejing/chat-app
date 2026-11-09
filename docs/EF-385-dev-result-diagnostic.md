# EF-385 temporary DEV result diagnostic: retirement

## Status and evidence

This change removes the temporary runtime, observer-only validator hook, private operator and extra backend build entry. It is a normal follow-up to [PR170](https://github.com/susiexuejing/chat-app/pull/170), under [EF-385](https://douhaoyu.atlassian.net/browse/EF-385). It also contains the separately registered, narrow DEV prompt correction described below. Neither the retirement nor the prompt correction is claimed to be deployed; merge, CI and deployment must still be verified through the normal release process.

PR170 was deployed as `5dd8aa1557bfe673eca659f4fdad419263ec9f37`, tree `33d6ece0b88a68a59d05727adea33ff9dc8f3e24`. The coordinator reported two separately and explicitly authorized one-request diagnostic windows on this build:

- **First window, 2026-11-08:** one manually armed window and exactly one purposeful fictional T1 request. The private receipt was `captured`, with `selection=cleaned`, `validation=accepted_plain`, and `finalClass=other`. Successful read-clear was reported at **2026-11-08T23:48:10Z**, with both fixed-path absence checks exiting 0.
- **Second window, 2026-11-09:** a separately approved, manually armed window containing exactly one fictional photography T1 request. The captured receipt reported `selection=cleaned`, `contentClass=other`, `cleanedClass=other`, `candidateClass=other`, `validation=question_fallback`, and `finalClass=exact_ack`. Successful read-clear and both fixed-path absence checks were reported at **2026-11-09T00:10:13Z**. Browser QA then ended the conversation and logged out by **2026-11-09T00:11:42Z**.

These private receipt and host cleanup facts were supplied by the coordinator, not inferred from browser observations. No raw provider text or question text is recorded here.

In the first window the browser separately observed content-specific Deep and a completed turn, followed by local end/new-chat/logout cleanup by 23:49:04Z. Within that bounded diagnostic workflow, no T2/T3, retry, control request or saved understanding was performed. Separately authorized QA without arming later completed three fictional photography rounds, each showing the exact acknowledgement. Those three turns were outside both one-request diagnostic windows.

The first sample does not identify the cause of PR169's earlier generic acknowledgement or establish a causal semantic improvement. The second sample establishes only that its selected non-acknowledgement candidate reached the existing question gate and became the exact acknowledgement. It does not reveal the question's text or count, or prove that the earlier three turns took the same branch. Those earlier causes remain unknown. No additional diagnostic window is authorized by this document.

## Narrow DEV prompt correction

EF-385 registration/readback was reported at **2026-11-09T08:12:13.872+08:00** before this local implementation. Only the DEV branch of the first-turn-style Deep prompt replaces the optional-question instruction with `用陈述句自然承接，不要提问。`. This applies both to DEV T1 and later DEV turns that retain the existing entry-turn safety path. Ordinary-chat prompt bytes remain unchanged.

The intent is to request a declarative continuation consistent with the existing guard. It does not guarantee provider compliance or useful output. The existing question validator is not removed, tightened or relaxed: a single optional question can still pass, while a non-optional question or multiple questions can still fall back. Factual-source rules, visible-length budget, context bounds/lifetime, cleaner, candidate admission, model parameters, request count and persistence are unchanged. No retry, model call, telemetry or PR167 short-content/empty-terminal behavior change is added.

## What removal preserves

- `server/src/index.ts` and `server/src/flows/ef41DeepCompositionValidator.ts` return byte-for-byte to the pre-diagnostic b9568a6 versions. No cleaner, admission condition, validator regex/threshold/order/output, stream terminal, context, ordinary chat, provider parameter or request count changes.
- `server/build.js` returns byte-for-byte to its prior single `src/index.ts` entry and existing options. The temporary `dist/ef385DevResultOperator.js` entry is removed. No workflow, dependency, permission, credential or public route is changed.
- Apart from that diagnostic retirement, the DEV-only instruction in `server/src/flows/deepSystemPromptBuilder.ts` is the sole intentional production behavior delta from the pre-diagnostic version. All other production files in the materialized snapshot remain byte-equal to that reference.
- Both temporary production modules and their private filesystem test harness are deleted. No live recording, polling, arming, operator command or validator observer remains.
- The exact frozen validator fixture and normal single-argument output-parity tests remain. Normal registered-handler regressions retain short-content admission, empty-completed terminal, selection priority, factual/question/budget behavior and no extra model-call assertions. PR167's excluded behavior changes remain excluded.
- Existing EF118/EF45 code and old logs remain untouched. This change does not read or delete an old audit file or adjust existing directory permissions.

The normal clean CI build must verify that its artifact has no standalone diagnostic helper. Existing deployment uploads `server/dist/` with `rsync --delete`; no alternative access or custom cleanup workflow is introduced. An old local `dist/` directory is not evidence of a clean release artifact. The removal worker performed no host operations or additional model requests.

## Historical bounded diagnostic contract

The following records the retired PR170 contract for audit history; it is not an active operating procedure. Do not re-arm or run the retired helper.

The diagnostic was default off and limited to `NODE_ENV=development` plus the server-created immutable `dev-ephemeral-v1` request mode. Each explicit arm lasted at most five minutes from arming, shortened by the immutable **2026-11-10T00:00:00Z** hard stop. Nothing extended that window. It added no HTTP route, frontend switch, EF45 marker, provider message, automatic model call or persistent access.

Only these two private paths were used, with 0600 files and no changes to the existing directory:

- `/var/log/emotionflow/ef385-deep-result.arm`: empty manual signal.
- `/var/log/emotionflow/ef385-deep-result.json`: one receipt, at most 4096 UTF-8 bytes.

The envelope contained only `deploymentSha`, `armedAt`, `expiresAt`, `observedAt`, `windowState`, and `result`. The state was pending/captured/incomplete/ambiguous; only a captured result held these six closed fields:

| Field | Historical closed literals |
| --- | --- |
| contentClass | empty, exact_ack, other |
| cleanedClass | empty, exact_ack, other |
| selection | none, cleaned, last_resort, reasoning |
| candidateClass | not_selected, exact_ack, other |
| validation | not_called, passthrough_later_turn, accepted_plain, accepted_ef41_sentence, accepted_ef41_default, raw_fact_fallback, empty_candidate_fallback, budget_fallback, post_selection_fact_fallback, question_fallback |
| finalClass | empty, exact_ack, other |

No content, reasoning, prompt, errors, identity, marker, request/session/conversation/owner ID, content hash/length, model/role/IP or environment dump was stored. Result classes did not alter actual output. The validator observer recorded the first decisive branch, not equality-based inference. The final class represented processing before `deepDone`, not independent proof of UI/SSE completion.

One local invocation could produce one tuple. Pre-existing or competing eligible activity made the receipt ambiguous; multiple backend processes or missing/expired/mismatched evidence required stopping rather than adding identifiers or retrying. Safe-file checks rejected symlink/hardlink/nonregular/ownership/access problems without repairing permissions. Read-clear validated and removed the artifacts before printing; failures produced no raw output.

Expiry and startup cleanup did not guarantee physical deletion while the process/host was stopped or filesystem access failed. Logical expiry was never described as physical erasure. After each of the two completed windows the coordinator explicitly verified both paths absent. The latest absence check preceded this combined local candidate. No claim is made about upstream/provider or billing data deletion.

## Verification and remaining release gates

Normal hermetic tests preserve the frozen validator's output bytes and the registered handler's existing behavior, without diagnostic hooks or storage. Focused tests exercise the actual prompt builder and registered provider request construction for DEV T1 and bounded-context later turns, ordinary prompt bytes, unchanged question/factual/length enforcement and no extra calls. Mocked responses do not demonstrate live response quality. Retirement checks verify absence of the temporary modules and build entry. Production-byte comparisons, excluding the single declared prompt delta, are one-time release evidence, not a permanent full-file SHA requirement. Tests make no live provider calls.

Native TypeScript stripping is execution, not a full type check. Full Jest, TypeScript, esbuild and exact-head release CI remain the normal release gates in an installed full repository. After merge/deployment, verify the combined candidate's deployed SHA and clean build artifact through the established release process. Any authorized live QA must evaluate response quality separately; the local tests do not close that question. Do not reintroduce or extend the retired diagnostic to gather more samples.
