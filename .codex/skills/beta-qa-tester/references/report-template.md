# Beta QA Report Template

Use this structure for `reports/YYYY-MM-DD-beta-qa-<app-or-feature>.md`.

```markdown
# Beta QA Report: <app or feature>

- **Date:** YYYY-MM-DD
- **Tester role:** Expert productivity-app user, non-developer
- **Target:** <app, URL, build, branch, or release>
- **Environment:** <OS, browser/app shell, viewport/device, network notes>
- **Scenario:** <realistic work scenario used for testing>
- **Recommendation:** Use today / Use after fixes / Would not use

## Executive Summary

<Short candid summary of product usefulness, reliability, and confidence. Include whether this would fit real work.>

## Workflow Coverage

| Workflow | Result | Notes |
| --- | --- | --- |
| First-run setup | Pass/Issue/Blocked/Not tested | <note> |
| Core happy path | Pass/Issue/Blocked/Not tested | <note> |
| Editing and correction | Pass/Issue/Blocked/Not tested | <note> |
| Error recovery | Pass/Issue/Blocked/Not tested | <note> |
| Return/reload persistence | Pass/Issue/Blocked/Not tested | <note> |
| Keyboard/narrow viewport | Pass/Issue/Blocked/Not tested | <note> |

## Would I Use It?

<Plain-language product opinion. Compare with familiar productivity workflows or tools when useful.>

## Bugs

### <Severity>: <short title>

- **Surface:** <screen or workflow>
- **Steps:** <numbered or compact repro steps>
- **Actual:** <observed behavior>
- **Expected:** <user-facing expected behavior>
- **Impact:** <why this matters to real work>
- **Evidence:** <screenshot/video/path/message, or "notes only">

## Usability Notes and Opinions

### <topic>

- **Observation:** <what happened or how it felt>
- **Why it matters:** <productivity impact>
- **Suggestion:** <plain-language improvement, no code diagnosis>

## Questions

- <Question that affects product judgment or expected behavior>

## Coverage Gaps

- <What was not tested and why>
```
