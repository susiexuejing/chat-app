# EF-122 Reproducible GitHub Verification Pack

## Purpose and scope

`EF-122 Reproducible Verification Pack` is a read-only GitHub CI check for pull
requests targeting `dev` and for commits pushed to `dev`. It is limited to a
locked dependency install, server static validation, server build validation,
and the three existing approved server test suites listed below.

The workflow is intentionally not manually dispatchable. It does not change branch protection, default-branch policy, application behavior, dependencies, lockfiles, schemas, or runtime configuration.

## Reproducible command contract

The runner uses pnpm `9.0.0` and runs these commands in this exact order:

```text
pnpm install --frozen-lockfile
pnpm run lint:server
pnpm --dir server run build
```

It then runs exactly these existing suites from `server/`, with
`NODE_OPTIONS=--experimental-vm-modules`:

```text
./node_modules/.bin/jest --no-cache --runInBand \
  src/__tests__/ef110-index-runtime-sanitization.test.ts \
  src/__tests__/ef110-security-sanitization.test.ts \
  src/__tests__/ef102-stream-events.test.ts
```

The check records the checked-out candidate SHA and uploads only a synthetic
command/suite summary as a CI artifact. A malformed candidate identity, install,
lint, build, test, or protected-manifest integrity failure stops the check with
a non-zero result.

## Isolation and safety boundary

No credentials are required. The workflow does not deploy, invoke a runtime
endpoint, read CI credentials, and does not contact databases, providers, DEV,
or Production, or execute mutating smoke scripts. It has only `contents: read` GitHub token
permission and uses no supplied runtime configuration values.

This check neither replaces independent security scanning nor changes its
configuration. Existing Gitleaks and release checks remain separate workflow
evidence.

## Evidence review

For each run, reviewers should verify:

1. The workflow check is named `EF-122 Reproducible Verification Pack`.
2. The job's candidate SHA matches the PR head or pushed `dev` commit.
3. The artifact lists pnpm `9.0.0`, the three frozen commands, and only the
   approved suite paths.
4. The run has no skipped/fail-open step and completed without a deployment.
5. Existing Gitleaks and release-gate checks are independently green where
   those checks are applicable to the same candidate.

## Safe rollback

If this verification pack must be disabled, revert only the commit that adds
this workflow, its contract test, and this document, using a normal revert PR.
Do not weaken an existing required check or change branch protection as part of
that rollback. The rollback must retain independent security and release-gate
workflows and must be reviewed through the usual `dev` PR process.
