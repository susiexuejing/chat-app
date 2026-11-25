# EF-394 / EF-395 offline checkpoint

This directory contains isolated QA code and tests. It is not mounted in
the default product and contains no provider SDK, actual credentials, live phone
or OTP, or deployment step. The optional protected DEV runner uses only
synthetic identities and in-memory storage. Use Node and install the pinned test
dependency without lifecycle scripts. Run `npm test` from this directory.

- The DEV budget is bounded and durable. The challenge is bound to run,
  release, phone HMAC and private browser-binding HMAC. It claims each check
  once and fails closed on provider ambiguity or missing correlation.
- Fake successful verification can create a session atomically. The database
  keeps pseudonymous identifiers and score pairs, not the raw phone, OTP,
  session, browser binding or submitted answers. Same-submission retries
  recover the original receipt, and other accounts cannot read the report.
- The unmounted HTTP transport is default-off and requires caller-verified
  ingress. It test-drives exact routes, same-origin writes, scoped secure
  HttpOnly cookies, and distinct authentication and temporary errors. It
  does not create a Node listener, proxy rule, runtime or vendor adapter.
  Cookie Path is not a boundary between applications on the same origin.
- The approved question bank was extracted from the original 93-question source.
  The prompt and A/B options retain the source order. Four separately parsed
  native scoring tables agree with the converted document. The independent
  canonical map digest is
  25fc15e2291513d24034b2ae226e33f260b0385462a84984dffbc416c4bdb21c
  (compact JSON array of {id,a,b}, numeric ID, sorted by ID).
  The adapter converts ID-based choices into the canonical order and refuses
  duplicates, missing questions or invalid choices. A tie is represented
  without a forced preference or four-letter type. The source's introductory
  claims and sixteen report blurbs are not part of this import.

Remaining work: independent product page wiring and user-facing reporting,
compatible target-runtime testing, server-supplied ingress/binding wiring,
a browser-bound repeat-send intent and verified production security review before enabling a provider, and an
independent same-version DEV browser test under separately verified approval.

The challenge send payload takes an opaque 32-hex `requestId` generated once
for a single explicit send action. Reusing it never reserves a second unit or
dispatches a second upstream request, even if a first-response cookie was
lost. Only a matching browser binding and phone can recover an already
confirmed, still-pending challenge for that ID. The UI must keep the same ID
during uncertainty, not create a new ID on retry. A timed-out provider
response is not success or proof of non-delivery; the internal challenge ID
is already stored as OutId before dispatch. In future separately approved
live QA, operators can use the provider's read-only sending records to look
up that exact OutId; an empty early search does not authorize a new send.
[Alibaba Cloud sending records](https://help.aliyun.com/zh/pnvs/user-guide/sms-authentication-service).

The unmounted UI state controller uses a separate completion step even for an
authenticated retake. The old report stays visible until a new save is
confirmed; cancellation before a write does not change it. Retrying an
ambiguous save reuses the same submission and choices. Without account
identity proof after authentication expires, the controller does not submit
the suspended payload under a new session. The controller is used by the
loopback-only Expo screen; browser behavior is not established by unit tests.

## Local Expo account rehearsal

The normal app and static test demo remain the default. For an opt-in,
loopback-only candidate, export the client from the repo root:

```sh
cd client
EXPO_OFFLINE=1 EXPO_PUBLIC_TESTS_DEMO=1 EXPO_PUBLIC_TESTS_DEMO_BASE_PATH=/ceshi \
  EXPO_PUBLIC_TESTS_ACCOUNT_OFFLINE=1 pnpm exec expo export --platform web --output-dir dist/tests-account-offline
```

`node server/qa/ef394-pnvs-offline/quiz-loopback.mjs client/dist/tests-account-offline`
serves a built export only on 127.0.0.1 under a random localhost port and uses
an in-memory database and fake SMS only. The client refuses non-localhost.
No credentials or connection to DEV are used. The approved prompts and option
labels are projected to the browser, without the scoring map. The report is
masked on background/restore and revalidated; the guest draft is separate.
Run `quiz-browser-local.mjs` against that build with the repository-pinned
Playwright on a supported executor. It differentiates normal navigation from
an actual `pageshow.persisted` restore; a condition not observed is Not Run.

### Consent fixture, not a public policy

Both synthetic sign-in branches show the same first-verification account
effect; the consent checkbox is initially clear. The offline account API will
not claim a challenge, contact a provider or create a session when assent is
absent/false. Only verified, assented first creation writes `local-offline-v1`
and the database time in the fixture account row. An existing account retains
the original fixture receipt. This mark and the QA copy do not establish
agreement to public terms. Approved user agreement and privacy text, exact
working public destinations/versions, and the actual consent mechanism are
separate release prerequisites. Never publish the fixture wording as policy.

### Optional protected DEV QA mode

The separate Expo build requires the same flags as the loopback mode plus
`EXPO_PUBLIC_TESTS_ACCOUNT_PROTECTED_DEV=1`. Its client only accepts the
existing HTTPS `/ceshi/` location. The synthetic server and outer access
gate are not enabled by an ordinary deployment. Both bind loopback; the
gateway protects the document, assets and API before forwarding. Configuration
and credentials must stay outside Git and build artifacts. The gate expires
within 15 minutes and is for an authorized QA operator only. A rollout needs a
separately scoped activation, validation of anonymous denial for assets and
API, and an independently verifiable rollback. Do not enable synthetic auth
for real users. The PR-only browser test runs against the localhost mode and
does not certify the live DEV edge.
