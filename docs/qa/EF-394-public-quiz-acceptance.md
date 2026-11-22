# EF-394 / EF-395: original /ceshi/ entry, real account acceptance

Product scope: the original /ceshi/ stays the only entry. Visitors answer the
approved personality questionnaire without signing in; the explicit result
action opens mobile sign-in, verifies the same person's phone, then saves and
shows the report in that test. Do not restore chat, "我的路径", a second QA URL
or a browser password. No change to Nginx's main-app upstream is required.

## Prove the build before touching the original entry

- Build the web package under /ceshi with public account mode enabled and both
  fixture flags disabled. Do not use PR #214's localhost/fixture bundle as a
  live product package. Keep all credential material server-side.
- On an executor with supported Chromium, run the fully intercepted public
  client contract script against the export. The script never connects to DEV
  or sends an SMS; passing it is not passing independent DEV browser QA.
- Before using the vendor, verify the target databases and account/consent schema,
  the registered terms/privacy versions and live links, and the server-only
  secret and provider identity for this target. Record credential availability,
  never a credential, number, OTP or report. Prior control-plane
  success is evidence for the exact preset at that time, not for this app.
- Mount public routes only under /ceshi/api/auth/v1 on the existing DEV origin;
  don't expose fixture routes or attach an external database port. Rehearse
  exact route/method checks, budget exhaustion and provider ambiguity with an
  injected provider double. Verify the old deployment can be restored before
  changing the entry; leave the main app untouched.

## Independent browser acceptance (exact DEV version)

1. New browser context: open the original /ceshi/ without sign-in. Start and
   complete the test. No account, SMS or result API should be invoked while
   answering. No report or phone prompt appears before the result action.
2. Select "查看结果", cancel, go back to the last question and confirm the
   answer remains selected. Invalid phone and unchecked consent must not
   verify. Never use a provider retry to simulate a failed or expired code.
3. In the separately authorized real DEV window, use a designated QA number and
   actual OTP with the approved SMS preset. Confirm first sign-in, one attached
   report, appropriate logout and same-account report readback. Confirm no
   other person's report is visible; if a second number cannot be verified
   within scope, record that real provider scenario as Not Run.
4. No raw phone number, test answer, OTP or session material in Jira/screenshots.
   Record exact revision, URL, browser, pass/fail/Not Run and provider budget
   used. Only after independent browser QA passes should the operator hand the
   same URL to the product owner for a manual pass.

Public guest access and public phone-SMS eligibility are different rollout
steps. An approved count/number for real DEV QA does not authorize all visitors
to send SMS, and no public fixture or test credential can substitute for it.
