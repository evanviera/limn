# Large File Decomposition Prompt

Use this prompt in a Codex task when large files need to be made smaller without
turning the work into a broad refactor.

```text
You are working in the Limn repo. Your task is to safely decompose oversized
files by mechanical extraction only. This is not a rewrite, redesign, cleanup
pass, state-management migration, naming sweep, or dependency change.

Create and use a goal for this work. If Codex goal tooling is available,
immediately call `create_goal` with this objective:

Goal: Decompose oversized source files into focused modules/components using
only behavior-preserving mechanical extractions, then verify the app still
builds/tests. Keep running until every safe extraction goal below is satisfied,
or until the only remaining oversized areas require a dangerous refactor that
must be explicitly reported instead of attempted.

Do not mark the goal complete until the completion criteria are met. If a
single turn is not enough, continue in later turns from the current repo state
instead of restarting the audit.

Read these first:
- AGENTS.md
- CLAUDE.md
- docs/architecture.md

Repo rules to obey:
- Soft cap is about 600 lines per source file; about 900 is acceptable only for
  one genuinely cohesive component/module.
- New UI goes in src/components/.
- New pure logic/hooks go in src/lib/.
- CSS rules go in the matching src/styles/*.css partial. src/styles.css is only
  an @import barrel.
- Rust subsystems get their own src-tauri/src/*.rs module. Do not grow lib.rs.
- Relative TypeScript value imports use a .js extension. Type-only imports omit
  the extension.
- Do not naively split src/storage.ts. The architecture notes say its factory
  and parse halves are mutually dependent. If it must be reduced, extract shared
  low-level helpers first.

Safety constraints:
- Prefer mechanical extraction: move a self-contained function, component, type
  group, constant group, CSS section, or Rust helper module to a new file and
  import it back.
- Preserve public behavior, data formats, file names on disk, IPC command names,
  test IDs, CSS class names, and user-facing text unless a rename is strictly
  required for the extraction.
- Do not redesign state ownership, change component responsibilities, rewrite
  algorithms, introduce new abstractions, add dependencies, or perform broad
  renames.
- Do not combine decomposition with feature work or cosmetic cleanup.
- If a file cannot be reduced further safely, document the blocker and stop
  extracting from that file.

Work loop:
1. Inspect file sizes:
   `find src src-tauri/src tests/e2e -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.rs' -o -name '*.css' \) -print0 | xargs -0 wc -l | sort -nr | head -40`
2. Pick the largest file with an obvious safe extraction. Work on one file and
   one extraction slice at a time.
3. Before editing, identify the slice in one short note:
   - source file
   - extracted responsibility
   - destination file
   - why it is mechanically safe
4. Apply only the extraction:
   - move the code unchanged where possible
   - export/import it
   - adjust TypeScript .js value import extensions
   - add a CSS partial to the barrel only when extracting CSS
   - add a Rust `mod` declaration and `pub(crate)` boundaries only when needed
5. Run the narrowest useful verification after each slice:
   - TypeScript/UI: `npm run build:web`
   - storage changes: `npm run test:storage`
   - Rust changes: `(cd src-tauri && cargo test)`
   - user workflow or selector-sensitive changes: `npx playwright test`
6. If verification fails, fix only extraction-caused issues. If the failure is
   unrelated, record it and continue only when the current extraction is still
   proven sound.
7. Repeat until the goal is satisfied.

Completion criteria:
- Every file over about 900 lines has either been reduced below that threshold
  by safe extraction or has a written explanation for why further reduction
  would require a dangerous refactor.
- Any file still over about 600 lines has a short note explaining whether it is
  cohesive enough to leave for now or what the next safe extraction should be.
- `src/App.tsx` remains only the root orchestration component and module-level
  helpers.
- `src/components/*` components are prop-driven after extraction.
- `src/styles.css` remains an import barrel only.
- Verification commands relevant to touched files have passed, or any unrelated
  pre-existing failures are clearly reported.

High-value first targets in this repo, based on current structure:
- src/App.tsx: extract prop-driven UI panels, dialog/banner plumbing, and pure
  helpers. Do not move workspace lifecycle ownership unless it is already
  isolated behind a hook-shaped boundary.
- src/components/CardEditor.tsx: extract presentational editor sections and
  small helper components that already communicate through props.
- src/styles/card-editor.css: extract cohesive card editor partials and import
  them in the same cascade position.
- src-tauri/src/lib.rs: extract cohesive filesystem/workspace helper groups into
  Rust modules while preserving IPC command names and signatures.
- src/storage.ts: avoid broad splitting; extract shared id/timestamp/path or
  serialization primitives first if they have no dependency back into the
  factory/parse halves.

Final response:
- Summarize extracted files and remaining oversized files.
- List verification commands and results.
- Call out any file that still needs a future risky refactor instead of implying
  it was solved.
```
