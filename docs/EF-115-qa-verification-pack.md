# EF-115 QA Verification Pack

`QA Verification Pack` is a manually dispatched, read-only GitHub Actions runner for Fresh Independent QA.

It accepts an authorized, full, lower-case SHA already merged into `dev`, checks out that exact commit, proves ancestry and a clean worktree, installs from `pnpm-lock.yaml`, runs the named Pack, and retains SHA-bound evidence for 30 days.

## EF-110 Code Verification

Dispatch with:

```text
authorized_sha=b0d8e56bfe405ad2b5521f7212081053db17b520
pack=ef110-code-verification
```

The Pack runs the two EF-110 sanitization suites and the EF-102 streaming-event regression suite. It uses no secrets and only local mocks. It is Code Verification evidence, not Runtime E2E evidence.

Runtime E2E remains blocked unless a separately approved non-production test identity and Resume Authorization are provided. The runner does not deploy, call DEV, access Production, or create Jira changes.
