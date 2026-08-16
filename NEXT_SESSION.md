# Next Session — Resume Here

**Last updated:** 2026-08-16 (console-wide button/discoverability audit:
contrast pass + full functionality pass, `/design-review` + direct build,
context-save/learn closeout)

## Status

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
before. New finding this session: L has been disconnected/reconnected to
this Codespace many times a day since the 13th, and the bug still recurs
regardless — rules out the "stale token, try a restart" theory that TODOS.md
had as its leading hypothesis. Still not root-caused.

### PR3 decisions (historical, superseded — PR3 shipped 2026-08-15, kept for reference)
- **T9's badge is colored** (5-band SA palette, discrete, not a gradient) —
  overrides DESIGN.md's prior "confidence badge always neutral" rule, by L's
  explicit direction. Live in DESIGN.md's Decisions Log — don't re-read the
  rule as if it still says neutral-only.
- **T9b (a companion always-on meter) was designed, then cut** — don't
  rebuild it without a real reason. TODOS.md: "revisit only if the badge
  alone proves too slow to scan."
- **T12 (cross-instrument pulse) has NOT shipped** — no commit found for it
  as of 2026-08-16. Still its own isolated PR, still the only item with real
  regression risk (touches shared SA/WF/VU rendering), still includes a
  bundled pre-existing click-seek-during-zoom bug fix. If picked up, read the
  CEO plan doc referenced above for the exact spec — don't re-derive it.

## Start here next session

**No single blocking priority right now** — both of this session's passes
(contrast + discoverability audit) are shipped and deployed. Real open items,
ranked:

1. **T12 (cross-instrument pulse)** — the one piece of PR3 still unshipped.
2. **GOD MODE MOBILE guest-flow redesign** — L said directly "i have to do a
   full design redo on the entire guest flow." Not scoped yet (see section
   below for context to bring into that).
3. **Octave-correction UX** (new TODOS.md entry, 2026-08-16) — needs a small
   design decision (where does the deck-header version of the control live)
   before building.
4. **GPG signing root cause** (TODOS.md) — still unsolved, and the "try a
   restart" lead is now ruled out (see Status above). Needs someone to look
   outside the Codespace session boundary.
5. Everything else: read `TODOS.md` for the full ranked list.

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
   closed; the Codespace GPG-signing bug is still open (Medium priority,
   the "try a restart" lead is now ruled out — see Status above).

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
