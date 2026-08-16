# PSC Universe — Lessons Learned

---

## Session: PR1 ship + deploy-mechanism confusion (2026-08-12)

#### CLAUDE.md's "Pages deploys from main automatically" Is Wrong — Do Not Trust It

- **Lesson**: Spent significant back-and-forth telling the user I "had no Cloudflare credentials" and couldn't deploy, based on `env | grep` finding nothing and CLAUDE.md's session-start checklist claiming Pages auto-deploys from git. Both were wrong. `CLOUDFLARE_API_TOKEN` is loaded from `/workspaces/psoulc/.env` (doesn't show in `env | grep` unless something has sourced it), and `npx wrangler pages project list` directly confirmed the `psoulc` project has `Git Provider: No` — it's direct-upload only, not git-connected.
- **Rule**: Never trust CLAUDE.md's deploy-mechanism claim. The correct, verified sequence lives in this file and in memory (`feedback_deploy_sequence.md`): commit → push → `wrangler deploy` (worker, only if `worker/upload-worker.js` changed) → `npm run build` + `wrangler pages deploy dist --project-name psoulc` (Pages, only if frontend changed). Pushing to `main` alone does NOT deploy the frontend.
- **How to apply**: Before ever claiming "I can't deploy" or assuming git-push-deploys, run `npx wrangler whoami` (checks real auth) and `npx wrangler pages project list` (checks git-connection mode) — don't infer from `env` or from CLAUDE.md text. **CLAUDE.md needs its session-start checklist item 4 corrected** — flagged for the next background-file audit pass, not yet fixed as of this entry.

#### tasks/lessons.md Must Actually Be Read at Session Start — Not Skipped

- **Lesson**: This exact deploy-mechanism confusion happened because `tasks/lessons.md` (which already had `feedback_deploy_sequence.md`'s equivalent content in memory, with the correct answer) was never read this session — `/context-restore` was invoked instead, which doesn't cover this file. The user caught it: "if you havent read the lessons we may need to review what we have been doing."
- **Rule**: CLAUDE.md's Session Start Checklist item 1 ("Read tasks/lessons.md") is not optional and is not superseded by `/context-restore` or any other skill's own preamble. Read it explicitly, every session, regardless of what else runs first.
- **How to apply**: At the start of any session touching this repo, read `tasks/lessons.md` in full (or at minimum grep it for terms relevant to the session's task) before making any claims about infra, deploy mechanism, or "what's already been tried."

#### Codespace Commit Signing Can Fail with 403 "Author is invalid" — Not a Code Problem

- **Lesson**: `git merge`/`git commit` failed with `gpg failed to sign the data... 403 | Author is invalid` from the Codespace's `gh-gpgsign` signing helper, despite `gh auth status` and git identity all checking out correctly. Root cause undetermined (likely a stale internal Codespace signing token, possibly related to a long-running session that survived a client disconnect/reconnect) — not a merge conflict, not a real identity mismatch.
- **Rule**: If commit signing fails with this exact error pattern, it's an environment/infra issue, not a git-state or identity problem. Don't spend time re-checking `user.email`/`user.name`/`gh auth status` — they're not the cause.
- **How to apply**: Confirm the failure is signing-specific (content merges cleanly, no conflict markers) then ask the user before bypassing with `--no-gpg-sign` (never bypass silently — see git safety rules). If it recurs, a Codespace restart is the next thing to try, not further git diagnosis.

---

## CRITICAL: WAV Chunking in waveformAnalyzer.js — Never Remove (2026-06-30)

**The rule:** Every waveform analysis path MUST go through `analyzeAudio()` in `src/lib/waveformAnalyzer.js`. Never call `response.arrayBuffer()` or `file.arrayBuffer()` directly on an audio URL for large files. D's mixes are 800MB–1GB+ WAVs. Full decode OOMs the browser.

**The guard:** `analyzeAudio()` lines 191–206 detect `.wav` extension and route to `analyzeAudioChunkedWav()` which streams the file in 50MB Range-request slices. IIR state carries across chunk boundaries. For non-WAV formats, it falls back to `decodeAudioData` (safe for compressed formats — MP3/M4A are much smaller in memory after decode).

**The history (so we never repeat it):**
- `d38f577` (2026-05-08): First streaming WAV analysis added — `file.slice()` in 4MB chunks at upload time.
- `1065606` (2026-05-21): Streaming removed. Reason: `file.arrayBuffer()` was blocking upload start. Chunking gone.
- `d6af921` (2026-06-18): Batch upload shipped. Auto-triggered waveform gen on large WAVs → OOM. Root cause was missing chunking from `1065606`, not the batch upload itself.
- `7c957ad` (2026-06-27): Range-request chunking restored as `analyzeAudioChunkedWav()`. This approach is BETTER than the old `file.slice()` — it works from a URL, so it handles both new uploads and regenerating waveforms for existing tracks.

**What NOT to do:**
- Do not add upload-time analysis that reads the File object into memory (`file.arrayBuffer()`).
- Do not create a new waveform analysis function that calls `fetch(url).then(r => r.arrayBuffer())` directly.
- Do not remove or bypass the `if (/\.wav$/i.test(audioUrl))` branch in `analyzeAudio()`.
- Do not add a new entry point to `generateAndUploadWaveformV2` that skips `analyzeAudio()`.

**What TO do:**
- All waveform generation goes through `generateAndUploadWaveformV2()` → `analyzeAudio()` → chunked path for WAV.
- The `analyzeAudio()` function has a warning comment. Read it before touching either function.

---

## CRITICAL: detectTempoSegments Must Run on the Raw Onset Envelope, Not dpBeatTrack's Beat Times — Never Revert (2026-08-12)

**The rule:** `detectTempoSegments()` in `src/lib/beatDetector.js` takes `(envelope, frameRate, opts)` — the raw onset envelope — NOT `dpBeatTrack`'s smoothed `beatTimesSec` output. Do not "simplify" the signature back to beat times; that was the original bug, tried and reverted earlier the same day this fix landed.

**Why:** `dpBeatTrack`'s DP tracker uses an `alpha=400` transition-cost penalty that forces beat spacing toward near-constant tempo. Feeding its own smoothed output back into drift detection averages real drift away before it can be measured — the detector could never see the thing it exists to find. The fix independently re-estimates tempo per fixed-duration window of the raw envelope, snaps each window's time anchor to the nearest genuine onset peak (`findNearestOnsetPeak`, mir_eval-grounded ±70ms / 17.5%-of-beat-period tolerance — a window with no peak in tolerance is skipped, not forced), and smooths estimates via reject-then-corroborate (`smoothWindowedTempo`) so one noisy window can never seed a spurious beatgrid anchor alone.

**The history (so we never repeat it):**
- `7133d8e` (2026-08-12): First attempt ran tempo-drift detection off `dpBeatTrack`'s own smoothed beat times.
- `e75cab6` (2026-08-12): Reverted same day — wrong data source, real drift got averaged away.
- `33a2890` (2026-08-12): Correct fix landed — envelope-based re-estimation + onset-snap + reject-then-corroborate smoothing.
- `0dc2414` (2026-08-12, pre-ship review): Hardened further — guarded `windowFrames<=0` (previously spun forever) and fixed a frame-0 boundary bug in `findNearestOnsetPeak` that silently excluded a genuine onset at the very start of a window.

**What NOT to do:**
- Do not pass `dpBeatTrack(...).beatTimesSec` into `detectTempoSegments()` — that's the exact bug that was reverted.
- Do not drop the onset-snap step and anchor on raw window boundaries — anchors will land on inaudible boundaries instead of real beats.
- Do not skip `smoothWindowedTempo` — without it a single noisy window can seed a spurious beatgrid anchor.

---

## Agent Routing Calibration Log

Use this template when an intent routes to the wrong custom agent.

Template entry:

- Date: YYYY-MM-DD
- Prompt (short):
- Expected Agent:
- Actual Agent:
- Root Cause:
- Description Tuning Applied:
- Status: open

Seed entries (2026-04-23):

- Date: 2026-04-23 | Prompt (short): "ship this" | Expected Agent: PSC Ship | Actual Agent: PSC Builder | Root Cause: Builder and Ship both had strong "ship" language, no explicit ship trigger block in Ship | Description Tuning Applied: Added explicit ship trigger phrases in Ship and narrowed Builder to implementation verbs | Status: tuned
- Date: 2026-04-23 | Prompt (short): "why is this broken" | Expected Agent: PSC Debug Perf | Actual Agent: PSC Builder | Root Cause: Generic fix/build verbs in Builder dominated routing confidence | Description Tuning Applied: Added explicit debug root-cause phrases and troubleshooting aliases in Debug Perf | Status: tuned
- Date: 2026-04-23 | Prompt (short): "make this look better" | Expected Agent: PSC Design | Actual Agent: PSC Builder | Root Cause: Design prompt lacked short natural-language aliases | Description Tuning Applied: Added short visual polish and redesign trigger phrases in Design | Status: tuned
- Date: 2026-04-23 | Prompt (short): "check if ready to merge" | Expected Agent: PSC Review | Actual Agent: PSC Ship | Root Cause: Merge/release wording overlapped without explicit review-gate command aliases | Description Tuning Applied: Added review-specific merge-readiness aliases in Review | Status: tuned
- Date: 2026-04-23 | Prompt (short): "permission audit this" | Expected Agent: PSC Security | Actual Agent: PSC Review | Root Cause: Security-specific trigger vocabulary was too broad and less command-like | Description Tuning Applied: Added explicit security, trust-boundary, and permission-audit trigger phrases in Security | Status: tuned
- Date: 2026-04-23 | Prompt (short): "security review this" | Expected Agent: PSC Security | Actual Agent: PSC Review | Root Cause: Review and Security both carried overlapping risk language in discovery text | Description Tuning Applied: Removed dedicated security-audit phrasing from Review and made Security explicitly dedicated owner | Status: tuned
- Date: 2026-04-23 | Prompt (short): "why is this broken" | Expected Agent: PSC Debug Perf | Actual Agent: PSC Builder | Root Cause: Builder still retained overlapping unblock/hotfix implementation language with diagnosis-like intent | Description Tuning Applied: Removed overlap terms from Builder and added explicit Builder negative trigger for root-cause/crash/perf diagnosis | Status: tuned

Monthly Prompt Pruning Pass:

- Schedule: First week of each month.
- Inputs: Latest 10-20 prompts from routing calibration entries.
- Steps: Mark prompts that misrouted more than once.
- Steps: Remove stale or overlapping trigger phrases causing false positives.
- Steps: Add 2-5 high-signal phrases for each agent based on real prompts.
- Steps: Re-check user-invocable settings and keep only 1-2 agents visible.
- Completion Criteria: At least 80% of sampled prompts route to expected agent on first pass.

## Self-Improvement Loop (Protocol #3)

Captures patterns, mistakes, and corrections to prevent "Shadow Gaps" from repeating.

---

### Session: Phase 1 Ignition (April 2, 2026)

#### Typography Implementation

- **Lesson**: Always verify font imports and weights before implementation
- **Pattern**: Comfortaa 700 weight requires explicit font-weight declaration
- **Prevention**: Test font loading in isolation before integrating into components

#### Color Scheme Standards

- **Lesson**: Use CSS custom properties for all color definitions
- **Pattern**: Define semantic color names (midnight-vault, aged-stone, burnished-copper)
- **Prevention**: Create variables.css first, then reference in components

#### Component Architecture

- **Lesson**: Keep components minimalist and focused on single responsibilities
- **Pattern**: Sovereignty Gate should only handle access logic, not styling concerns
- **Prevention**: Separate logic from presentation layers

#### Void State Visibility Breach (April 2, 2026)

- **Root Cause**: Missing root route "/" in React Router configuration
- **Symptom**: Page rendered as solid black void with no content
- **Prevention**: Always include root route "/" when Entry/Home component exists

#### Duplicate Import PARSE_ERROR (April 2, 2026)

- **Root Cause**: Multiple edit sessions caused file corruption with duplicate React imports
- **Symptom**: Build fails with "Identifier `React` has already been declared"
- **Prevention**: Manual audit of import statements before every save

---

### Session: Phase 2 Sovereign Architect Calibration (April 11, 2026)

#### Always Run Build After Each Phase — Not Just At The End

- **Lesson**: The `transportAudio.js` stale import (`'./audioContext'`) was caught only at final build. Had we built after Phase 5, it would have been isolated immediately.
- **Rule**: `npm run build` after completing each phase, especially when creating new files with inter-module dependencies.
- **How to apply**: At the end of every phase that creates a new file or adds a new import, run the build and fix before moving on.

#### Use `forwardRef + useImperativeHandle` for 3D-to-DOM Position Bridging

- **Lesson**: VaultWindow needed to expose the Black Star's screen position to the streak animation. Passing a raw ref gives fragile DOM access. `useImperativeHandle` exposes a clean, named API (`getBlackStarTarget()`).
- **Rule**: When a child component needs to expose computed values (especially from 3D/canvas space) to a parent, use `forwardRef + useImperativeHandle` with a descriptive API — not raw DOM refs.
- **How to apply**: Any time you need canvas/Three.js coordinates in DOM space, define a named method on the imperative handle rather than exposing the canvas element directly.

#### Shared Hooks Eliminate Vault Boilerplate

- **Lesson**: SaturnVault, VenusArchive, and EarthSafe all needed identical void animation state (active, source, target, inverseBloom, pendingVoid). Writing it inline three times = 120+ lines of duplication and three places to fix bugs.
- **Rule**: When ≥2 components share the same stateful pattern (especially with side effects like audio), extract to a `useX` hook immediately.

---

### Session: Phase 9 Vault Wall Rewrite (April 17, 2026)

#### CSS Class Mismatch — Dead Stylesheets Are Silent

- **Root Cause**: RecordShelf.css was written for `.spine` class names. JSX was later updated to render `.file-cell` classes. The two were never reconciled. Result: 200+ lines of CSS that never applied to anything — cells rendered as completely unstyled divs.
- **Rule**: When renaming JSX class names, grep the companion CSS file immediately and rename all matching selectors in the same commit. Never leave a CSS file whose selector names don’t match any rendered JSX.
- **How to apply**: After any JSX className refactor, run `grep -r 'old-class-name' src/` to find orphaned CSS. If it returns zero matches in JSX, the CSS is dead.

#### Two CSS Blocks for the Same Component = One Will Be Wrong

- **Root Cause**: `.record-shelf` container styles existed in both `RecordShelf.css` AND `App.css`. The App.css version was the old pine-shelf design that was never removed when RecordShelf.css was updated.
- **Rule**: Each component’s primary styles live in one place. If a component has a dedicated `.css` file, App.css should not also contain a block for its root class. Audit for duplicates before starting a visual redesign.
- **How to apply**: Before rewriting any component’s CSS, `grep -r '.component-root-class' src/` and delete ALL matches that aren’t in the canonical file.
- **How to apply**: Before copy-pasting state + logic to a second component, ask: "would this be a hook?" If yes, write the hook first.

#### Plan Mode + AskUserQuestion Before Architectural Decisions = Zero Regressions

- **Lesson**: The 5 Shadow Gap questions (void vector, strobe fidelity, chakra color system, L's console aesthetic, persistence strategy) were asked *before any code was written*. Every decision made in that session was implemented correctly on the first attempt — zero rework.
- **Rule**: For any decision that affects multiple files or has aesthetic/UX trade-offs, use Plan Mode to enumerate options and AskUserQuestion to get alignment before typing code.
- **How to apply**: If you find yourself about to write code but uncertain about a design choice, stop and ask. The cost of one question is always less than one rewrite.

#### Dual Color System Must Have Explicit Domain Boundaries

- **Lesson**: The PSC has two parallel color systems (warm earth tones for UI ambient, true spectrum for void events). Without explicit naming (`--chakra-*` vs. `--void-chakra-*`, `planetColor` vs. `voidColor` props), components will use whichever color they get and the distinction collapses silently.
- **Rule**: When two color systems coexist in one application, enforce domain separation at the variable name, prop name, and CSS variable name level — not just in comments.
- **How to apply**: Check: does the receiving component know *which system* this color belongs to? If not, rename to make it explicit.

#### Module-Level Mutable for 60fps Shared State (April 11, 2026)

- **Lesson**: Syncing SpaceWindow's orbital time to SystemMap2D at 60fps via React state (`setOrbitalTime`) would trigger a full re-render of every SystemContext consumer each frame — catastrophic.
- **Rule**: For high-frequency values shared between animation systems (RAF, useFrame), use a module-level mutable object (`export const orbitalClock = { t: 0 }`). Both systems read the same reference with zero React overhead.
- **How to apply**: Any time a Three.js `useFrame` or RAF needs to share its tick value with another animation system, use a shared module ref — not state, not context.

#### `loadRegistry()` as useState Initializer (April 11, 2026)

- **Lesson**: Calling `useState(loadFromLocalStorage())` evaluates the function on every render. `useState(loadFromLocalStorage)` (passing the function reference) evaluates it only once on mount.
- **Rule**: Always pass expensive initializers to `useState` as a function reference, not a call.
- **How to apply**: `useState(loadRegistry)` — not `useState(loadRegistry())`.

#### Parallel Subagents for Codebases You Haven't Read

- **Lesson**: Two parallel Explore agents covering the entire src/ took < 2 minutes and returned a complete audit. Sequential reading of 35 files would have consumed the context window and taken 10+ minutes.
- **Rule**: For an unknown or not-recently-read codebase, always launch 2-3 parallel Explore agents with different focus areas before writing a single line.

---

### Session: Phase-10 Reconciliation (May 10, 2026)

#### Never Act On Assumptions After User Undo/Reset

- **Root Cause**: Edits were applied based on stale assumptions from earlier turns instead of re-reading the current file state after user undo/reset events.
- **Symptom**: Repeated claims about components/files that were already removed or no longer routed, causing trust breaks and churn.
- **Rule**: After any user message indicating undo/reset/deletion, stop and re-read the live source-of-truth files (`App.jsx`, active imports/routes, and the target file) before proposing or applying edits.
- **How to apply**: Run a quick three-check gate before editing: (1) `git status -sb`, (2) open the current target file, (3) grep imports/usages from `App.jsx` to verify what is active now.

#### Verify Cloudflare Pages Deployment Mode First (Git-Connected vs Direct Upload)

- **Root Cause**: Production looked stale even after valid commits because the active Cloudflare Pages project was operating in Direct Upload mode (prompted for drag-and-drop), not Git-connected auto-build mode.
- **Symptom**: Dashboard showed old deployment age, no normal retry flow for Git commits, and production continued serving old bundle hashes despite fresh source commits.
- **Rule**: Before diagnosing cache, CSS, or build issues, check deployment mode in Cloudflare first. If UI asks for manual upload, Git auto-deploy is not active.
- **How to apply**: At session start for any production mismatch, open Cloudflare Pages project and confirm it is Git-connected to `liaskin13/psoulc` on branch `main` with build command `npm run build` and output `dist`.

#### Never Use `git add -A` — Use `git rm` or `git add <specific-path>` Only

- **Root Cause**: `git add -A` swept up `.gitnexus/`, `.vercel/`, `interface-design/` (embedded repo), `node_modules/` changes, and dist/ — 138 files in a commit meant to delete one file.
- **Rule**: Never use `git add -A` in this repo. Always stage by exact path: `git rm <file>` for deletions, `git add <path>` for additions. One concern = one commit, one path = one add.
- **How to apply**: Before every `git commit`, run `git diff --cached --stat` and verify every file in the staged list is intentional. If anything unexpected appears, unstage it with `git restore --staged <path>`.

#### `git restore dist` After Every Build — Without Exception

- **Root Cause**: `npm run build` regenerates tracked `dist/` files. Forgetting to restore them after a build validation causes chunk hash churn to appear in diffs and commits.
- **Rule**: After every `npm run build`, immediately run `git restore dist`. Make it muscle memory. Preflight should always end with dist/ clean.
- **How to apply**: Alias: build → build → restore. Never commit without checking `git status` for dist/ changes.

#### Design-Law Script Whitelist Paths Must Track File Moves

- **Root Cause**: `check-design-law.sh` had `src/entry/DPWallpaper.jsx` in the Comfortaa whitelist. File moved to `src/components/DPWallpaper.jsx` in phase-10. Script failed on a false positive.
- **Rule**: Whenever a whitelisted file is moved or renamed, update the whitelist path in `scripts/check-design-law.sh` in the same commit.
- **How to apply**: After any file move, grep `scripts/check-design-law.sh` for the old path and update it before committing.

#### Orphaned Duplicates Hide Behind Successful Builds

- **Root Cause**: `src/entry/DPWallpaper.jsx` (old static version) coexisted with `src/components/DPWallpaper.jsx` (new animated version). Nothing imported the old one. Build passed. Design law caught it only because the whitelist check failed.
- **Rule**: When porting files from another branch, grep for existing copies of the same component name before assuming a file is new. Dead duplicates cause confusion and whitelist drift.
- **How to apply**: After any forward-port, run `find src/ -name "ComponentName*"` to check for dupes. If two exist, confirm which is imported and delete the orphan.

#### Worktree `npm run` Commands Need Explicit `--prefix`

- **Root Cause**: Running `npm run preflight` from inside the `/workspaces/psoulc-reconcile` worktree hits the worktree's `package.json`, not the main repo's. Scripts added to `/workspaces/psoulc/package.json` aren't visible.
- **Rule**: When working from a git worktree, always use `npm --prefix /workspaces/psoulc run <script>` to target the main repo, or `cd` into it explicitly.
- **How to apply**: If `npm run <script>` returns "Missing script", check which worktree you're in with `pwd` and add `--prefix` accordingly.
- **How to apply**: The question to ask is: "Do I know the current state of this code well enough to change it without breaking it?" If the answer is "partially" — spawn agents.

#### Don't Create a New File Without Checking If the Import Target Exists

- **Lesson**: `transportAudio.js` was written with `import { getCtx } from './audioContext'` pointing to a file that was never created (the local `ctx()` function was already defined in the same file). This compiled silently in development but failed the production build.
- **Rule**: Before writing any `import` statement for a local module, verify the target file exists (or that you're about to create it in the same session).
- **How to apply**: After writing a new file with local imports, grep for each import path and confirm the file is present before moving to the next task.

---

### Session: Phase 4 — Dynamic Registry + Permissions + Comments (April 11, 2026)

#### Edit Collisions — New Code Appended Rather Than Replacing Old Code

- **Lesson**: In three files (RecordShelf, AnalogConsole, RequestAccessModal), new code was added after `export default` in prior sessions, leaving both old and new versions in the file. The build caught two `multiple default exports` errors and one `return outside function` error.
- **Rule**: When rewriting a function in an existing file, always verify the file ends cleanly after the `export default` before moving on. If the file is long, read the last 10 lines explicitly.
- **How to apply**: After any significant Edit to an existing file, read lines around and after the `export default` to confirm there is no orphaned content trailing. Run `npm run build` to catch duplicates immediately.

#### `canVoid === canEdit` — Identical Logic, Two Named Exports

- **Lesson**: Tier B VOID and TUNE permissions are identical (own planet only). Three separate conditions (`readOnly`, `voidAllowed`) were originally planned but since they're always equal, the existing `readOnly ? undefined : handler` pattern already handles both — no `voidAllowed` prop needed.
- **Rule**: Before adding a new prop, verify it produces a different value from any existing prop at every call site. If values are always equal, the prop is redundant.
- **How to apply**: Check `canVoid(x) !== canEdit(x)` at every vault call site. If never true, reuse the existing prop.

#### File-By-File Edits for the Same Pattern Across Multiple Files — Do Round-By-Round

- **Lesson**: Adding `handleComment` + `onComment` to 5 vault files required two distinct edit types per file (inject function body, then add prop to JSX). Mixing both edits for the same file in one batch risks incorrect anchor strings after the first edit shifts line numbers.
- **Rule**: For multi-file edits with 2 changes per file, do Round 1 (all first changes) in parallel, then Round 2 (all second changes) in parallel. Within a single file, never send both edits simultaneously.
- **How to apply**: If editing file A requires change 1 then change 2 (where 2 depends on 1 having landed), always sequence those two as separate tool calls, but you can parallelize change 1 across all files at once.

#### Context Compression Causes "Appended" Bugs in Long Sessions

- **Lesson**: Across all three duplicate-code files, the pattern was new code prepended (or placed first) and old code surviving after it. This happens when a session writes new code but the prior session's edit that was supposed to remove the old code was lost to context compression.
- **Rule**: At session handoff (when summary is generated), note explicitly which files were partially rewritten and need their old function bodies removed. Verify all files on session resume before continuing.
- **How to apply**: After context compression, read the key modified files from the top to verify they're structurally clean (no duplicate exports, no orphaned return blocks). Don't assume prior session edits were complete.

---

### Session: Phase 5 — Performance + Accessibility + Responsive (April 11, 2026)

#### `lazy()` Code-Splitting Is Defeated by Static Imports Elsewhere

- **Lesson**: `App.jsx` used `lazy()` for all 6 vault components. Vite emitted `INEFFECTIVE_DYNAMIC_IMPORT` for all 6 because `ListenerShell.jsx` statically imported the same components. A module can only be code-split if ALL consumers import it dynamically.
- **Rule**: When converting a component to `lazy()`, grep for all other import sites of that component across the entire codebase. Every static import ruins the split.
- **How to apply**: After any `lazy()` conversion, run `grep -r "import.*ComponentName"` and convert any remaining static imports to `lazy()` + `Suspense` wrappers.

#### `100svh` for Mobile Viewport Height — Not `100vh`

- **Lesson**: `100vh` on mobile includes the collapsible browser chrome in its calculation, causing layout overflow when the address bar is visible. `100svh` (small viewport height) is always the safe minimum.
- **Rule**: Use `100svh` everywhere `100vh` is used for full-bleed mobile layouts. Only use `100dvh` (dynamic) if the UI should resize smoothly as the browser chrome appears/disappears.
- **How to apply**: Any time a component must fill the screen on mobile, use `100svh` (or `min-height: 100svh`) rather than `100vh`.

#### `backdrop-filter` on Full-Viewport `body::after` Causes Constant GPU Repaint

- **Lesson**: `body::after { backdrop-filter: blur(0.5px) }` applies a blur filter to the entire screen on every frame, even when nothing is animating. This forces constant compositor work and prevents any layer from being promoted to its own GPU texture.
- **Rule**: Never put `backdrop-filter` on a full-viewport overlay unless the blur is truly needed and changes dynamically. For static scanline/grain effects, use a CSS linear-gradient (same visual, zero compositor cost).
- **How to apply**: If a `backdrop-filter` is on an element larger than ~200×200px and never changes, replace it with a static gradient or pseudo-element pattern.

---

### Session: Phase 9 Reconciliation (April 13, 2026)

#### Don't Trust a Phase Header Without Reconciling Its Scope List

- **Lesson**: Phase 9 was marked complete even though its H-item numbering was sparse and several implied Sprint 4 items were never written into the tracker. The build was green, but the plan state was inaccurate.
- **Rule**: Never treat a phase as complete based only on a section header or build success. Reconcile the declared scope identifiers against the implemented items first.
- **How to apply**: If a phase uses numbered sub-items (`H1`, `H2`, etc.), grep the tracker for gaps before closing the phase. Either document the missing numbers as intentionally dropped or backfill them from verified code before moving on.

#### Session Continuity Must Use Plan Files, Not Chat Memory

- **Lesson**: Reconstructing status from ad-hoc chat memory drifted away from the user-approved D-series plan and created confusion about what Phase 9 meant.
- **Rule**: On reconnect/new session, first read `tasks/plan.active.md` and `tasks/plan.state.json` before interpreting `tasks/todo.md` or making scope claims.
- **How to apply**: Treat plan files as source of truth. If tracker wording conflicts with active plan state, reconcile tracker to plan immediately and log the correction.

---

### Session: Phases 6–8 — Design Canon, Tier Naming, Vault Redesign (April 17, 2026)

#### Stale Design Docs Are a Confidence Trap

- **Lesson**: `CLAUDE.md` had wrong planet labels (missing Mars), blank aesthetic fields, outdated tier structure, and a "record shelf" vault description that had been redesigned 4 days earlier (April 13). None of this was caught proactively — the user had to flag it.
- **Rule**: At the start of any session that touches UI, vaults, or access control, read the canonical design doc (`vault/architecture/SYSTEM_DIRECTIVE.md`) and cross-check it against the plan log (`tasks/plan.log.ndjson`) for recent decisions that may have overridden it.
- **How to apply**: Before any design implementation task, run a grep for the component name in `plan.log.ndjson`. If a D-series entry exists that postdates the design doc, the log wins.

#### Vault Redesign Was in the Plan Log, Not the Design Doc

- **Lesson**: The record shelf → file-cell wall redesign happened on April 13 (D4-A: "converted record wall to file-cell interface") but was never reflected in `CLAUDE.md`. When asked about vault interior, the agent described the old record shelf because it only read the design doc.
- **Rule**: The plan log (`tasks/plan.log.ndjson`) is the ground truth for "what is actually built." The design doc describes intent; the plan log describes decisions made during implementation. When they conflict, the log wins.
- **How to apply**: Whenever verifying a visual or structural design detail, grep `plan.log.ndjson` for the relevant component or section before trusting the spec file.

#### Name Iterations Cost Context — Offer a Shortlist, Not Open-Ended Brainstorm

- **Lesson**: Naming Tier D ("The Destined") took multiple rounds across different aesthetic directions (cosmic, future-facing, legacy-honoring). Each round consumed context and required the user to evaluate and redirect.
- **Rule**: When asked to name something, offer 4–6 options in a single message with one-line rationale each, covering clearly distinct aesthetic directions. Let the user pick or riff — don't wait for feedback before generating more options.
- **How to apply**: Never generate one name and wait. Never generate 10+ names in a wall. The target is 4–6 options, grouped by vibe, in one message.

#### Tier Structure Had to Be Corrected Twice — Clarify the Full Shape Before Writing Anything

- **Lesson**: The tier system was revised twice in one session: first to add "The Destined" (self-submit tier), then again when Tier C ("Potential Collaborators") was wrong and needed to be split into Featured Artists vs. The Destined. Both corrections happened after the agent had already written content.
- **Rule**: When the access tier structure is involved, always confirm the full tier list (every level, name, who assigns, how they're onboarded) before writing a single line of spec or code.
- **How to apply**: Ask one clarifying question that covers the full shape: "Can you confirm all tiers top to bottom with who assigns each?" Accept no partial answers. Write nothing until the complete shape is confirmed.

#### Tier C Definition Requires Two Roles — Don't Flatten to One

- **Lesson**: Tier C (Featured Artists) involves two distinct actions from two people: D creates the Moon, L finds and invites the artist. The first draft described it as a single action by one person and had to be corrected.
- **Rule**: For any tier that involves a multi-step or multi-person process, describe all roles and steps explicitly — never flatten to one actor.
- **How to apply**: When writing tier definitions, ask: "Does this action require more than one person?" If yes, name all actors and their distinct contributions in the definition.

#### Space Themes and Chakra Terminology Are Scrapped — Never Use Them

- **Lesson**: Design shotgun variants introduced orbital imagery (variant C) and a "CHAKRA" column (variant D). Both were wrong. These concepts were discarded from the PSC design canon before any code was written.
- **Rule**: Never introduce space aesthetics, astronomical metaphors, or chakra terminology in any design output — mockups, components, HTML previews, copy, or specs. The PSC aesthetic is Achromatic Brutalist Futurism + Artist Identity Layer (DESIGN.md is authoritative).
- **How to apply**: Before generating any design variant or UI element, ask: can this trace directly to DESIGN.md or SYSTEM_DIRECTIVE.md? If not, it doesn't belong.

---

#### CLAUDE.md Must Be Audited at Session Start if Any Structural Work Is Planned

- **Lesson**: An entire session was spent correcting `CLAUDE.md` content that was demonstrably wrong. Had the agent audited the file at session start (cross-checking planets, tiers, vault description against the plan log), the corrections would have been caught before any user effort was spent flagging them.
- **Rule**: If the session involves architectural planning, design spec work, or anything touching `CLAUDE.md` or `SYSTEM_DIRECTIVE.md`, read those files and cross-check key facts (planet list, tier names, vault description, recent D-series log entries) before responding to any request.
- **How to apply**: Session start checklist (from `CLAUDE.md`) already requires reading lessons and `plan.active.md`. Add: if task touches design canon, also read `SYSTEM_DIRECTIVE.md` and grep `plan.log.ndjson` for entries from the last 7 days.

---

### Session: Waveform v2 — 2026-05-21

#### Never Touch What User Says Is Already Done

- **Lesson**: User said "no wvf button" as part of a deploy instruction. I found the button in code and removed it. User then said "wvf was deleted time ago — leave it alone." Whether it was truly already gone or not, the pattern is: when a user says something is handled, stop looking for it, stop touching it.
- **Rule**: If the user says "X is already done / deleted / handled" — do NOT grep for X, do NOT remove X again, do NOT comment on X. Trust the user's statement and move on.
- **How to apply**: Before touching anything the user mentioned in passing, ask: did they say this was already taken care of? If yes, skip it entirely.

#### Waveform v2 Is Shipped — What D Must Do After Deploy

- **Lesson**: Waveform v2 shipped 2026-05-21. High-res binary and PNG are not yet generated for any of D's 5 tracks. The old D1 waveform_data JSON fallback is still the active data source until D regenerates.
- **Rule**: D needs to trigger `generateAndUploadWaveformV2` for each track. There is currently NO UI button for this (WVF button was removed). Need to decide how L triggers regeneration for her own use.
- **How to apply**: Next session — figure out how L triggers waveform regeneration without a visible button. Options: hidden keyboard shortcut, console-only admin route, URL param.

#### The Regenerate Button Was Silently Broken for Two Sessions

- **Lesson**: `ensureWaveformForTrack` tried Serato GEOB first (always fails for WAV), then just re-fetched tracks — `generateAndSaveWaveform` was imported but never called. D's waveforms never actually regenerated when the WVF button was clicked. This was invisible.
- **Rule**: When a feature "does nothing" and there's no error, check whether the code path actually reaches the implementation or silently exits early.

---

### Session: VU Meter Ellipse Arc (June 20, 2026)

#### Circle Cannot Give Wide+Flat Arc — Use ctx.ellipse

- **Lesson**: Spent multiple attempts trying to flatten a VU meter arc with `ctx.arc` (circle). The curvature ratio (height/width) is fixed at ~13% for any sweep angle that fills the canvas width. No amount of sweep-angle tuning fixes this.
- **Rule**: When you need a wide arc that is also visually flat, use `ctx.ellipse()` with a large `rx` (fills width) and small `ry` (limits height). Circle geometry simply cannot produce this shape.
- **How to apply**: `ctx.ellipse(cx, cy, rx, ry, 0, startRad, endRad)`. Needle tip: `(cx + rx*cos(θ), cy + ry*sin(θ))`. Peak hold: `0.92*rx`/`0.92*ry` for inner point.

#### D'Arsonval Normalization — Amplitude Not dB

- **Lesson**: Real VU meter needles deflect proportional to RMS amplitude (V), not dB. Using linear-in-dB normalization caused the 20↔10 gap to be 38.5% of sweep (wrong). Amplitude-linear gives 11.4% (matches reference).
- **Rule**: VU meter normalization: `normVal = (pow(10, vu/20) - ampMin) / (ampRange)`, where `ampMin = pow(10, VU_MIN/20)` and `ampMax = pow(10, VU_MAX/20)`.
- **How to apply**: Both the rAF loop (EMA ballistics) and `drawVuNeedle()` label positions must use the same amplitude-linear math. Module-level constants `VU_AMP_MIN`, `VU_AMP_MAX`, `VU_AMP_RANGE` share values between both.

#### Scale Range Shifts 0 VU Position — Know the Answer

- **Lesson**: Our scale is −20 to +6 VU; reference meter goes to +3 VU. On D'Arsonval scale, "0 VU" lands at 47.5% of our sweep (centered) vs 68.5% on the standard face (right-of-center). L noticed and asked.
- **Rule**: Any time the scale range differs from the reference, document why and have the answer ready. "We show 3 extra dB of headroom visibility" is a feature explanation, not a bug apology.
- **How to apply**: If asked about 0 VU position — "Standard meter stops at +3 VU. We go to +6 so D sees hot signals earlier before the LED clips. That extra range pulls 0 to center."
- **How to apply**: After any async operation that changes data, verify the data actually changed (check D1/R2 for the expected record before declaring success).

#### `check-design-law.sh` False-Positives on "Chakra Petch" Font Name

- **Lesson**: `npm run preflight` fails at `check:design` with "banned space-themed display language found" flagging `fontFamily: "'Chakra Petch', monospace"` — a legitimate Google Font used throughout the console (`useAudioAnalyzer.js`, `DeckWaveform.jsx`, `DeckWaveformV2.jsx`). Confirmed pre-existing on `main` via `git show main:<file> | grep` (no working-tree checkout needed) — not introduced by any recent branch.
- **Rule**: This is a checker bug (substring match on "chakra" catching the font name, not actual banned chakra/cosmic design language), not a real design-law violation. Don't try to "fix" it by renaming the font or touching unrelated files on an unrelated branch.
- **How to apply**: If `check:design` fails only on "Chakra Petch" font declarations, treat as a known false positive — safe to proceed. If the script needs an actual fix (narrow the banned-word regex to exclude font-family string literals), that's separate scope from whatever branch surfaced it.

---

## Session: PR3 eng review + design review, COMMS-box BEATGRID v1 (2026-08-15)

#### Reading a Screenshot Yourself Is Not the Same as Showing It to the User

- **Lesson**: Built a wireframe, screenshotted it, and used the Read tool to look at it myself — then kept talking about "Frame 3" and "Frame 4" as if the user had seen them too. They hadn't. The Read tool result is visible to the model, not necessarily surfaced to the user's chat the same way. Caused real, multi-turn confusion ("i have no idea what we are even talking about right now") before it was caught.
- **Rule**: Reading a screenshot/image with your own tools proves you looked at it. It does not prove the user has. If the user needs to see something, publish it (Artifact, or whatever the environment's actual user-visible delivery mechanism is) and hand them a real link/reference, not just a description of what you saw.
- **How to apply**: Before referencing specific visual details ("the dark strip," "Frame 3") in conversation, confirm the artifact was actually published/delivered to the user this turn — not just generated and inspected internally.

#### Disagreement Is Wanted — But Only When Grounded in Actual Understanding

- **Lesson**: User said directly: "i like that you disagree with me, but only when you actually understand what im saying." This followed a sequence where an early disagreement (about where a UI element should live) turned out to be based on incomplete comprehension of what was being proposed, not a real architectural objection — corrected once the actual code/intent was verified.
- **Rule**: Pushback is explicitly valued on this project — don't default to agreement. But pushback must be earned by genuinely understanding the proposal first (re-read, re-verify, ask if unsure), not by pattern-matching to a surface-level objection.
- **How to apply**: Before disagreeing with a design/architecture proposal, silently check: have I actually confirmed what's being proposed against real code/data, or am I reacting to my own assumption of what was said? If the latter, verify first, then decide whether the disagreement still holds.

#### D's Catalog Is Hip-Hop/R&B — Never Use a Different Genre as the "Example"

- **Lesson**: Built a wireframe example for the onset-envelope explainability feature using the `house` genre archetype (four-on-the-floor, evenly-spaced spikes) — technically convenient since it was the first fixture reached for, but D's actual music is hip-hop/R&B. User caught it: "our stock build is around Ds catalogue so hip hop and r&b" and "this is Ds platform. not to forget."
- **Rule**: Any illustrative/example data on this platform — mockups, test cases, demo content — should default to hip-hop/R&B, not a generic or arbitrary genre, even when other genres exist in the codebase for validation-suite completeness. The platform's whole premise is serving D specifically, not genre-agnostic correctness.
- **How to apply**: Before choosing example data for a demo/mockup, check whether it should reflect D's actual catalog (hip-hop/R&B) rather than whatever fixture is technically closest at hand.

#### DESIGN.md Rules Can Be Overridden by Direct Owner Authority — But Must Be Recorded, Not Silently Bent

- **Lesson**: A confidence-badge color law ("always neutral, never red/green-coded") was correctly flagged as violated by an outside-voice review, then explicitly overridden by the user ("my word is law... there are colours in the VU AND WF AND SA"). The override turned out to be well-reasoned on its own terms too (the rule was meant for static chrome, not genuine instrument-style meters) — but the override itself was the user's call to make regardless.
- **Rule**: When the user directs an explicit override of a documented DESIGN.md rule, comply — don't keep re-litigating after they've decided. But the override must be written back into DESIGN.md itself (dated, with reasoning), not left as a silent contradiction between what's documented and what's actually built — that's exactly the kind of drift that's caused confusion in past sessions (see the `--text-muted` stale-value incident, 2026-08-14).
- **How to apply**: Owner override of a design law → update DESIGN.md's rule text AND its Decisions Log in the same session, with the date and the reasoning given. Never just build the exception and leave the doc stale.

---

## Session: /design-review contrast audit + button/discoverability audit scoping (2026-08-16)

#### The Screenshot-Visibility Lesson Recurred — Environment Doesn't Excuse Skipping It

- **Lesson**: Same mistake as the 2026-08-15 entry above, verbatim: ran a `/design-review` contrast pass, took before/after screenshots with the browse tool, read them with the Read tool myself, and narrated them ("look at SIGNAL, B/C/D...") as if the user had seen them. They hadn't — this user's environment only lets them review changes once deployed live ("i cant see anything... i can only see once its deployed live"). Caught only because the user said so directly, not because I checked first.
- **Rule**: A logged lesson recurring once is a signal the "how to apply" step was never actually built into the workflow — it was just remembered as a fact, not a checkpoint. For this user specifically: screenshots taken during work are for *my* verification only; they cannot substitute for showing the user anything. The user's own review loop is the deployed site, not chat images.
- **How to apply**: Before describing visual results to this user, ask: has this been deployed (or otherwise published somewhere they can actually open)? If not, either deploy first or explicitly say "you won't be able to see this until it's deployed — want me to push it live?" rather than walking through screenshots as if shared.

#### `tasks/lessons.md` Session-Start Read Was Skipped Again Mid-Session

- **Lesson**: Ran a full `/design-review` pass, made two commits, and pushed to production — all before reading `tasks/lessons.md`, which CLAUDE.md's session-start checklist requires as step 1 and which already contains an entry (2026-08-12) explicitly warning that skipping this file is a recurring failure mode. Only read it when the user asked a follow-up question and referenced "lessons or context-restore" directly.
- **Rule**: Invoking a skill (`/design-review`) does not substitute for the session-start checklist — same conclusion the 2026-08-12 entry already reached about `/context-restore`. Skills load their own preamble/context; none of them read this project's `tasks/lessons.md` or `NEXT_SESSION.md` for you.
- **How to apply**: Read `tasks/lessons.md` and `NEXT_SESSION.md` before the first substantive action of a session — before invoking any skill, not just before writing code directly. If a skill was already invoked before this happens, stop and read them at the next natural pause, not only when the user has to ask.
