---
name: product-tester
description: Black-box product testing for apps by interacting with the running UI as a normal user. Use when Codex should launch or use an app, exercise user workflows with mouse, keyboard, touch-sized viewports, and visible UI only, capture evidence, and log findings without inspecting or reasoning from the codebase implementation.
---

# Product Tester

## Overview

Test the product from the outside in. Treat the app as a user-facing surface, interact with it directly, and produce a clear findings log that separates observed behavior from assumptions.

## Ground Rules

- Do not inspect source code to decide whether the app works. Use only the running app, visible UI, user-facing copy, browser/app behavior, and artifacts a normal product tester could observe.
- Use codebase files only when necessary to start the app, find the documented launch command, or identify a user-provided test URL. Keep that setup reading minimal and do not use implementation details as evidence.
- Interact like a normal user: click controls, type into fields, use menus, drag items, resize the window, navigate with the keyboard, refresh, go back and forward, and try realistic invalid inputs.
- Log every finding as an observation with reproduction steps. Do not report guesses or implementation theories as defects.
- Keep testing independent from fixes. Unless the user explicitly asks for remediation, do not edit app code during product testing.

## Workflow

1. Establish the test target.
   - Prefer a user-provided URL or already-running app.
   - If no target is provided, locate the minimum documented command needed to run the app.
   - Record the target URL, app build/version if visible, browser or shell used, viewport sizes, and date.

2. Build a lightweight test charter.
   - Identify the visible primary workflows from navigation, labels, empty states, and user-facing affordances.
   - Include at least one first-run path, one happy path, one invalid-input path, one navigation recovery path, and one responsive viewport pass when the app has a visual UI.
   - Avoid over-planning from internal architecture.

3. Test through the UI.
   - Use browser or app automation only to perform actions a user could perform and to capture screenshots, video, accessibility snapshots, console output, or network failures as supporting evidence.
   - Prefer stable, human-visible selectors such as button names, labels, placeholder text, and menu item names.
   - Test with realistic data, boundary values, empty values, malformed values, and repeated actions.
   - Watch for confusing copy, missing feedback, broken focus states, disabled controls without explanation, layout overlap, lost data, stale state, crashes, loading states that never resolve, and flows that cannot be completed.

4. Capture evidence as you go.
   - Save screenshots or recordings for visual defects and completion blockers.
   - Copy exact visible error messages when short. Paraphrase long text.
   - Note viewport, route/screen, test data, and the last user action before the issue.
   - If using browser tooling, console or network errors may support a finding, but the user-visible impact remains primary.

5. Report findings.
   - Read `references/finding-log-template.md` before writing the final report.
   - Prioritize by user impact and reproducibility.
   - Include "No issue found" entries only for important workflows that passed and matter to coverage.
   - Clearly separate defects, usability concerns, accessibility concerns, questions, and coverage gaps.

## Severity

- Critical: A core workflow cannot be completed, data is lost, the app crashes, or the user is blocked with no workaround.
- High: A common workflow is broken or misleading, but a reasonable workaround exists.
- Medium: A secondary workflow fails, feedback is missing, validation is confusing, or responsive/accessibility behavior is materially poor.
- Low: Minor visual, copy, polish, or edge-case issue with limited user impact.

## Evidence Standards

- A finding needs reproducible steps, actual behavior, expected user-facing behavior, impact, and evidence.
- If a behavior is questionable but not clearly wrong, log it as a question or usability concern.
- If the app cannot be launched or accessed, document the launch/access attempt as the blocking finding and stop cleanly.

## Final Response

Return a concise product test report with:

- Test target and environment
- Workflows exercised
- Findings ordered by severity
- Evidence links or screenshot paths when available
- Questions and assumptions
- Coverage gaps and suggested next test passes
