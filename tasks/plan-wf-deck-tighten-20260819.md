# Plan: Deck + Header spacing/sizing (WF Deck) — trimmed scope

Branch: main · Files: `src/console/ArchitectConsole.jsx`, `src/console/ArchitectConsole.css`
Status: **NOT APPROVED. No code has been changed. `git status`/`git diff` on
both files are clean — verified, not assumed.**

Scope: **height/size changes only**, in the deck header and deck-zone. This
plan replaces an earlier, broader draft — everything not listed under "In
scope" below was explicitly cut per direct instruction.

## In scope

**1. Header height** (`.arch-deck-meta`)
- `margin-bottom: 10px → 8px`
- `padding-bottom: 6px → 4px`
- Savings: 4px

**2. Meter row vertical spacing** (`.arch-analyzer-row`) — height only
- `margin-top: 8px → 4px`
- Savings: 4px
- **Not touched:** the horizontal gap between the L/R VU needles (3px) and
  between the VU block and spectrum block (8px) — those are widths, not
  sizes/spacing in the vertical sense you asked about. Left exactly as-is.

**3. Beat indicator height** (`.arch-envelope-canvas`, the row under the
main waveform)
- `36px → 24px` (canvas height, and the `ENVELOPE_ROW_H` constant in the JS)
- `margin-bottom: 8px → 4px`
- Stays under the 32px overview strip (currently violates that — 36px is
  bigger than the full-length waveform strip, which is backwards)
- Savings when visible: 16px
- **Eng review finding (verified by reading the draw code):** `ArchitectConsole.jsx:2830`
  hardcodes `const ENVELOPE_ROW_H = 36`, which drives the canvas's actual
  backing-store size (`canvas.height = Math.round(ENVELOPE_ROW_H * dpr)`,
  ~line 2843) and its `clearRect` bounds. **Must update this constant to 24
  in the same change as the CSS** — if only CSS changes, the canvas backing
  store stays 36px while the visible box shrinks to 24px, and the browser
  squishes the rendered content to fit. This is a separate line from the CSS
  edit and easy to miss.

**4. Beat indicator collapses when off**
- New state, default OFF, so the row is 0px height until turned on
- CSS transition on height (not an abrupt jump)
- Decoupled from waveform hover — currently hovering the waveform both
  reveals this row AND arms `↑`/`↓` zoom, at the same time, off the same
  gesture. This separates them: hovering only controls zoom; a new toggle
  (item 5) controls visibility.
- **Eng review finding:** `.arch-rail`/`.arch-rail--open` (`ArchitectConsole.css:1671-1696`)
  already implements this exact recipe — collapse to 0, expand via a
  modifier class, CSS transition — for the sidebar rail. Reuse its structure
  and easing (`transition: height 220ms cubic-bezier(0.25,1,0.5,1)`) instead
  of inventing new timing. New class: `.arch-envelope-row--open`, matching
  the existing `--open` naming convention (not `--visible`).
- **Eng review finding (performance):** `drawEnvelopeRow()` currently fires
  on every `mousemove` while hovering the waveform (`jsx:2874`, via
  `handleEnvelopeHover`). Guard it with `if (!beatDetectVisible) return;` at
  the top — otherwise it keeps running the full window-computation + canvas
  draw on every mousemove into a 0-height, invisible canvas whenever BEAT is
  off (the default state).
- **Outside-voice finding (redraw gap), folded in:** flipping `beatDetectVisible`
  to true does NOT by itself trigger a redraw — `drawEnvelopeRow()` only runs
  from `mousemove` or the track-load effect (`jsx:2821`). Without an explicit
  call, turning BEAT on shows stale/blank canvas content instead of the idle
  hint until the next hover. **Fix:** call `drawEnvelopeRow()` directly inside
  the toggle's `onClick`, not just the state flip.
- **Outside-voice finding (margin-collapse math), folded in:** the collapse
  must explicitly zero `margin-bottom` too, not just `height` — mirroring how
  `.arch-rail--open` zeroes `padding` alongside `width` (css:1690-1693). If
  `margin-bottom` stays at 4px while collapsed, the claimed 44px/16px savings
  in the height-math table are each off by 4px. Both `height: 0` and
  `margin-bottom: 0` belong on the closed (non-`--open`) state.

**5. A toggle to turn item 4 on/off**
- Lives in the BPM row, small button, label `BEAT`
- Needed because without a toggle, item 4's "collapse when off" has no way
  to turn back on
- Reuses the existing compact-button *shape* already used for TAP tempo (size/
  padding/font only)
- Disabled when no track is loaded (matches how CUE/loop buttons already behave)
- **Outside-voice finding, folded in:** TAP tempo (the button whose shape is
  being reused) is conditionally *unmounted* when no track is loaded — it
  never needs a disabled state and has no disabled CSS defined anywhere. CUE/
  loop (the buttons whose disabled *behavior* is being reused) are
  always-mounted with real `disabled` styling. Borrowing shape from one and
  behavior from the other means disabled-state CSS for BEAT doesn't actually
  exist yet. **Fix:** BEAT must be always-mounted (not conditionally
  rendered like TAP) with its own real `:disabled` CSS, patterned after
  CUE/loop's existing disabled treatment, not assumed to come free from
  TAP's shape.

## Deck height math

| Change | Height delta |
|---|---|
| Header | -4px |
| Meter row margin-top | -4px |
| Beat indicator (default, off) | -44px |
| Beat indicator (toggled on) | -16px |

**Total returned to the library: 52px by default (BEAT off), 24px when BEAT
is on.** The library grows automatically because the deck sits in an `auto`
grid row and the library sits in the `1fr` row right below it — shrinking
the deck's height is the same lever as growing the library.

## Explicitly cut from this plan (was in an earlier draft, removed)

- Button/pad visual-language unification (transport buttons, hot-cue pads,
  vault tabs) — you saw it live, rejected it outright.
- Library header row style matching — was part of the same rejected direction.
- Cue-cluster gap collapse (5 gap values → 2) — tied to the rejected direction.
- VU L/R gap and VU↔spectrum gap changes — these are widths, not your concern.
- Console-wide `aria-pressed` audit on unrelated settings-panel toggles — not
  spacing/sizing in the deck, out of scope for this plan.

## Required — existing tests that will break (eng review, mandatory per IRON RULE)

`tests/e2e/envelopeRow.spec.js` has 5 Playwright tests, **all 5 assert
today's "always visible" behavior directly**:
- `L121-140` "envelope row is always present" — `expect(canvas).toBeVisible()`
  before any hover or track load
- `L142-159`, `L161-198`, `L200-228`, `L230-275` — all hover the waveform and
  expect the canvas to already be visible/redrawing

This isn't a hypothetical regression — these are real, passing tests today
that encode the exact behavior this plan intentionally changes. **They must
be updated as part of this implementation**, not discovered later in CI:
each needs to click the BEAT toggle before asserting canvas visibility (or
be split so idle-state assertions run with BEAT off and hover/redraw
assertions run with BEAT on). Two new assertions also need writing from
scratch (no existing pattern to copy — first of their kind in this suite):
BEAT `.toBeDisabled()` with no track loaded, and `aria-pressed` reflecting
toggle state.

## Verification (after implementation, not before)

1. `npm run build`
2. `npm test` (vitest) — confirm no unit-test regressions
3. Update and re-run `tests/e2e/envelopeRow.spec.js` per above — all 5 must
   pass against the new toggle-gated behavior
4. Live screenshot before/after: header, meter row, beat indicator collapsed,
   beat indicator expanded
5. Confirm `↑`/`↓` zoom still works on waveform hover with BEAT both on and off
6. hotCueLayout.js tests unchanged — nothing here touches cue positioning

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific
finding above. Run with Claude Code or Codex; checkbox as you ship.

- [ ] **T1 (P1, human: ~15min / CC: ~5min)** — Header — reduce
  `.arch-deck-meta` margin-bottom 10→8px, padding-bottom 6→4px
  - Surfaced by: Item 1
  - Files: `src/console/ArchitectConsole.css`
  - Verify: screenshot diff, header height -4px
- [ ] **T2 (P1, human: ~10min / CC: ~5min)** — Meters — `.arch-analyzer-row`
  margin-top 8→4px only (no width/gap changes)
  - Surfaced by: Item 2
  - Files: `src/console/ArchitectConsole.css`
  - Verify: screenshot diff
- [ ] **T3 (P1, human: ~30min / CC: ~10min)** — Beat indicator resize —
  `.arch-envelope-canvas` 36→24px, `ENVELOPE_ROW_H` const 36→24,
  margin-bottom 8→4px
  - Surfaced by: Item 3, Architecture issue 1
  - Files: `src/console/ArchitectConsole.jsx`, `src/console/ArchitectConsole.css`
  - Verify: 24px < 32px overview strip; canvas not visually squished
- [ ] **T4 (P1, human: ~1h / CC: ~20min)** — Beat indicator collapse —
  `beatDetectVisible` state default OFF, `.arch-envelope-row--open` modifier
  class reusing `.arch-rail`'s transition recipe (220ms cubic-bezier(0.25,1,0.5,1)),
  zero BOTH `height` and `margin-bottom` in the closed state, guard
  `drawEnvelopeRow()` with `if (!beatDetectVisible) return`, call
  `drawEnvelopeRow()` explicitly in the toggle's `onClick` (not just the
  state flip), decouple from `waveformHoveredRef`
  - Surfaced by: Item 4, Architecture issue 2, Performance issue 3,
    outside-voice findings 1-2
  - Files: `src/console/ArchitectConsole.jsx`, `src/console/ArchitectConsole.css`
  - Verify: `↑`/`↓` zoom still arms on hover regardless of BEAT state;
    toggling on shows the idle hint immediately, not stale content
- [ ] **T5 (P1, human: ~45min / CC: ~15min)** — BEAT toggle — add to
  `.arch-deck-stats`, always-mounted (not conditionally rendered like TAP),
  own real `:disabled` CSS patterned after CUE/loop's existing disabled
  treatment, `aria-pressed`, disabled with no track loaded
  - Surfaced by: Item 5, outside-voice finding 3
  - Files: `src/console/ArchitectConsole.jsx`, `src/console/ArchitectConsole.css`
  - Verify: matches CUE/loop disabled pattern, not TAP's (which has none)
- [ ] **T6 (P1, human: ~1h / CC: ~20min)** — Update `tests/e2e/envelopeRow.spec.js`
  — all 5 existing tests need the BEAT toggle clicked before visibility
  assertions; add 2 new tests (disabled-when-empty, aria-pressed)
  - Surfaced by: Test Review (mandatory, IRON RULE)
  - Files: `tests/e2e/envelopeRow.spec.js`
  - Verify: all 7 tests pass (5 updated + 2 new)

## Completion Summary — /plan-eng-review

```
+====================================================================+
|         ENG PLAN REVIEW — COMPLETION SUMMARY                       |
+====================================================================+
| Step 0 (Scope)        | Accepted as-is — 2 files, no reduction gate |
| Architecture Review   | 2 issues found (ENVELOPE_ROW_H coupling,    |
|                        | reuse .arch-rail pattern)                   |
| Code Quality Review   | 0 additional issues (resolved via Arch #2)  |
| Test Review           | diagram produced, 1 critical gap (5 e2e     |
|                        | tests will break, folded in as T6)          |
| Performance Review    | 1 issue found (skip hidden redraw)          |
| NOT in scope          | written                                      |
| What already exists   | written                                      |
| TODOS.md updates      | 0 — everything folded into the plan          |
| Failure modes         | 0 critical gaps remain unaddressed           |
| Outside voice         | ran (Claude subagent, Codex not installed) — |
|                        | 4 findings, 3 folded in, 1 scope question    |
|                        | (kept together, user's call)                 |
| Parallelization       | sequential — both files touched by every item|
+====================================================================+
```

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Codex Review | `/codex review` | Independent 2nd opinion | 1 | issues_found | 4 findings (outside voice, Claude subagent), 3 folded in, 1 scope question resolved |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 7 issues found (2 architecture, 1 test-critical, 1 performance, 3 outside-voice), all folded into the plan as T1-T6 |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score 7/10 → 9/10 on an earlier, broader draft — that draft's button/pad-border work was subsequently rejected and cut; this review's scope (5 spacing/sizing items) supersedes it |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

**CROSS-MODEL:** No tension on findings 1-3 (concrete bugs, not opinions) — accepted. Finding 4 (scope split) was a genuine strategic question, not a bug; user chose to keep the plan as one unit rather than split it.

**VERDICT:** ENG REVIEW CLEARED (all 7 findings resolved and folded into T1-T6) — 6 implementation tasks ready, none built yet. Plan not yet approved for implementation — awaiting explicit go-ahead.

NO UNRESOLVED DECISIONS
