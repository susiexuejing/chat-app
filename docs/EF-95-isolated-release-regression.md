# EF-95 Isolated Release Regression

Canonical repository-root command:

```bash
pnpm run test:release
```

The command reads `scripts/release-suite.manifest.json`; it never discovers or runs tests outside that approved manifest. A malformed manifest, bootstrap error, included-suite failure, interrupt, or unsafe cleanup failure returns a non-zero exit code.

## Isolation and cleanup

Each invocation owns a new `emotionflow-ef95-release-*` directory created by the OS under its temporary directory. The runner passes `EF95_FIXTURE_DIR`, `EF95_OUTPUT_DIR`, `EF95_ISOLATED_RUN=true`, `NODE_ENV=test`, and `CI=1` to every child. No fixed home-directory or repository output path is used.

Signal handlers are registered before manifest/bootstrap work and remain installed until cleanup completes. After the manifest is validated, the runner creates and immediately owns one run directory; once the child lifecycle is under control it emits `[release] isolated runner ready`. Cleanup runs after success, suite failure, bootstrap failure after ownership, SIGINT, and SIGTERM. It only accepts the exact owned prefix beneath the OS temp root, rejects symlinks and non-directories, recursively removes that invocation's run directory, and verifies it no longer exists. An already absent owned path is clean and succeeds idempotently; an unsafe target or cleanup error fails the run.

SIGKILL cannot be handled by a process and is outside the handled-signal cleanup guarantee. Residue evidence therefore compares each invocation's before/after OS-temp sets and verifies its owned run directory is absent, without deleting or attributing concurrent sibling invocations.

## Included suites

| Manifest ID | Coverage | Safety and fixtures |
|---|---|---|
| `client-approved-jest` | Client conversation, retry, persistence, queue, diagnostic and UI regression | Explicit Jest paths only. Network, AsyncStorage and browser storage are mocked; inputs are synthetic and in-memory. |
| `runtime-data-static-guard` | Runtime/user-derived tracked-data policy | Read-only repository scan with no runtime endpoint or database access. |

## Excluded suites

| Manifest ID | Risk and reason | Inclusion condition |
|---|---|---|
| `legacy-ef38-harnesses` | Both suites are wholly skipped legacy Harnesses and produce no executable evidence. | Replace or safely re-enable with deterministic isolated fixtures. |
| `server-database-and-api-tests` | Database/Supabase configuration is not proven ephemeral. | Provide a fail-closed ephemeral database configuration. |
| `server-unapproved-tests` | Not required for this Client gate and lacks EF-95 dynamic isolation proof. | Complete static and dynamic isolation audit. |
| `mutating-smoke-scripts` | Calls localhost or Production chat endpoints; some write repository output. | Use owned ephemeral services and run-temp output only. |
| `manual-runtime-qa` | May use real identity/session data and alter external environments. | Separate approved synthetic-tenant QA workflow. |

Fixtures must never be copied from Production or DEV. The release command performs no deployment, browser Runtime QA, database mutation, or smoke-script execution.
