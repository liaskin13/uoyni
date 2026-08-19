# Next Session — Resume Here

**Last updated:** 2026-08-19 (later evening — CONF % / funk-soul confidence
finding, L's explicit top priority for next session)

## Status

## ⚑ TOP PRIORITY — CONF % badge scope mismatch (research-confirmed, not just theory)

L confirmed this against D directly — D's own explanation of why his
confidence reads lower on some genres matches the research exactly. Full
writeup in `TODOS.md`'s "CONF % badge + octave-correction are scope-mismatched
with D's actual catalog" entry (now marked HIGH priority) — **read that
entry in full before doing anything else this session.**

Short version: the confidence score mathematically measures how perfectly
periodic a track's rhythm is (autocorrelation strength). Funk/soul music
deliberately isn't rigidly periodic — that's *microtiming*/"groove," a real,
researched phenomenon, not noise. Lower confidence on funk/soul is the
detector correctly measuring less rigid timing, not a bug. Rekordbox's real
answer to this exact problem (funk/disco/live material) is a completely
different mode — "Dynamic" multi-point analysis instead of one BPM number —
which maps directly onto this codebase's own already-shipped but unsurfaced
`detectTempoSegments`/beatgrid system. Don't try to raise confidence on
funk/soul tracks; that would mean quantizing away the actual groove. The
real next step is likely surfacing the multi-point system instead of
patching the single-tempo badge — but that's a product decision with D/L,
not yet made.

**2026-08-19 (evening) — WF Deck spacing tightened, shipped + deployed:**

Commit `1e18132`, live at uoyni.com (verified via `wrangler pages deployment
list` + `curl` 200, not inferred). Full detail in `TODOS.md`'s "WF Deck
header/meter/beat-indicator spacing tightened" entry — read it before
touching the deck header, meters, or beat-indicator area again.

Short version: header/meter/beat-indicator spacing reduced to on-scale
values, beat indicator resized 36→24px and now collapses to 0px by default
(new `BEAT` toggle in the BPM row controls it, decoupled from waveform
hover). Went through `/plan-design-review` + `/plan-eng-review` (with an
outside-voice subagent) before writing code — both caught real bugs
pre-implementation (WCAG contrast failure, a savings-math error, a
toggle-redraw gap, a margin-collapse gap, a disabled-state CSS gap, 5 e2e
tests that would have broken). All folded in before shipping.

**A live button/pad-border visual-language unification was tried (real CSS
injected into the running console, screenshotted, published as a comparison
page) and rejected outright by L** — "it looks worse. period." **Do not
resurrect this direction without a fresh design conversation.**

**Not yet verified by D.**

**Open follow-up, not yet confirmed still wanted:** a console-wide
`aria-pressed` audit (SMART button + 6 settings-panel toggles missing it) —
surfaced during the design review, L said "build it now" at one point but
it didn't end up in the final shipped scope. See TODOS.md entry — ask L
before picking it up.

**2026-08-19 (earlier same day) — three more pieces of work, all live:**

1. **Codespace GPG-signing 403 — RESOLVED, not just another bypass.** Root
   cause: `gh-gpgsign` requires `git config user.name` to match the **GitHub
   profile's display name** (`gh api user --jq .name`), not the login. This
   Codespace's `/etc/gitconfig` had the stale login value (`liaskin13`) while
   the profile name is `"lisa marie"` — confirmed by reproducing the 403 both
   ways. Fixed via a repo-level `git config user.name` override (commit
   `46d2beb`). The repo-rename theory from earlier today was reasonable but
   wrong — `GITHUB_REPOSITORY`/`gh auth status` already reflected the rename
   correctly. Full writeup in `tasks/lessons.md` and `TODOS.md` (marked
   RESOLVED). **Do not re-open this investigation** — if the 403 recurs in a
   different repo/Codespace, diff `git config user.name` against
   `gh api user --jq .name` first.
2. **Hot-cue chronological auto-sort + triangle bank glyphs** (commit
   `a8587ef`, deployed to production, confirmed via `wrangler pages
   deployment list` + live `curl uoyni.com` 200). The 32 pads (4 banks × 8)
   now form one continuous chronological sequence by default (toggle,
   `SORT ON`/`OFF` next to `CLR`) instead of 4 fixed-slot containers —
   researched Serato's real "Sort Cues and Loops Chronologically" preference
   before building. Labeling a cue pins it (excluded from auto-sort, frozen
   pad). Pads now show a triangle instead of a number (orientation = A/B vs
   C/D, solid/hollow fill = which bank in the pair) and every bank renames on
   double-click, not just D. New `src/lib/hotCueLayout.js` (pure,
   unit-tested, 10 tests) is the single source of truth for pad position; see
   DESIGN.md's Hot Cues section for the full spec. **Not yet verified by
   D** — only checked live by L/Claude in a browser session this turn.
3. **T9B (confidence-meter companion) — CANCELLED, not deferred.** L: "T9B
   WAS CANCELLED ugly & stupid like the energy meter was." Don't resurrect
   without a fresh design conversation. TODOS.md updated to match.

Also: the `feedback_0000_is_permanent_feature` memory from earlier today was
**wrong and has been corrected** — `0000` is test-only scaffolding per L,
scheduled for removal before public launch, not a permanent feature. The
code comments in `worker/upload-worker.js`/`RequestAccessModal.jsx` still say
"permanent" — stale, worth cleaning up whenever `0000` itself is removed.

**2026-08-19 (earlier same day) — two pieces of work, both live in production:**

1. **Gapless loop engine** (commits `0a7971f` + `2cb40cd`) — merged to
   `main`, deployed to **production** (not just a preview — confirmed via
   `wrangler pages deployment list` showing a Production deployment built
   from `2cb40cd`, plus a live `curl uoyni.com` 200). Full detail in
   `TODOS.md`'s "Full sample-accurate gapless loop engine" entry.
   **Still needs D's actual listening pass** — the real acceptance test,
   can't be automated, hasn't happened yet.
2. **Guest session persistence + revalidation** (commit `ac2b4a2`) — built
   by GitHub Copilot while this session was interrupted (hit an API session
   limit mid-`/ship`) and L was manually finishing the loop-engine deploy
   ("had to use copilot... it really sucked"). Reviewed on resume: caught
   and fixed a **live production regression** — the `0000` public
   guest-access code (shown to every real guest by
   `RequestAccessModal.jsx`) had been accidentally gated behind a
   nonexistent env var, so new guests were hitting "Code not found" in
   production. Fixed and deployed immediately, confirmed live. Full
   writeup + the lesson for next time in `TODOS.md`'s "Guest session
   persistence + revalidation" Completed entry — **read it** before
   touching `/redeem` or anything checking `code === "0000"` again.

**PR3 (T7-T14) shipped 2026-08-15** — confidence badge, tap tempo,
envelope explainability, validation panel, v1.4.0.0 (commit `4117150`,
PR #12). The section below describing PR3 as "not implemented yet" is
historical — don't act on it.

**2026-08-16 session — two passes, both shipped and deployed to uoyni.com:**

1. **Console contrast/legibility pass** (`/design-review`): idle-state text
   on ~15 button classes and the entire track-list content column (title/
   artist/status) were below WCAG AA for their font size — as low as 1.99:1.
   Brightened to a real legibility floor, not just the bare minimum. Two
   commits, DESIGN.md Decisions Log has the exact numbers.
2. **Console-wide button/discoverability audit** — the initiative TODOS.md
   had been tracking since 2026-08-11 (D's "can't clear one hot cue"
   complaint). Full accounting of every control both agents found (chosen
   and explicitly not) is in the session's build plan; shipped: HISTORY
   filter bug fixed (was bound to the wrong state entirely), individual
   hot-cue clear on all 4 banks, COMMS keyword-help made actually
   findable (was invisible since PR3 shipped it), `?` shortcuts trigger,
   beatgrid idle hint (biggest single gap found), Smart Crates implemented
   for real (was a dead toggle — nothing read the value; researched
   Serato's actual feature before building), ~25 tooltips, ACCESS CODES
   REVOKE confirm dialog. See DESIGN.md's Hot Cues / Smart Crates / Beatgrid
   sections and its 2026-08-16 Decisions Log entries.

**Deliberately not built, both flagged rather than guessed at:**

- Octave-correction UX (deck-header exposure + no reset-after-use signal)
  — new TODOS.md entry, needs a small design decision first.
- Whether D should be able to reach admin-tier rail panels (CMD MATRIX/
  ACCESS CODES/VOID PROTOCOL/ARCHIVE LOG) — **resolved, not deferred**: L
  confirmed directly this is intentional (D has full access if needed, the
  admin side just isn't part of his regular workflow). ARCHIVE LOG's
  "Architect access only" text was corrected to match reality.

Separately: the Codespace GPG commit-signing bug (tracked in TODOS.md)
recurred again this session, same as every session since 2026-08-13 —
bypassed with `--no-gpg-sign` after explicit approval each time, same as
before. **2026-08-19 — L finally has a real, testable lead: "its cuz i
changed the name to uoyni from psoulc on git and added my name too."** The
repo was renamed on GitHub (`psoulc` → `uoyni` — confirmed real mismatch:
`git remote get-url origin` → `.../uoyni.git`, but the local directory is
still `/workspaces/psoulc`) around the same time the commit author name
changed. Either could have desynced the GitHub App-issued signing identity
`gh-gpgsign` expects. This is now the #1 priority for next session — see
TODOS.md's "Investigate root cause of recurring Codespace commit-signing
failures" entry for the exact next steps (`gh api user`, `gh auth status`,
checking whether the signing app's grant survived the rename). Do not
re-diagnose from scratch or write anywhere that this is resolved/
environment-specific until that lead has actually been tested.

### PR3 decisions (historical, superseded — PR3 shipped 2026-08-15, kept for reference)

- **T9's badge is colored** (5-band SA palette, discrete, not a gradient) —
  overrides DESIGN.md's prior "confidence badge always neutral" rule, by L's
  explicit direction. Live in DESIGN.md's Decisions Log — don't re-read the
  rule as if it still says neutral-only.
- **T9b (a companion always-on meter) was designed, cut, then formally
  CANCELLED 2026-08-19** ("ugly & stupid like the energy meter was" — L).
  Don't rebuild it without a fresh design conversation — this isn't a
  "revisit later" item anymore.
- **T12 (cross-instrument pulse) has NOT shipped** — no commit found for it
  as of 2026-08-16. Still its own isolated PR, still the only item with real
  regression risk (touches shared SA/WF/VU rendering), still includes a
  bundled pre-existing click-seek-during-zoom bug fix. If picked up, read the
  CEO plan doc referenced above for the exact spec — don't re-derive it.

## Start here next session

1. **D's listening pass on the gapless loop engine** — the real acceptance
   test for that fix, still hasn't happened. Not something to build, just
   something to chase down/confirm.
2. **D's feedback on the hot-cue redesign** (chronological auto-sort +
   triangle bank glyphs, shipped 2026-08-19) — same situation, only checked
   live by L/Claude so far, not by D actually using it.
3. **T12 (cross-instrument pulse)** — the one piece of PR3 still unshipped.
4. **GOD MODE MOBILE guest-flow redesign** — L said directly "i have to do a
   full design redo on the entire guest flow." Not scoped yet (see section
   below for context to bring into that).
5. **Octave-correction UX** (TODOS.md entry, 2026-08-16) — needs a small
   design decision (where does the deck-header version of the control live)
   before building.
6. Everything else: read `TODOS.md` for the full ranked list. (GPG signing
   is now RESOLVED — don't re-add it here or re-diagnose it.)

---

## Prior session's still-open items (GOD MODE MOBILE, 2026-08-14) — unchanged, not yet started

**L said directly: "i have to do a full design redo on the entire guest
flow."** Not scoped yet — this is the natural next `/office-hours` or
`/design-consultation` topic. Context to bring into it:

- The contrast brightening done this session (`--text-secondary` ~4.5:1 →
  ~7.15:1, `--text-muted` → ~5.9:1, platform-wide via `variables.css`) was
  explicitly scoped as a stopgap — L said the muted-token bump was visually
  subtle and chose to leave it rather than patch further, since the real
  redesign is coming. Don't treat the current guest-flow visuals as settled.
- **DESIGN.md's color documentation has drifted from the real CSS**, found
  twice this session: `--text-secondary`/`--text-muted` were documented as
  different rgba opacity values than the actual hex values in
  `variables.css` (they'd become nearly-identical colors despite the prose
  describing them as distinct); `--text-primary`'s code comment says "warm
  off-white" while DESIGN.md's prose says "ZERO WARMTH... cold achromatic
  only." Worth a DESIGN.md-vs-variables.css reconciliation pass as part of
  (or before) the redesign, not just eyeballing the prose.
- D needs glasses and is "in denial" (L's words) — real accessibility
  constraint for the redesign, not just aesthetic preference.

After that (unchanged from before, still not started):

1. **Capability 2 — request-review queue**: a stranger submits REQUEST
   ACCESS on the entry screen → lands in L's console for review/approval.
   Explicitly deferred this session as a separate build — needs a new D1
   table (no `access_requests`-equivalent exists), request states, and a
   notification strategy (no email/SMS infra in this codebase). Full
   context: this session's design doc, Open Question 3.
2. ~~Console-wide button/control review~~ — **SHIPPED 2026-08-16**, see
   Status above. HISTORY filter bug (below) fixed as part of it.
3. **Verify D's tablet experience** — confirmed this session D does use a
   tablet, but whether the (untouched) desktop console is actually usable
   at that width was never checked. Ask D directly.
4. ~~Build the COMMS-box keyword-help system (BEATGRID v1)~~ — **SHIPPED
   2026-08-15**, made actually discoverable 2026-08-16. See Status above.
5. Everything else tracked in `TODOS.md` — read that file for the full
   ranked list. HISTORY filter bug and the hot-cue-clear item are now
   closed; the Codespace GPG-signing bug is now RESOLVED too (2026-08-19,
   see Status above) — don't treat it as open.

---

## Key technical notes (still current)

### Deploy sequence (every session — see CLAUDE.md for full detail)

```
git add <files> && git commit -m "..."
git push
cd worker && npx wrangler deploy   # only if worker/ changed; needs CLOUDFLARE_API_TOKEN exported
npm run build && npx wrangler pages deploy dist --project-name psoulc   # only if frontend changed
```

Cloudflare Pages is direct-upload only — pushing to `main` does NOT deploy
the frontend by itself.

### D1 migrations

Must be applied manually via the Cloudflare dashboard D1 console **before**
deploying worker code that references new columns — the configured API
token has zero D1 access via `wrangler`, not even read-only PRAGMA/SELECT.
Confirmed empirically 2026-08-13.

### Verify before claiming something is/isn't shipped

Git-status snapshots injected at conversation start (and prior-session
summaries, especially after a context compaction) can go stale mid-session.
Before asserting anything about ship/deploy state, re-check live: `git log`,
`gh pr list`, `wrangler pages deployment list`, `wrangler deployments list`,
`curl .../health`. Learned the hard way this session — a stale snapshot
briefly made fully-shipped, deployed work look uncommitted.

### DESIGN.md

Still the sole canonical design doc — read it before touching any CSS/JSX.
It currently has zero coverage of the COMMS/REACH LCD family
(`src/console/ContextStrip.jsx`/`.css`) — the COMMS-help build above should
add a short new section for it as part of that work.

---

## Superseded — everything below predates 2026-05-20

This file went unmaintained for a long stretch: waveform v2, SA 5-band Bark
color science, beat detection PR1/PR2, batch upload, and the guest-flow
aurora redesign all shipped after the content below was last accurate, with
no update here. Kept for historical reference only — do not treat anything
below as current state. `TODOS.md` and `~/.claude/plans/vivid-finding-riddle.md`
are the live sources of truth going forward. The CHANGELOG backfill TODO
exists specifically to reconstruct real project history from `git log`;
check there once it's done rather than trusting old notes like these.

---

**Last updated:** 2026-05-20 (session 3)

## Status

Guest flow adapt + animate COMPLETE. Critique score **35/40** (25→27→31→35). All shipped to uoyni.com. Zero P0/P1/P2 issues — two P3s remaining.

---

## DONE this session (session 2 — bolder/harden)

### v3 guest flow — full implementation (commit 3d0aebe)

- `src/listener/ListenerVaultView.jsx` + `src/listener/ListenerVaultView.css` (new files)
- `src/listener/ListenerShell.jsx`: duration hero, vaultStats, openVault on stage click
- `src/index.css`: breathing hint, duration hero classes, safe area fix

### 8 iPhone 13 bugs fixed (commit 5e867ec)

1. Waveform visibility: unplayed bars 0.28 → 0.55 opacity
2. Dock tab: tapping active tab now enters vault via openVault()
3. Persistent playback: back keeps music playing; mini-transport strip in track list
4. Play icon: unicode ▶ replaced with clean SVG polygon
5. Waveform seek: tap playing canvas to seek to that position
6. Stage safe area: `.listener-stage` inset accounts for `env(safe-area-inset-top)`
7. Welcome screen overflow: `overflow:hidden`, clamped font, padding
8. Text sizes: subtitle/meta 8px → 10px, meta contrast raised

### Waveform rAF fix + header layout (commit 77e7ad2)

- `WaveformCanvas`: stable rAF draw loop, refs for currentTime/duration, `getBoundingClientRect()`
- `lvv-header`: `height: 44px` → `calc(44px + env(safe-area-inset-top, 0px))`

All three commits pushed and deployed to uoyni.com.

---

## Bolder/harden changes (session 2, all shipped)

- Scrolling zoom waveform: 40 bars visible, playhead always centered (`VISIBLE=40`)
- Overview strip: 16px thin full-track canvas, seekable
- WAVE mode: correct Serato display colors via `seratoRgb()` GEOB mapping (bass=orange, mid=green, high=yellow-white)
- FREQ mode (was HEAT): amplitude rainbow via `heatColor()` fn
- WAVE/FREQ toggle on playing screen
- Ghost waveform seekable: tap seeks + auto-plays via `handleGhostSeek`
- DPWallpaper in ListenerShell at opacity 0.35
- `--vault-color` propagated to duration hero, dock, transport status, play SVG, viz toggle
- Error state: COULDN'T LOAD + RETRY (playerState === 'error')
- Transport time readout: elapsed · −remaining in Space Mono, both full player AND mini-transport
- Audio loading state: `isAudioLoading` boolean; play button shows LOADING dot during `audioEngine.load()`
- TAP WAVEFORM TO SEEK hint on paused screen (hidden during loading)
- ThumbnailCanvas: updated to Serato display colors

Critique: 25 → 27 → 31 → 33/40. Zero P0/P1. Slug: `guest-flow-listenershell-listenervaultview`.

---

## Start here (session 3, historical — superseded by the "Start here next session" section above)

1. **Zone B: ACCESS CODES panel** for L — highest priority feature backlog
2. **D needs to publish 4 more mixes** (only 1/5 published currently)
3. **Waveform zoom fix in console**: `zoom={1}` hardcoded at `src/console/ArchitectConsole.jsx:1680`
4. **Migration 0006: cue_labels column** (D-bank cue persistence)
5. ~~Push critique to 35+~~ — DONE (35/40 as of session 3)
6. **[P3] Vault name in player header**: LVV header always shows "LISTENING ROOM / CURATED BY D" regardless of vault — add vault label at ~20% opacity
7. **[P3] Welcome interstitial duration**: 1.2s may feel like a loading screen; consider 2.5s with "BROWSE THE VAULTS BELOW" subtitle

---

## Key technical notes (session 3, historical)

### Canvas rendering (HARD-WON this session)

- `canvas.offsetWidth` returns 0 on Chrome/iOS before layout settles → use `getBoundingClientRect()` as primary
- `currentTime` in draw `useCallback` deps → ResizeObserver thrashes at 250ms → nothing draws
- Pattern: `currentTimeRef` + `durationRef` updated via `useEffect`, rAF loop for continuous redraw
- See `src/listener/ListenerVaultView.jsx` WaveformCanvas (lines ~68-160)

### Safe area header pattern

- Fixed-height headers with safe-area padding must use: `height: calc(44px + env(safe-area-inset-top, 0px))`
- NOT `height: 44px` — that causes content to be hidden behind the notch

### Dev server

Use `npm run preview` not `npm run dev` (react version mismatch causes dev server issues) — note: a later session (PR #9, 2026-08-12) fixed the underlying react/react-dom version mismatch; re-check whether `npm run dev` works fine now before assuming this workaround is still needed.

### Waveform colors (confirmed by L — no green bars)

- Played bars: `#14dc14` (identity green)
- Unplayed bars: `rgba(240,237,232,0.55)` — off-white only
- Ghost (paused state): `rgba(240,237,232,0.11)` — intentionally subtle
- Thumbnails (track list): `rgba(240,237,232,0.55)` — same off-white

### File boundaries

- `src/listener/ListenerVaultView.jsx` — all player/waveform changes
- `src/listener/ListenerShell.jsx` — vault shell, dock, duration hero
- `src/listener/ListenerVaultView.css` — vault player styles
- `src/index.css` — global + ListenerShell styles
- DO NOT touch `src/console/VaultView.jsx` — old D-console vault, separate codebase

---

## Already done (do NOT redo) — session 3, historical

- Audio CORS fix: worker proxy `/audio/*` + `crossOrigin="anonymous"` (commit 2e476df)
- Design findings 001–003+007: committed and deployed
- DESIGN.md: Guest Flow + Voice Comments spec written
- v3 guest flow full implementation
- All 8 iPhone 13 device bugs fixed and deployed (commits 5e867ec, 77e7ad2)
