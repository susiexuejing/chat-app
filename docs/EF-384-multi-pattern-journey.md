# EF-384: multiple local patterns with scoped details

Implementation target: https://douhaoyu.atlassian.net/browse/EF-384

Related contracts: EF-379 (per-pattern path), EF-381 (list), EF-382 (detail), EF-378 (practice).
User journey: https://douhaoyu.atlassian.net/wiki/spaces/PM/pages/398786561/EmotionFlow+MVP+User+journey

Base: `0bd318b6a4c3e467ae7bdd617995c97072a63ab3` (deployed PR #162).

## Scope

- Keep the original chat and the existing DEV explicit-send transport unchanged. No new model call, backend route, credential, permission, outbound field, or deployment setting is introduced.
- Keep `/demo` as the existing route and only `聊天 / 我的` in the bottom navigation. `我的` contains the pattern-list entry and account information. Selecting a stable pattern ID opens its detail, with short current understanding, optional existing clues, that pattern's practice and inline path.
- Use restrained orange/green emphasis. The user's structural sketch is not a pixel or copy specification. Its sample names, dates, records and extra account rows are not seeded or added.
- After a completed DEV reply, the user explicitly chooses to create a new pattern or correct a named existing pattern. No default association, automatic mode extraction, or saving of dismissed drafts. Correction captures the selected ID and version and retains that pattern's practice/history.
- Reads and writes use the current account and explicit pattern ID. Changes to A's name, understanding, practice, records, path explanations/feelings or links do not change B. Unknown/missing/foreign IDs fail rather than falling back to another pattern.
- Practices may be saved separately, but only one is active across the account. New practices are initially inactive. A user must explicitly pause an active practice before starting another; saving B never silently pauses A. No reminders are added.
- Existing facts, origins, understanding corrections, and explicit exception entries remain readable. The UI shows only stored clues; absent source/confirmation metadata stays unknown. No new exception-creation or automatic inference feature is introduced.

## Storage migration and recovery

The original `emotionflow.ef384.native.v1` key is retained byte-for-byte. The new aggregate is stored at `emotionflow.ef384.native.v2` with `schemaVersion: 2`, separate pattern states and a single active-practice identifier. Pattern states keep their existing entity schema and original IDs, versions, timestamps, facts and source labels.

When v2 is absent, a valid v1 aggregate is converted in memory to zero or one pattern. A read does not write or duplicate data. The first successful explicit write atomically installs the whole v2 aggregate; failure leaves v1 and any existing v2 untouched. A legacy active practice stays active. No migration creates a second pattern or renames the old one.

An internal exact v1 checkpoint detects subsequent legacy writes. It is never exposed in returned snapshots/details, including after logout. A malformed v2 does not fall back to stale v1. Conflicting old-tab writes or removal of v2 after it has been observed fail closed without overwriting either source. This is still a single-active-tab local demo; localStorage offers no cross-tab transaction/lock guarantee.

Logout hides all pattern data, clears draft state and keeps saved records for a same-account login. The legacy v1 backup is intentionally not rewritten on v2 logout. Do not run an old writer concurrently or assume old code will honor the newer login state.

**Rollback limitation:** pre-upgrade code cannot display v2 additions. A code rollback is not a data-format rollback. Retain both keys; never delete v2 or rewrite it into one legacy pattern. Restoring old code may show only the preserved older v1 state, not the latest patterns. Resolving an actual storage conflict or exporting data requires a separate, explicit action rather than silent repair.

## Verification and release

This change includes scoped repository/provenance tests, an authentic synthetic v1 test fixture generated with the unchanged base repository, and actual screen/repository renderer regressions. Fixtures live only under tests and are not production defaults. Existing transport/backend tests remain in the verification workflow.

Record the final commit and exact outcomes in the PR. Full Jest, semantic type checks, lint and builds run in the normal CI environment because the local workspace is a partial materialization without dependencies. Mocked checks are not browser or real-provider acceptance.

Browser/visual screenshots of My/list/A/B details and real-provider tests are **Not Run** until separately performed through an allowed route. The previous file-protocol refusal is not bypassed by hosting another copy. No paid request is made to manufacture test data.

Feature-branch verification does not deploy. Merging to `dev` still invokes the existing frontend/backend deployment and restart, even though this change is client-side. Review the migration limitation, exact-head checks and current protection/admission requirements before release. Do not change or bypass those controls.
