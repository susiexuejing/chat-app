# EF-385 DEV primary AI reply

## Scope

The DEV `/demo` route keeps the shared native presentation and isolated `dev-ephemeral-v1` transport. After an explicit send it shows `正在思考`, then one completed, server-validated AI reply. It does not generate or display the previous fixed Reaction / Companion templates, including on greeting and identity questions. The ordinary chat endpoint, ordinary prompts, profile/history/evolution paths, and ordinary greeting templates remain unchanged.

This replaces the previous DEV supplement/shared-front-budget behavior documented in earlier EF-385 notes. It does not change the local pattern/practice/record schema or automatically classify a reply as a psychological pattern.

## Completion and safety

- DEV provider text is still buffered and processed by the existing cleaner. No raw provider stream is shown. The client also buffers validated Deep events until both the successful turn terminal and transport completion, then publishes the complete answer once.
- DEV does not turn `reasoning_content` into a final answer. A reasoning-only, short-discarded or empty result retains the existing empty-completed server behavior and fails on the existing client nonempty-result check. This change does not include the unmerged short/empty-completion repair.
- The DEV-only prompt is a primary response, not a supplement. It truthfully identifies an AI companion, treats current/bounded same-session user messages as the only user facts, and excludes biography, old-session claims, diagnosis, cause attribution, unsolicited advice and automatic pattern saving.
- The full existing 120 Unicode-code-point answer budget is available because no front text is visible. There is no budget expansion. The prompt requests at most two declarative sentences. Existing length and optional-question checks remain.
- The DEV-primary composition flag is server-owned. Raw and candidate factual checks remain. For confused-overload inputs, every sentence must pass the existing stricter declarative, invitation, holding, unsolicited-action and joint-progression gates. If any sentence fails, use the existing acknowledgement fallback rather than silently dropping that sentence. Other ordinary composition behavior is unchanged.
- Stop, end, navigation, new conversation, error, timeout and late callbacks cannot expose a pending answer or save a candidate. The client clears its pending buffer. Same-session history remains at most three completed raw user/validated assistant pairs, 6000 characters, with the fixed 10-minute lifetime and 1000-character current input limit.
- Understanding is volatile until the user explicitly confirms/edits and chooses new pattern or a specific correction target. Practice, record and path actions remain separately explicit. No model response creates those writes by itself.

## Latency scope

- DEV has no artificial 3-second `deepReadyAt` floor. Completed output is eligible for the next existing 100ms publication poll; this does not imply a 3-second saving when provider work takes longer.
- The raw OpenAI-compatible JSON adds top-level `enable_thinking: false` only for DEV, model `qwen3.6-plus` or `qwen3.6-plus-2026-04-02`, and exact base URL `https://dashscope.aliyuncs.com/compatible-mode/v1`.
- All other model IDs, custom/proxy endpoints, alternate paths/query/credentials and ordinary requests keep their prior payload. No wildcard hostname matching, model switch, configuration/credential change or fallback retry is added. Existing `stream: true`, `max_tokens: 1200` and `temperature: 0.6` remain.
- The existing DEV 135-second total acceptance deadline, 60-second header cap, 120-second body cap, client/SSE deadlines and cancel isolation remain. No new telemetry is introduced.
- Supported option references: [Deep thinking](https://www.alibabacloud.com/help/en/model-studio/deep-thinking) and [OpenAI-compatible chat completions](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions). These document the option, not measured performance in this deployment. Live latency and reply quality require separate authorized testing.

## Regression entrypoints

- Existing backend CI `node --experimental-vm-modules --test server/src/__tests__/ef385-dev-ephemeral.test.mjs` imports `devPrimaryReply.test.mjs`, plus budget/prompt/deadline/context/cancellation and ordinary frozen-validator/output parity suites.
- Existing DEV controller/adapter Node tests cover pending answer privacy, full terminal publication, cancellation/error/empty behavior and bounded continuation.
- Actual native React screen/controller/repository tests cover thinking without template bubbles, deferred full reply, editable/unchanged explicit confirmation, relation selection and pattern/practice/record/path isolation. Shared view tests retain ordinary loading text and presentation behavior.
