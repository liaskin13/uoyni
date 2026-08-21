# PSC TODOS

Deferred work captured during plan reviews. Each item includes why it was deferred
and enough context to pick it up cold.

---

### ~~CONF % badge + octave-correction are scope-mismatched with D's actual catalog~~ — RESOLVED 2026-08-20 (Dynamic Tempo Analysis)

**Status: Built.** The genre/bucket system below is the direct implementation
of this entry's own conclusion (surface `detectTempoSegments` via a real
ZONES badge, add a genre-aware threshold instead of patching the flat
single-tempo CONF badge) — see `~/.claude/plans/wise-leaping-charm.md`
(eng-reviewed CLEAR, design-reviewed CLEAR, both folded-in items below
closed in the same diff). ZONES badge replaces CONF+octave-control whenever
real measured drift exists (data-driven, not genre-driven);
`OCTAVE_CONTROL_CONFIDENCE_THRESHOLD` splits the octave-control trigger into
`{dynamic: 0.35, static: 0.6}` so groove-tolerant genres (DYNAMIC,
BREAKBEAT — D's catalog default) need a materially lower reading before
suggesting a correction, while static/EDM-like genres (HOUSE, TECHNO) keep
today's exact validated 0.6 behavior. Empirically grounded via a new
jittered funk archetype in `genreFixtures.js` (Phase 3), not guessed — real
microtiming lowers confidence (0.907→0.591 in the calibration sweep) while
BPM stays exact and `detectTempoSegments` never false-positives, proving
"groove ≠ drift."

**Priority (historical): HIGH as of 2026-08-19 — L flagged this as top priority for next
session** ("THIS IS PPRIORITY NOW"), after checking the finding against D
directly and confirming it matches his own lived sense of why funk/soul
tracks read lower confidence. Was Medium; elevated.

**Research confirms the root cause is real, not a guess (2026-08-19,
`/context-save` session):**

- **Neither Serato nor rekordbox shows a numeric confidence % to the DJ at
  all.** Serato just surfaces a (sometimes octave-wrong) BPM number plus a
  manual range override. Rekordbox's actual answer to variable/live-feel
  material is a **different analysis mode entirely** — "Dynamic" analysis,
  explicitly documented as "ideal for tracks with fluctuating tempos — live
  recordings, **classic funk, disco**, or rock," placing multiple beat
  markers instead of forcing one tempo ([Lexicon DJ writeup](https://www.lexicondj.com/blog/understanding-rekordbox-beatgrid-analysis)).
  That is architecturally the same idea as this codebase's own
  `detectTempoSegments`/multi-point beatgrid — which already exists, unused
  for this purpose.
- **Why funk/soul specifically scores lower is backed by real music-cognition
  research, not a detector flaw.** Funk/soul performance relies on
  *microtiming* — small, deliberate, non-quantized timing deviations between
  instruments, the actual mechanism of "groove" / "participatory discrepancy"
  ([ZGMTH: Microtiming in Early Funk](https://www.gmth.de/zeitschrift/artikel/1224.aspx);
  [Microtiming in Swing and Funk — PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4542135/)).
  The confidence score (`rawCorr / energy` in `estimateTempoPeriod`,
  `beatDetector.js:57-97`) mathematically measures how perfectly the onset
  envelope repeats at one fixed lag — i.e. it measures the **absence** of
  that microtiming. A rigidly-quantized EDM kick autocorrelates near-perfectly
  by design; a live funk groove autocorrelates worse **because the genre is
  deliberately not rigidly periodic**, not because detection failed. D's own
  explanation to L of why his confidence reads lower on some genres matches
  this exactly.
- **Conclusion: don't try to raise confidence on funk/soul material** — that
  would mean quantizing away the actual groove. The right move is surfacing
  the multi-point (`detectTempoSegments`) system that already exists for
  exactly this case, the same way rekordbox's Dynamic mode does, instead of
  patching the single-tempo CONF badge to pretend funk has one BPM.

**What:** Dug into why L never sees the CONF badge. Two independent causes,
both confirmed against real code:

1. **Display suppression.** `cleanBpm()` (`ArchitectConsole.jsx:56-59`) treats
   any non-empty `bpm_display` as "already known" — it doesn't distinguish a
   single BPM from a manually-entered range like "60-80" (which is exactly
   what's in D's real library rows: EIGHTYSIXTY = "60-80", another = "73-96").
   The badge's visibility gate (`!cleanBpm(bpm_display) && !bpm && detected_bpm
   != null`, `ArchitectConsole.jsx:2998-3002` and `:4122-4126`) is permanently
   false the moment a range exists. Same gate hides the octave-correction
   buttons.
2. **Design-intent mismatch, not just a display bug.** DESIGN.md line 342
   states the octave-correction control's actual purpose: "Corrects the known
   DP-beat-tracker octave-ambiguity failure mode (90 vs 180 BPM reading
   equally strong)." That premise assumes a track has **one real tempo** the
   detector might report at 2x/0.5x. D's mixes span wide ranges by nature —
   there's no single "real tempo" for the octave-correction UI to be
   correcting toward. The feature was built for a fixed-tempo-track use case;
   D's catalog is the opposite of that.

**What's NOT dead:** `detectTempoSegments` (`beatDetector.js:290`, wired via
`waveformAnalyzer.js:600` → `handleBeatGridPointsChange`,
`ArchitectConsole.jsx:1641-1642`) is a separate, already-shipped,
variable-tempo-aware system — multi-point beatgrid feeding loop-length
quantize (DESIGN.md's "Beatgrid & Quantize" section, built to meet-or-beat
rekordbox/Serato). This is architecturally the right tool for D's material.
Unverified: whether it's actually populating real segment data for his
tracks, and its own confidence (`detected_downbeat_confidence`) has zero UI
surface anywhere either — same transparency gap as the CONF badge, different
subsystem, never checked.

**Why deferred:** needs a product decision with D/L, not just a code fix —
does the CONF badge get a range-aware variant, does D's catalog just not
need this feature at all, or should the segment-based beatgrid confidence
get its own visible indicator instead? Real options, not an obvious pick.

**Depends on:** verifying whether `detectTempoSegments` actually fires on
D's real (uploaded, not fixture) tracks before deciding anything — currently
unverified.

---

### COMMS HELP topic list is a hand-typed string, not generated from the registry

**Priority:** Low
**Blocked by:** Nothing technical.

**What:** `HELP`'s topic list in `src/console/helpTopics.js` is a manually
maintained string (`"BEATGRID · TAP · VALIDATION · HOTCUE · SHORTCUTS ·
VOID · TEMPO"`) rather than being generated from `Object.keys(HELP_TOPICS)`
— every new topic (most recently `TEMPO`, added with the Dynamic Tempo
Analysis plan) requires remembering to update this line by hand, and it's
already drifted from "self-updating" claims elsewhere (DESIGN.md previously
claimed this was self-updating; it never was — confirmed by reading the
actual code, not the doc, 2026-08-19). Also not clickable — typing the
exact keyword is the only way in.

**Fix:** generate the `HELP` line from `Object.keys(HELP_TOPICS)` directly
(excluding `HELP` itself), and/or let the expandable panel show topics as
clickable entries instead of requiring the exact typed keyword.

**Why deferred:** cosmetic/maintenance-only, no functional gap — every
topic already works once you know the keyword.

---

### Light Mode

**Priority:** Low
**Blocked by:** No design/scope decided yet.

**What:** The console (and guest flow) is achromatic-dark by design
(DESIGN.md's stock theme), with no light-mode variant. Flagged for a future
`/design-consultation` pass, not scoped or built in any session so far.

---

### Octave-ambiguity-signature detector (competing 2×/0.5× lag) — has a proven dead zone, needs empirical validation first

**Priority:** Low
**Blocked by:** The funk fixture (`GENRE_ARCHETYPES.funk`, `src/lib/__tests__/genreFixtures.js`, shipped with the Dynamic Tempo Analysis plan) landing first — needed to empirically validate this before it gates anything.

**What:** Instead of gating the octave-correction control on a flat/bucketed
confidence threshold, extract the correlation strength at the *competing*
octave lag (2× or 0.5× the winning tempo) inside `estimateTempoPeriod`
(currently computed per-candidate and discarded) and gate on that specific
signature — sound in principle, and would genuinely exceed rekordbox/Serato
(neither exposes anything like this).

**Why deferred:** has a proven dead zone, not just an untested idea — for
any winning tempo strictly between 100-120 BPM, *neither* octave neighbor
(200-240 or 50-60) falls inside the detector's own 60-200 BPM search range
at all, so the signature has literally no data there, not just weak data.
That band sits close to common hip-hop/downtempo/funk tempos in exactly D's
catalog — the exact material this whole effort protects. Needs empirical
validation against the funk fixture before it gates anything (risk:
false-positive on the exact groove material this whole effort protects).

---

### Live/offline BPM detector search-range mismatch (60-180 vs 60-200) — unify to one range

**Priority:** Low
**Blocked by:** Nothing technical — a values-only change once a target range is picked.

**What:** `useAudioAnalyzer.js`'s live detector (`detectBpm`, real-time
autocorrelation on the rolling bass-band buffer) searches 60-180 BPM
(`minPeriod = sampleRate * 60 / 180`, hardcoded literal, not a named
constant); `beatDetector.js`'s offline detector (`estimateTempoPeriod`)
searches 60-200 BPM (`MIN_BPM`/`MAX_BPM`, named exported-scope constants).
L asked directly (2026-08-20) why these differ and to unify them.

**Investigated — there is no technical reason for the gap.** Checked the
live detector's buffer math directly: `BPM_BUF_SIZE = 240` frames (~4s at
~60Hz rAF rate) comfortably covers a period as long as 60 BPM needs (60
frames) with room to spare; extending the upper bound to 200 BPM only
*shortens* the required period (18 frames vs 20 for 180) — strictly easier
on the buffer, not harder. The `180` is simply a different hardcoded number
than `beatDetector.js`'s `200`, with no shared source of truth and no
buffer-size or real-time-performance constraint forcing the difference —
two independently-chosen literals that happened to drift apart, not two
detectors serving genuinely different ranges for a real reason.

**Recommendation:** unify to **60-200** (match the offline detector's
range, not shrink it to 180) — the live detector's real-time cost is
already "trivially fast" per its own code comment (~7200 multiplications
per call, run every 500ms), and extending the search range by 20 BPM adds a
negligible number of lag candidates to that loop. Shrinking the offline
detector to 180 instead would mean losing coverage on the 180-200 BPM band
(some genres, e.g. hardcore/DnB, thought not currently in D's catalog).

**Why deferred:** promoting the DYNAMIC/genre badge (Dynamic Tempo Analysis
plan) to an always-visible, double-click-interactive control gives this gap
more real user-facing surface than it had as a barely-shown badge, but it's
still a low-frequency edge case (185-200 BPM is unusual for D's catalog) —
not worth touching a working live-audio detector opportunistically inside
an unrelated PR. Fix is small once picked up: change the `180` literal in
`useAudioAnalyzer.js`'s `detectBpm` to `200` (or extract both to one shared
constant), update `useAudioAnalyzer.test.js`'s `detectBpm` boundary assertions to match.

---

### ~~WF Deck header/meter/beat-indicator spacing tightened + BEAT toggle~~ — SHIPPED + DEPLOYED 2026-08-19

**What shipped (commit `1e18132`, deployed to production, verified via
`wrangler pages deployment list` + live `curl uoyni.com` 200):** deck header
margin/padding, meter-row margin-top, and the onset-envelope (beat
indicator) canvas all reduced to on-scale values per DESIGN.md's 4px grid.
Beat indicator resized 36→24px — it was violating "must be under the 32px
overview strip" (was bigger than the full-length waveform, backwards). It
now collapses to 0px by default instead of permanently reserving space, via
a new `BEAT` toggle in the BPM row (reuses `.arch-rail`'s existing collapse/
transition recipe) — decoupled from waveform hover, which previously both
revealed the indicator AND armed `↑`/`↓` zoom off the same gesture.
`tests/e2e/envelopeRow.spec.js`'s 5 tests updated for the new toggle-gated
visibility.

**Process:** went through `/plan-design-review` (7/10→9/10, 10 decisions)
and `/plan-eng-review` incl. an outside-voice subagent pass (7 findings, all
resolved) before any code was written. Both caught real, verified bugs
pre-implementation — see `project_wf_deck_spacing_shipped_20260819` memory
for the full list (WCAG contrast failure, savings-math error, toggle-redraw
gap, margin-collapse gap, disabled-state CSS gap, the 5 e2e tests).

**Explicitly cut, not deferred:** a button/pad-border visual-language
unification across transport/hot-cue/vault-tab buttons was live-mocked on
the real console and rejected outright by L ("it looks worse. period.") —
do not resurrect without a fresh design conversation. Cue-cluster spacing,
library-header-row styling, and VU/spectrum width-gap changes were cut for
the same reason (tied to the rejected direction) or were simply out of
scope ("you said you were looking at the WIDTHS which were not my
concern").

**Not yet verified by D** — only checked by L/Claude this session.

---

### ~~Console-wide `aria-pressed` audit~~ — BUILT via CONF-badge/genre plan (T13), not deferred a third time

**Status:** Resolved 2026-08-20. First surfaced 2026-08-19 (WF-deck design
review), deferred once when session scope got trimmed. Resurfaced during
`/plan-design-review` on the CONF%→ZONES/DYNAMIC badge plan (the new
genre-cycle badge was about to become an 8th instance of the same gap) — L
explicitly chose to fix all 8 in that PR rather than defer again: "make
sure we do the same for the other 7! i had no idea that these were missing
or what this means so address."

**What was fixed:** 7 pre-existing toggle buttons in `ArchitectConsole.jsx`
that lacked `aria-pressed` (the `SMART` library-toolbar toggle — most
severe, its label is static "SMART" so screen readers got no state signal
at all — plus 6 `.arch-settings-toggle` buttons: Track Color Rows,
Quantize, Auto Loop Default, Smart Crates' settings-panel twin, Track
History, per-vault visibility), PLUS the new genre-cycle badge from that
plan (role, aria-label, aria-pressed-equivalent state, and an
`announceStatus()` success announcement it didn't have before either).

**Fix pattern used:** one-line `aria-pressed={<existing state variable>}`
per button, same pattern already correct on `SORT ON`, the cue bank
selector, PLAY. See `~/.claude/plans/wise-leaping-charm.md` T13 for the
implementation task.

---

### MPC-pad button language for non-transport buttons — flagged, explicitly out of scope

**Priority:** Low (design taste question, not a bug or gap)
**Blocked by:** Nothing technical — needs its own design conversation, not tied to any other work.

**What:** L wants every console button aside from the TRANSPORT DECK to
look like AKAI MPC hardware pads. Checked DESIGN.md and memory directly
(2026-08-19/20): MPC is referenced exactly once (COMMS/REACH's LCD strip,
"MPC III / Pioneer styling" — a text-readout area, not buttons), and "pad"
only describes the 32 hot-cue pads. No general "all buttons should be MPC
pads" directive existed anywhere before this was raised.

**Why deferred:** Surfaced as an adjacent question during
`/plan-design-review` on the CONF%→ZONES/DYNAMIC badge plan (see
`~/.claude/plans/wise-leaping-charm.md`'s "Adjacent design question"
section), which is the wrong vehicle for a console-wide chrome decision
unrelated to tempo/genre analysis. An HTML wireframe comparing three
treatments (god-btn unchanged / MPC styling on grid-shaped controls only /
MPC styling on all buttons) was reviewed; the question itself — including
which of those three, if any — was explicitly left open, not decided.

**Critical context for whoever picks this up:** a closely related
button/pad-border visual-language unification was already live-tested on
the real console and **rejected outright by L this same week** — "it looks
worse. period." (see the "WF Deck header/meter/beat-indicator spacing"
entry above, 2026-08-19). Start any future conversation on this from that
rejection, not from a blank slate. It's a genuinely open question whether
scoping MPC-styling to only trigger/grid-shaped controls (hot cues, and any
future grid control) reads differently than the broader treatment that was
rejected — that's the real question for a future `/plan-design-review` or
`/design-shotgun` pass, not "try the same thing again."

---

### ~~Full sample-accurate gapless loop engine~~ — BUILT 2026-08-16, pending D's listening pass

**What shipped:** the real fix for D's "a tiny break... not continuous"
loop complaint (root cause + quick rAF-polling mitigation logged in the
Completed section below). `src/lib/loopEngine.js` (new) decodes only the
loop-region slice — never the whole track — via a new `fetchWavHeader`/
`fetchWavPcmRange` pair in `waveformAnalyzer.js` (shares the existing,
already-correct RIFF header-walk, extracted as `parseWavHeader` rather than
duplicated), snaps the loop's start/end to a *matched pair* of
zero-crossings (`findMatchedZeroCrossings` — matching the pair, not each
edge independently, is what prevents per-cycle length drift from
compounding across hundreds of native loop repeats), and plays it back via
a native, sample-accurate `AudioBufferSourceNode` with `.loop = true` —
zero JS involvement per repeat cycle, which is what makes it genuinely
gapless rather than just a faster JS-driven seek. `audioEngine.js` is now
mode-aware: `getState/seek/play/pause/setVolume` transparently route to
whichever engine (the `<audio>` element or the loop buffer) owns playback
at any given moment, so none of the ~15 existing call sites across the
console needed to change. WAV-only (matches every existing precedent in
this codebase); non-WAV tracks permanently fall back to the already-shipped
rAF hard-seek mechanism.

**Verified this session:** 51 new unit tests (WAV header parsing +
byte-range decode, zero-crossing pairing, pause/resume offset math,
`resolvePlaybackMode`, `enforceLoop`'s mode routing) — all passing, 626/626
total, build clean. Also verified against a **real** `AudioContext` and a
real WAV file served with genuine HTTP Range support (Vite dev server): the
buffer engine engaged correctly, `currentTime` stayed wrapped inside the
loop region across multiple real native loop cycles with zero JS
re-correction, pause/resume and seek-in/seek-out of the region all behaved
correctly.

**Verified live in the real console (L's owner code, same session):**
loaded EIGHTYSIXTY — a real ~79-minute production WAV mix, not a test
fixture — applied a 1-BAR loop through the actual loop-size panel UI.
`loopEngine.isActive()` confirmed `true`; sampled the real FFT analyser 9
times over ~1.2s and got non-zero, varying energy the whole time (meters
are genuinely fed during a loop, not dark); tracked `currentTime` over ~4s
and watched it cycle a bounded ~52.4–55.2s range twice (native looping,
confirmed on production audio); PAUSE froze the reported time cleanly,
PLAY resumed from it; CLR handed back to the `<audio>` element with
playback continuing seamlessly past the old loop boundary (checked
`currentTime` still climbing 7s later). Zero console errors across the
whole pass. Drag-scrub-through-a-loop-boundary wasn't separately exercised
(hard to simulate precisely via automation on a canvas waveform) but
everything upstream of it now checks out on real production data.

**The real acceptance test — does it actually sound gapless — still needs D
to listen post-deploy** (this can never be automated). If he still hears a
click, that most likely means a loop point had no true zero-crossing in the
±10ms search window (the code degrades to closest-to-zero in that case, not
a crash) — `loopEngine.js` now logs this exact case via `console.warn`
(region + snapped indices) when `localStorage.psc_debug_loop_edges` is set
to `'1'`, so a real report has a concrete loop point to point at instead of
a guess. Flip it on in the browser console before a suspected-click session.

**If D still hears a click after this:** the next step is a pre-rendered
equal-power crossfade baked into the buffer at decode time (not a live
per-cycle JS-scheduled crossfade — unnecessary complexity given native
`.loop` already handles repeats). Don't build it speculatively.

**Final ship state (2026-08-18):** merged to `main` and deployed to
**production** (not just a preview) — commit `0a7971f`, docs follow-up
`2cb40cd`. Confirmed via `wrangler pages deployment list --project-name
psoulc` showing a Production deployment built from `2cb40cd`, plus a live
`curl uoyni.com` 200 and worker `/health` check. Session interrupted mid-way
through `/ship`'s own review steps (API session limit); the commit/merge/
deploy that got this to production was finished by hand outside the normal
`/ship` flow while the session was down — see the GPG-signing entry
elsewhere in this file for why that was harder than it should've been.

---

### ~~Confidence meter — companion to T9's badge (T9B)~~ — CANCELLED 2026-08-19

**Status: CANCELLED, not deferred.** L: "T9B WAS CANCELLED ugly & stupid like
the energy meter was" — same 2026-06-03 vibe-meter failure pattern (see
`feedback_design_without_approval` in memory). Do not resurrect this idea
without a fresh design conversation; it isn't a "pick up later" item.

**Priority (historical):** Low — revisit only if evidence says the badge alone isn't enough.
**Blocked by:** Nothing technical. Blocked by lack of a real reason to build it yet.

**What:** During PR3's `/plan-eng-review` (2026-08-15), T9 (BPM confidence
badge on the deck header) grew a companion idea: `arch-deck-meta`'s existing
`border-bottom` (currently a plain 1px hairline, `ArchitectConsole.css:464-471`)
becoming an always-on confidence meter — ramped color, always visible,
distinct from the badge's discrete on-demand text.

**Why deferred:** fully designed, and its DESIGN.md-compliance question was
even resolved (would have used the same 5-band SA palette T9's badge now
uses) — then cut anyway, same session, on direct comparison to the
2026-06-03 "vibe meter" failure (see `feedback_design_without_approval` in
memory): an ambient colored element sitting next to information already
precisely available as text (T9's badge shows the exact percentage) adds no
real signal, just decoration. L caught this before building it, not after.

**Context:** Only worth revisiting if real usage shows the plain badge
number is too slow to scan at a glance once D's actually using it day to
day — i.e. validated by observed need, not built ahead of it. If picked up:
the SA 5-band palette mapping (`useAudioAnalyzer.js:55-82`, same bands as
T9's badge) is the natural color source; keep it a genuine instrument-style
meter (continuous reading), not a redundant restatement of the badge.

**Depends on:** T9 shipping and being used for a while first.

---

### ~~Build the COMMS-box keyword-help system (BEATGRID v1)~~ — SHIPPED 2026-08-15

**Status: built, tested (17/17 `ContextStrip.test.js` passing), live-verified**
via an isolated component preview (typed BEATGRID → hint chip appeared →
Enter opened the 5-line panel → Escape closed it, text preserved — all
screenshotted, matching the spec below exactly). `npm run build` succeeds;
`check:design` shows only the pre-existing, unrelated "Chakra Petch" font-name
false positive (see lessons.md). DESIGN.md now has a "COMMS / REACH" section
documenting this behavior. Next: the console-wide button/discoverability
audit (see the "single hot-cue clear" item below) should produce the next
COMMS-help topics — not ad hoc additions on top of this v1.

**What (original spec, preserved for reference):**

**What:** Let D type a keyword (e.g. `BEATGRID`) into the console's existing
COMMS search input and press Enter to see contextual instructions, instead
of relying on L to relay them by hand. Trigger: Enter-to-open — typing
already live-filters the vault search unchanged; a small inline "⏎ HELP"
hint appears when the typed text exactly matches a known topic, Enter
expands the existing `activeContext` body panel (`ContextStrip.jsx`, same
mechanism already used for `"nav"`/`"loop"`/`"access"`) with the
instructions; Escape closes it without touching the search text. V1 ships
exactly one topic — BEATGRID, verified against real `DeckWaveformV2.jsx`
source (pause-to-edit gate, double-click empty space adds a snapped anchor,
double-click an existing anchor is a no-op, `[`/`]` cycle selection, arrow
keys nudge one beat / Shift one bar, no delete exists yet). New file
`src/console/helpTopics.js` (keyword → label/lines registry); changes
contained entirely to `ContextStrip.jsx`/`.css` — no `ArchitectConsole.jsx`
changes needed.

**Why:** L asked directly (2026-08-13): "how can we create hints &/or
instructions somewhere for D to access at will... i would like to use my
comms box at the bottom of the console for this kind of thing... ie. he
types BEATGRID or whatever and these instructions are viewable or
something." Confirmed self-serve discoverability was part of why the COMMS
LCD exists at all, and that this is an intentional first step toward the
broader console-button audit described in the "single hot-cue clear" item
below — that audit is what should produce the next topics, not ad hoc
additions on top of this v1.

**Context:** Full implementation plan (exact code, exact CSS classes, exact
BEATGRID copy, test list) is written out at
`~/.claude/plans/and-read-lessons-and-concurrent-turing.md` — read that in
full before building, don't re-derive it. A condensed version is also
appended to `~/.claude/plans/vivid-finding-riddle.md` under "Next: COMMS box
keyword-help system (BEATGRID v1)". Discovered but explicitly out of scope
for this build: `ContextStrip.css` declares `font-family: 'JetBrains Mono'`
for COMMS/REACH text, which is never loaded anywhere — see its own TODO
entry below.

**Depends on:** Nothing technical. Add a short new DESIGN.md section
documenting this behavior as part of the build — COMMS/REACH currently have
zero DESIGN.md coverage.

---

### ~~Build the ACCESS CODES management panel~~ — RESOLVED 2026-08-14 (as GOD MODE MOBILE)

**Status: shipped, deployed, live-QA'd** — but not where this entry originally
assumed. `/office-hours` that session confirmed D/L will only ever grant
access from their phones, so instead of building into `ContextStrip.jsx:161`
(desktop console, viewer=L only), the real build was a new phone-only surface
covering both D and L (`tier === "A" && isMobile`) — see the GOD MODE MOBILE
design doc:
`~/.gstack/projects/liaskin13-psoulc/codespace-main-design-20260814-113335.md`.

`ContextStrip.jsx:161`'s `ACCESS CODE MANAGEMENT — COMING SOON` placeholder is
now effectively moot, not still-pending — the real need was mobile, not
desktop. Leaving the placeholder text as-is unless it becomes confusing later.

**Also resolved as part of this build**, contrary to this entry's original
"no product ambiguity" framing: single-device binding on `/redeem` (a code
can no longer be freely reshared once claimed), QR-code delivery, and a
required Wrangler 3→4 upgrade for native rate limiting. The scope grew
substantially beyond "just the frontend" once live-tested — see the design
doc for the full trail.

**What's still genuinely open**, split out as its own entry: the
stranger-facing REQUEST ACCESS review queue (Capability 2, below) — that one
really does still need backend work.

---

### Build the request-review queue (Capability 2 — guest REQUEST ACCESS → L's console)

**Priority:** Medium
**Blocked by:** Nothing technical, but needs its own design session — the D1 table shape,
request states, and notification strategy are all still open.

**What:** A stranger visits the public entry screen, submits "REQUEST ACCESS," and the
request lands in L's console (desktop) for review/approval — distinct from the mobile
quick-grant flow (see the GOD MODE MOBILE design doc below), which is for people D/L
already know. Approving a request should generate a real access code via the existing
`/access-codes` backend and get it to the requester somehow.

**Why:** L confirmed directly (2026-08-14 `/office-hours` session) that this is real and
wanted: "the request access will go to my console for review." It's explicitly a second,
separate capability from the mobile quick-grant work, deliberately sequenced after it —
not because it's less real, but because it needs new backend work the quick-grant flow
doesn't (no `access_requests`-equivalent table or endpoints exist today), while the
mobile quick-grant flow reuses the fully-built `/access-codes` backend as-is.

**Context:** Full writeup, including why the existing `RequestAccessModal.jsx` is NOT a
starting point (it's disconnected legacy code — writes to `localStorage` only, hands out
the shared `0000` bypass to everyone instead of minting real per-guest codes), is in
`~/.gstack/projects/liaskin13-psoulc/codespace-main-design-20260814-113335.md`'s Open
Question 3. Also needs: since no email/SMS infrastructure exists in this codebase, how
D/L actually find out a new request is waiting — a console badge on next login is the
obvious default, not yet confirmed. The entry gate's REQUEST ACCESS button
(`EntrySequence.jsx:195-197`) is currently dead (no `onClick` at all) and stays that way
until this is built — confirmed acceptable to leave as-is for now (2026-08-14).

**Depends on:** A `/office-hours` or `/spec` session to shape the D1 schema and
notification approach before building.

---

### Verify whether the console is usable on tablet width (768-1023px)

**Priority:** Medium — D confirmed to actually use a tablet (2026-08-14), not
speculative.
**Blocked by:** Nothing.

**What:** `useBreakpoint.js`'s `isMobile` is `false` for the `md` breakpoint
(768-1023px, i.e. tablets) — so a tier-A (D/L) session on a tablet falls into the full
desktop console today (`App.jsx:120`'s `tier === "A" && !isMobile` branch), not the
guest room and not the new mobile GOD MODE MOBILE surface. Whether the full console is
actually usable at that width was never verified either way — the 2026-08-14 `/qa`
session that confirmed "console has zero mobile support" tested phone width specifically.

**Why:** Surfaced during the `/plan-eng-review` of the GOD MODE MOBILE design doc
(2026-08-14) as a pre-existing gap independent of that work. **Correction (same
session): D does use a tablet** — this is not speculative, raising this from a
theoretical gap to an actual, unverified user experience. Whether it's currently fine or
currently broken has not been confirmed either way.

**Context:** Needs a direct check with D on whether the desktop console is actually
usable on his tablet today. If it's broken, this connects directly to the GOD MODE
MOBILE design doc's `tier === "A" && isMobile` condition — worth revisiting whether tier-A
sessions should get the lightweight mobile surface on tablet width too (`isTablet` from
`useBreakpoint.js`), not just phone width.

**Depends on:** Nothing technical.

---

### Recommended gstack skills — not yet used on this project

**Priority:** Reference only, not a build task.

Surfaced during the 2026-08-14 `/cso` audit session while mapping the TODO
priority plan. None of these have been invoked on this project yet
(confirmed via `~/.gstack/analytics/skill-usage.jsonl`); each maps to a
specific gap already tracked elsewhere in this file.

- **`/investigate`** — for the CI e2e login-wait flake (see "CI has been red
  on main" below). Built specifically for root-causing "why is this broken"
  rather than working around it.
- **`/health`** — code quality dashboard. Worth running once before starting
  the Vitest baseline (below) to get a coverage/quality snapshot to measure
  against.
- **`/spec`** — turns a vague product gap into a precise executable spec.
  Both the ACCESS CODES panel above and "no way to clear a single hot cue"
  (below) were flagged as needing a UX decision before building — this is
  the tool for that step.
- **`/canary`** — post-deploy canary monitoring. Deploys here are 100%
  manual (`wrangler`, no CI/CD auto-deploy) — lightweight automated
  post-deploy health checks would close a real gap cheaply.
- **`/retro`** — weekly engineering retrospective. `tasks/lessons.md` has
  190+ entries accumulated over ~4 months; a periodic retro pass could
  consolidate durable patterns and prune what's gone stale.

---

### ~~HISTORY track-list filter button doesn't respond when switching from STAGED/LIVE~~ — FIXED 2026-08-16

**Status: fixed, tested, live.** Root cause (source-read, not the stale-closure
guess below): HISTORY's `onClick` called `setHistoryEnabled`, a totally
unrelated Settings preference for played-track logging — not `publishFilter`,
which STAGED/LIVE actually use and which `filteredTracks` filters on.
`filteredTracks` had no `"history"` branch at all. Rewired to
`setPublishFilter("all")`, matching the fresh-load view it originally looked
like it represented. `historyEnabled` and its Settings toggle are untouched —
real, separate, working feature. Verified live: STAGED→LIVE→HISTORY now
correctly changes rows every time.

**Priority:** Medium
**Blocked by:** Nothing.

**What:** Found during a `/qa` dogfooding pass on the PR2 downbeat-detection
feature (2026-08-14) — unrelated to that feature, a pre-existing console bug.
The HISTORY filter button in the track-list toolbar (`ArchitectConsole.jsx`)
works correctly on fresh page load (it's the default view), but once you
click away to STAGED or LIVE, clicking HISTORY again does nothing — the
`active` CSS class stays on the previously-selected filter and the track
rows never change. Verified at the DOM level, not just visually: dispatching
`.click()` directly on the button element via JS still leaves `active` on
the old filter, ruling out a browser-automation/selector issue.

**Why:** Real, reproducible UX papercut — D can get stuck unable to see
published/history tracks after browsing STAGED without a full page reload.
Low risk (reload works around it) but worth a proper fix.

**Context:** Likely a stale-closure or missing-dependency bug in whatever
`useState`/`useCallback` handles the STAGED/LIVE/HISTORY filter toggle in
`ArchitectConsole.jsx` — needs a source read of that handler before fixing,
not yet investigated. Screenshots: `.gstack/qa-reports/screenshots/history-recheck.png`,
`history-js-click.png`. Full QA report: `.gstack/qa-reports/qa-report-uoyni-com-2026-08-14.md`.

**Depends on:** Nothing technical.

---

### ~~Test suite — Vitest baseline~~ — DONE, stale (never marked), closed 2026-08-19

**Status: done, and long since exceeded.** This was a Phase 10 artifact
describing a zero-test starting point that stopped being true many sessions
ago — never updated to reflect it. All three minimum-viable items below are
covered, plus far more: `src/lib/__tests__/tracks.test.js` covers
`uploadTrack()`/`getAudioUrl()`/`fetchVaultTracks()`,
`src/state/__tests__/dispatchCommand.test.js` covers `dispatchCommand()`,
`src/components/__tests__/UploadModal.test.js` covers format/size
validation. The suite as a whole is at 661 passing tests across 41 files
(`npx vitest run`, verified 2026-08-19) — Vitest + Testing Library, no
Playwright/E2E unit-level gap remains (E2E itself is tracked separately,
see "Isolated E2E test backend").

Original scope (historical, all satisfied):

- `lib/tracks.js` — unit tests for `uploadTrack()`, `getAudioUrl()` (now async),
  `fetchVaultTracks()` error path (should return [], not throw)
- `src/state/SystemContext.jsx` — `dispatchCommand()` with authorized vs unauthorized
  caller, `loadVaultTracks()` side effect from CMD.UPLOAD_TRACK handler
- `src/components/UploadModal.jsx` — format validation (WAV/AIFF/MP3 accepted,
  others rejected), size validation (>200MB rejected)

---

## Implementation Decisions (pending)

### Voice comment signed URL TTL strategy

**Context:** Audio tracks use 1-week TTL with graceful onerror handling. Voice comments
are shorter-lived and more transient in nature — the right TTL and refresh strategy
may differ.

**Options to evaluate during Item 2 implementation:**

- Same as tracks: 1-week TTL, graceful onerror message
- Shorter TTL (e.g., 1hr) with automatic re-sign on onerror (more complex but voice
  comments are accessed in shorter, active collaboration sessions)
- Generate signed URLs on-demand per play click (lazy, avoids TTL issue entirely but
  adds 100-200ms latency per play)

**Resolve during:** Item 2 (voice comments) implementation in Phase 10.

---

---

### Pre-existing: vault-switch-mid-batch and orphaned R2 multipart sessions

**Priority:** Low
**Blocked by:** nothing, but the second half touches `worker/upload-worker.js` — treat with extra care, prior worker changes have caused regressions (see `~/.gstack/projects/*/  *-main-design-20260527-*.md` constraints).

**What:** Two small, pre-existing gaps noticed during the INTAKE batch-upload eng review (2026-07-21):

1. If the destination vault `<select>` is changed while items are still queued/uploading, later items in the same batch go to the new vault — a single drop can silently split across two vaults. Already true today via console tab-switching; the INTAKE modal's dedicated dropdown just makes it more discoverable/likely to trigger.
2. If the browser closes or reloads mid-upload, the R2 multipart upload session (`worker/upload-worker.js` `/upload-init`/`/upload-part`/`/upload-complete`) is abandoned with no `abortMultipartUpload` call — an orphaned-storage leak in R2 over time.

**Why:** Neither is caused by the INTAKE fix, both are worth a deliberate look eventually. #2 is the more concrete one (real storage cost over time); #1 is a UX footgun.

**Context:** Flagged, not investigated further — didn't want to scope-creep the INTAKE batch-upload fix into worker territory. #2 needs a periodic cleanup job (e.g., a scheduled worker cron listing/aborting stale multipart uploads via R2's API) or accept the leak as negligible at current volume.

---

### Bulk backfill: beat detection for D's existing catalog

**Priority:** Medium
**Blocked by:** the beat-quantize/beatgrid plan (real Quantize + offline beat detector + multi-point beatgrid) shipping AND being validated against known-BPM tracks in D's library first — do not build this against an unproven detector.

**What:** A batch job that runs the new offline beat detector (`src/lib/beatDetector.js`, once it ships) against every already-uploaded track, not just ones D re-Regenerates going forward.

**Why:** Without it, the detector's value is invisible on D's existing catalog until he manually re-Regenerates each track one at a time.

**Pros:** Immediate value across the whole library instead of trickling in track-by-track.

**Cons:** Real cost — re-fetching/re-processing every large WAV that already has waveform data; needs its own throttling/queue design (mirror the existing `waveformQueueRef`/`runWaveformQueue` pattern in `ArchitectConsole.jsx`, ~line 528) to avoid hammering R2/D1 with a burst of concurrent regenerations.

**Context:** Surfaced during the `/plan-eng-review` of the beat-quantize/beatgrid plan (2026-07-22). Natural follow-up once the detector is proven — premature to build alongside a not-yet-shipped, not-yet-validated detection algorithm.

---

### ~~Reconsider pause-required gate on beatgrid editing~~ — CONFIRMED-RESOLVED 2026-08-19

**Status:** Closed, not left open. L confirmed directly this session ("I
don't mind the pause gate for beatgrid") that DESIGN.md:355's 2026-07-24
discomfort note is stale — the pause-gate pattern is not contested and was
reused deliberately (not just copied blindly) for the new tempo-genre
badge's double-click cycling in the Dynamic Tempo Analysis plan, same
reasoning (a control that changes octave-correction visibility mid-set is a
live-performance mis-click risk worth guarding).

**Original text (historical):** v1 of the multi-point beatgrid editor only
allows dragging/inserting anchor points while the deck is paused — disabled
with a dimmed visual cue while playing, to avoid any risk of audible
glitches from loop/quantize math recalculating mid-playback. L expressed
discomfort with this restriction during the `/plan-eng-review` of that plan
(2026-07-22) but chose not to relitigate it mid-review; left open pending
D's real-world reaction.

---

### Isolated E2E test backend (no mock/local worker exists)

**Priority:** Medium
**Blocked by:** nothing — can start any time.

**What:** This repo's `.env` points `VITE_UPLOAD_WORKER_URL` at the real production Cloudflare Worker (`psc-upload-worker.psoulc.workers.dev`). There is no local/mock backend and no separate test environment — every Playwright test that runs here talks to D's real production data unless a test explicitly intercepts it.

**Why:** Discovered while building the beat-quantize/beatgrid E2E specs (2026-07-24) — writing a test that clicked the octave-correction button would have fired a real `PATCH /tracks/:id` against production on every CI run. Worked around it for now with `page.route()` interception in `tests/e2e/fixtures/mockTracks.js` (precise-match only, everything unrecognized falls through to the real network via `route.fallback()`), but that's a per-test-file discipline, not a structural guarantee — a future test file that forgets to mock is a real risk, especially once CI runs unattended on every push/PR.

**Context:** A proper fix is a local Wrangler dev instance (`wrangler dev` against a local/test D1 + R2) that CI spins up, so tests hit an actual isolated backend instead of requiring every spec author to remember to intercept `/tracks/*` by hand. Until then: any new E2E test touching track data MUST route through `mockTracksApi` (or an equivalent precise mock) — never assume the dev server's network calls are safe by default.

**Depends on:** Nothing technical — mostly a matter of prioritizing the Wrangler-dev CI setup work.

---

### FULL BOIL: complete coverage closure for beat-quantize/beatgrid branch

**Priority:** Medium
**Blocked by:** nothing — explicitly deferred out of the `feat/beat-quantize-grid` ship to keep that branch scoped to its own feature risk, not repo-wide test-infra debt.

**What:** The "boil the ocean" option L asked about during that branch's `/ship` coverage gate (2026-07-24), declined in favor of shipping with the scoped/recommended coverage. Full closure means:

1. `handleOctaveCorrect`/`handleBeatGridPointsChange` rollback/failure-path tests in `ArchitectConsole.jsx` — needs a render strategy for a meaningful slice of that 4000+ line component; no existing precedent in this repo.
2. `waveformAnalyzer.js` orchestration tests — verify `detectTempoSegments`/`dpBeatTrack` are actually wired correctly into `generateAndUploadWaveformV2`, not just the pure-function unit tests that already exist for the underlying math.
3. `DeckWaveformV2`'s drag-mouse anchor state machine — only keyboard nav + double-click insert are covered today (`DeckWaveformV2.beatgrid.test.js`); mouse drag-to-move is untested.
4. Worker-layer tests for the PATCH `/tracks/:id` allowlist additions in `worker/upload-worker.js` — there are zero worker tests anywhere in this repo currently, so this is really "stand up worker test infra," not a small addition.
5. The actual isolated E2E test backend (see "Isolated E2E test backend" item above) — a local Wrangler dev instance against test D1/R2, replacing the `page.route()` interception workaround.

**Why deferred:** Most of this (items 4 and 5 especially) is pre-existing repo-wide test-infra debt, not something the beat-quantize/beatgrid branch introduced — pulling it into that branch's ship would have scope-crept a feature PR into an infra PR.

---

### ~~No way to clear a single hot cue — only clear ALL~~ — FIXED 2026-08-16, plus the full console-wide audit this item spawned

**Status: fixed, tested, live — and the "related, broader scope" note below (the
console-wide button/discoverability audit) also ran and shipped in full.**
Investigation found a per-cue clear mechanism already existed on 3 of 4 banks
(double-click-twice-within-3s), just totally undiscoverable — zero visual hint
before you tried it. Bank D had a real, total gap: double-click there is fully
claimed by the cue-rename feature. Fix: every occupied pad now shows a small
always-visible `×` (not hover-gated), wired to the existing bank-agnostic
`clearHotCue`. Works on all 4 banks, including D for the first time. See
DESIGN.md's new "Hot Cues" section.

The broader audit this spawned (see updates below) also shipped: HISTORY
filter bug fixed, COMMS keyword-help made discoverable, `?` shortcuts trigger
added, beatgrid idle hint added, Smart Crates implemented for real (was a
dead toggle, found while writing this audit's tooltips), ~25 controls got
tooltips, ACCESS CODES REVOKE gained a confirm dialog. Full accounting of
every finding — chosen and explicitly not — is in the session's build plan,
referenced from DESIGN.md's Decisions Log (2026-08-16 entry).

**Priority:** Medium
**Blocked by:** nothing — needs a design pass on the cleanest UX before building (see below).

**What:** D noticed the console only offers a bulk "clear all cues" action — there's no way to clear one individual hot cue without wiping every cue on the deck. Flagged directly by D, relayed by L (2026-08-11).

**Why:** Real workflow gap for D — clearing one mis-placed cue currently means losing all of them and re-setting the rest from scratch.

**Context:** Needs a scoping pass before implementation: cleanest UX is not yet decided (options likely include a per-cue right-click/long-press clear, a modifier-click on the cue pad itself, or a small "x" affordance next to each cue in whatever list/pad UI currently renders them — find and read that UI first). Should be looked at together with the broader idea below rather than bolted on in isolation.

**Related, broader scope (not yet its own TODO — needs shaping first):** L separately asked to consider a full review of all console buttons/controls — their functionality, discoverability (hints/tooltips), and whether the COMMS status LCD (`announceStatus()`, added 2026-07-22 session, sibling to the REACH LCD) is being used to its full intended potential for surfacing this kind of state/feedback. Worth a dedicated `/design-review` or `/office-hours` pass rather than folding into a single-cue-clear fix — the single-cue-clear gap is a good concrete example to bring INTO that review, not a substitute for it.

**Update 2026-08-14:** first concrete instance of this now planned (not yet built) — see "Build the COMMS-box keyword-help system (BEATGRID v1)" at the top of this file.

**Update 2026-08-15:** BEATGRID v1 shipped. This item now reduces to: run the
console-wide button/control audit itself (still not scoped) — that audit is
what should produce the next COMMS-help topics and inform whether/how HINTS
surface across the console more broadly.

**Update 2026-08-15 (later same day):** PR3's confidence badge, tap-tempo,
explainability row, and validation-numbers panel all shipped (v1.4.0.0) —
each with its own COMMS keyword-help topic (`TAP`, `VALIDATION`, alongside
`BEATGRID`) as a first-class part of that work, not deferred to this audit.
T12 (cross-instrument pulse) remains its own separate, not-yet-shipped PR.
This TODO's remaining scope is now specifically the console-wide
button/control audit itself — everything else that referenced it has
landed. Sequencing decided 2026-08-15: run this audit as its own dedicated
pass (`/design-review` or `/office-hours`).

**Depends on:** Nothing technical. Needs a UX decision (with L/D) before building.

**Update 2026-08-16:** both the cue-clear gap and the full broader-scope audit
are done — see the FIXED status line at the top of this entry.

---

### ~~Octave-correction buttons only in track-list rows, never the loaded-deck header; don't reset after correcting~~ — RESOLVED 2026-08-20

**Status:** Both issues fixed as part of the Dynamic Tempo Analysis plan
(`~/.claude/plans/wise-leaping-charm.md`, T4/T6). (1) The octave-correction
control now also renders in the loaded-deck header (`arch-deck-stats`),
same `handleOctaveCorrect` handler, gated through `shouldShowOctaveControl`
like every other site. (2) `handleOctaveCorrect` now PATCHes a new
`manually_corrected: true` column alongside `detected_bpm` — kept separate
from `detected_bpm_confidence` (which stays an honest measurement, never
overloaded to also mean "a human intervened," per eng review 2A) — and
`shouldShowOctaveControl` checks it directly, so the button disappears
immediately and stays gone, not just once confidence happens to cross a
threshold again.

**Original text (historical):** Found during the 2026-08-16 console-wide
discoverability audit. Two issues: the ½×/2× buttons only rendered in
track-list rows, never the loaded-deck header; and `handleOctaveCorrect`
never updated confidence after a correction, so buttons never disappeared.

---

### Extend WF (DeckWaveformV2) to the same 5-band Bark color scheme as SA

**Priority:** Medium
**Blocked by:** SA's 5-band proposal finishing its `/plan-design-review` pass and shipping first (2026-08-12 plan: `vivid-finding-riddle.md`, "DECIDED — SA 5-band color scheme, Bark critical-band boundaries").

**What:** L confirmed direct intent to move WF's bass/mid/high coloring to the same 5-band, Bark-critical-band-derived scheme just locked in for the SA (low/mid-low/mid/mid-high/high; red/red-orange/green/cyan/indigo — indigo is the top-end anchor, matching real ROYGBIV spectrum order, not a middle band) — explicitly wants SA correct first, WF second, not simultaneous.

**Why:** DESIGN.md states SA's band scheme exists specifically to keep SA and WF "speaking the same visual dialect." Moving only SA to 5 bands leaves that stated coherence goal unmet until WF follows. Also a real design opportunity on its own — WF has never had its band math re-examined the way SA's just was.

**Context:** Not a copy-paste of SA's implementation. SA colors 150 independent frequency bars; WF colors per-time-slice via a screen-blend RGB model showing which band dominates at that instant in the waveform (`DeckWaveformV2.jsx` / `src/lib/waveformAnalyzer.js`). The Bark boundary Hz values themselves carry over unchanged (534/1230/2579/5927Hz) but the color-blending logic needs its own design pass, not a mechanical port. Same colorblind-simulation check (deuteranopia/protanopia) that caught the orange-vs-green collision on SA should be re-run here before locking a final WF palette — WF's continuous per-pixel blending may behave differently than SA's discrete per-bar coloring under that simulation.

**Depends on:** SA's 5-band scheme shipping and being confirmed live first (L's explicit sequencing).

---

### SA peak-hold ghost-trail color slightly less crisp over Mid-low band (P3 polish)

**Priority:** Low (P3)
**Blocked by:** Nothing — cosmetic, not blocking the 5-band ship.

**What:** The peak-hold "ghost fill" overlay (`rgba(225,85,68,0.42)`, salmon) sits closer in hue to the new Mid-low red-orange band (`#ff5500`) than to the other 4 bands — RGB distance 74 vs. 74-338 for everything else. Still a real, visible difference, just the least crisp of the five.

**Why:** Surfaced during `/plan-design-review` of the SA 5-band color proposal — the deuteranopia-safety fix that moved Mid-low from `#ff8000` to `#ff5500` incidentally pulled it closer to the pre-existing salmon overlay color (was 86 apart, now 74).

**Context:** Tested yellow/gold/amber as alternative ghost-trail colors — all worse, not better: gold vs. green collides almost completely under protanopia (distance 2), amber and pure yellow both sit right at or near the colorblind-safety threshold (30) against green. Salmon remains the best-performing option checked so far — nothing found beats it. If revisited, the fix is a new ghost-trail color verified against all 5 final band colors (`#ff0000`/`#ff5500`/`#00ff00`/`#6600ff`/`#00ffff`) under both deuteranopia and protanopia simulation before adopting, not a guess.

**Depends on:** Nothing technical.

---

### BPM ring's detectBpm() assumes a fixed 60Hz rAF sample rate

**Priority:** Medium
**Blocked by:** Nothing — pre-existing, independent of the SA 5-band ship.

**What:** `useAudioAnalyzer.js`'s BPM ring fills `bpmBufferRef` once per `requestAnimationFrame` callback and calls `detectBpm(bpmBufferRef.current, 60)` with a hardcoded `sampleRate=60`. `requestAnimationFrame` actually fires at the display's real refresh rate — 90Hz/120Hz/144Hz monitors are common. On those displays the ring buffer fills 1.5-2.4x faster than the function assumes, which skews `detectBpm`'s autocorrelation lag-to-BPM conversion and produces systematically wrong BPM readings. The "every 30 frames ~500ms" detection-cadence comment on the same block is also wrong on faster displays (actually ~250-330ms at 90-120Hz).

**Why:** Surfaced by adversarial review during the SA 5-band color / Nyquist-fix branch (2026-08-12) — same "hardcoded temporal-rate constant" bug family as the Nyquist fix in that branch, but `detectBpm`/`BPM_BUF_SIZE` themselves were untouched by that diff, so it was logged here rather than folded in.

**Context:** Fix likely involves measuring actual rAF-callback delta time (already computed elsewhere in the file for the EMA dt clamp — see `lastFrameTimeRef`) and passing a real, live sample rate to `detectBpm` instead of the hardcoded `60`.

**Depends on:** Nothing technical.

---

### ~~CI has been red on main since at least 2026-07-28~~ — RESOLVED 2026-08-14

**Status: fixed and verified against real CI**, not just local repro — see
`.github/workflows/ci.yml`'s `e2e-smoke` job and `/investigate` session
2026-08-14. Both original causes are now closed:

1. `react`/`react-dom` version mismatch — fixed via PR #9 (already closed
   before this session).
2. `tests/e2e/beatgrid.spec.js` 4/9 failures — **the "login wait timing"
   theory in this entry's original text was wrong.** Real root cause:
   `.env` is gitignored and was never present in CI, so
   `VITE_UPLOAD_WORKER_URL` fell back to `http://localhost:8787`
   (`src/config.js`), which flips `src/lib/tracks.js`'s `IS_DEV` flag true
   and routes every track fetch through an empty `localStorage` — never
   calling `fetch()` at all, completely bypassing the tests'
   `page.route()` mocks. Confirmed directly with a standalone Playwright
   script logging network activity: zero `/tracks` requests fired.
   Fix: `.github/workflows/ci.yml`'s `e2e-smoke` job now sets
   `VITE_UPLOAD_WORKER_URL` explicitly (the real worker URL — public, not
   a secret) so `IS_DEV` is correctly false in CI, matching local dev
   behavior. A first-attempt fix (waiting for a track row to render in
   `fixtures/auth.js`) was tried, tested only via local CPU-contention
   simulation, pushed, and made CI **worse** (4 failing → 9 failing) —
   reverted in the same commit as the real fix. Verified against an
   actual CI run afterward, not just local reproduction: both jobs green,
   9/9 e2e tests passing — first fully-green CI run since at least
   2026-07-28.

**Lesson for next time:** when a CI-only failure can't be explained by app
logic, check whether a gitignored config file is silently absent in CI and
whether the app has a fallback branch that changes *behavior* (not just a
missing value) based on that absence. Also: never consider a CI-flake fix
confirmed from local simulation alone — verify against a real CI run.

---

### Hot-cue placement doesn't use downbeat data, unlike loop-length quantize

**Priority:** Low
**Blocked by:** Nothing — needs a product decision, not a technical blocker.

**What:** PR2 Item 5 wired detected downbeat data into loop-length quantize
(`handleApplyLoopLength`) but not hot-cue placement (`handleHotCueClick`) —
`quantizeToBeat`'s in `ArchitectConsole.jsx`. Both call the same underlying
`quantizeToBeat` helper with `quantizeEnabled` on, but only the loop-length
path passes a downbeat-aware `offsetSec`.

**Why:** Surfaced by adversarial review during the Item 5 ship — same "snap to
beat" pattern now behaves differently for two features in the same console.
Wasn't in Item 5's original spec (which only named loop-length quantize), so
deliberately not folded in during that ship.

**Context:** Real product question before touching this: does D want hot cues
to snap to the actual downbeat too, or is snapping to the nearest raw beat
intentional for cue placement (which is often mid-phrase, not bar-aligned)?
If yes, the fix is one line — pass `resolveDownbeatOffsetForQuantize(loadedTrack, currentTime)`
as `handleHotCueClick`'s third `quantizeToBeat` argument, mirroring
`handleApplyLoopLength`'s exact change.

**Depends on:** A product decision (with D) on whether hot cues should be
downbeat-aware at all.

---

### GET /tracks (no vault filter) has no auth check — exposes console-only DSP columns

**Priority:** Medium
**Blocked by:** Nothing — pre-existing gap, not introduced by any specific branch.

**What:** `worker/upload-worker.js`'s `GET /tracks` handler (distinct from
`GET /tracks/:vault`, which correctly gates its DSP columns behind
`isAuthenticated`) has no auth check at all, so `detected_bpm`,
`detected_beat_offset`, `detected_bpm_confidence`, `beat_grid_points`, and
(as of PR2 Item 5) `detected_downbeat_offset`/`detected_downbeat_confidence`
are all readable by any unauthenticated caller.

**Why:** Flagged independently by both the Security and API Contract
specialist reviews during Item 5's ship — the code's own comment on the
sibling `GET /tracks/:vault` endpoint states this data is "D's internal
production metadata — console-only, never guest-facing," but `GET /tracks`
doesn't honor that. Pre-existing (predates Item 5 by at least 2 migrations),
widened rather than introduced by adding 2 more low-sensitivity float columns
to the already-exposed list.

**Context:** Fix is mechanical — apply the same `isAuthenticated`-gated
`dspColumns` pattern `GET /tracks/:vault` already uses (see
`worker/upload-worker.js` ~line 224-229) to `GET /tracks` as well. Worth
checking why `GET /tracks` exists as a separate unauthenticated endpoint at
all before just gating it — if nothing legitimately needs the unauthenticated
cross-vault listing, consider requiring auth for the whole route instead.

**Depends on:** Nothing technical.

---

### ~~Investigate root cause of recurring Codespace commit-signing failures~~ — RESOLVED 2026-08-19

**Status: RESOLVED.** Root cause: GitHub Codespaces' `gh-gpgsign` signing
helper requires `git config user.name` to match the **full/display name on
the GitHub profile** (documented at
`docs.github.com/en/codespaces/troubleshooting/troubleshooting-gpg-verification-for-github-codespaces`,
"conflicting git configuration" section). This Codespace's system-level
`/etc/gitconfig` had `user.name=liaskin13` (the login), but the GitHub
profile's `name` field is `"lisa marie"` (`gh api user --jq .name`) — a real
mismatch, not L's repo-rename theory (that theory was reasonable but wrong;
`GITHUB_REPOSITORY` and `gh auth status` both already reflected the renamed
repo correctly, ruling out a stale App grant). Confirmed by direct
reproduction: `git commit --allow-empty -S` failed with the exact `403 |
Author is invalid` error under `user.name=liaskin13`, then succeeded under
`user.name="lisa marie"` — both outcomes observed directly, not inferred.

**Fix applied:** `git config user.name "lisa marie"` at the repo level
(`/workspaces/psoulc/.git/config`), which overrides the stale system value.
Survives reconnects and container rebuilds (the repo directory persists).
Does not propagate to a fresh Codespace/clone — if this recurs elsewhere,
diff `git config user.name` against `gh api user --jq .name` first.

Full writeup in `tasks/lessons.md` (the "ROOT CAUSE FOUND 2026-08-19" entry,
which also corrects an earlier wrong lesson that told future sessions not to
check git identity for this exact error).

---
<details>
<summary>Original entry (kept for history)</summary>

**Priority:** Medium — bumped from Low. Recurred yet again 2026-08-14 (GOD MODE
MOBILE commit `1c30a70`), and this time L expected it to already be fixed
("i thought we fixed this") — the gap between that expectation and reality is
itself a signal this has gone unaddressed long enough to be worth real time,
not just another bypass.
**Blocked by:** Nothing.

**What:** `git commit` fails with `gpg failed to sign the data... 403 | Author
is invalid` from the Codespace's `gh-gpgsign` signing helper — recurred across
multiple sessions (documented in `tasks/lessons.md`; also during PR2 Item 5's
ship on 2026-08-13; again on 2026-08-14 committing the GOD MODE MOBILE
feature). Every occurrence so far has been bypassed with `--no-gpg-sign` after
explicit user approval, never actually root-caused.

**Why:** User asked directly on 2026-08-13 to add this rather than keep
bypassing it silently forever: "add a todo to figure out why this is
happening and we can address." Asked again on 2026-08-14 after it recurred a
third documented time, visibly surprised it wasn't already resolved.

**Context:** `tasks/lessons.md`'s existing entry documents the symptom
(content merges cleanly, no conflict markers — this is signing-specific, not
a git-state or identity problem) and the working-but-unexplained bypass. Not
yet investigated: whether this is a stale internal Codespace signing token
(possibly tied to a long-running session surviving a client
disconnect/reconnect, per the existing lesson's hypothesis), a GitHub-side
gpg-sign helper config issue specific to this Codespace, or something else
entirely. A genuine Codespace restart (suggested but not yet tried per the
existing lesson) is the obvious first experiment.

**Update 2026-08-16:** the "try a Codespace restart" experiment is effectively
already done, many times over, without anyone realizing it counted. L reports
getting disconnected and reconnecting to the Codespace "many times a day"
since the 13th due to context/session limits — and the signing error still
recurred today regardless. This rules out the stale-token-across-a-single-
session theory: whatever's broken survives a fresh Codespace entirely, so it's
something more persistent — an account-level GitHub App grant, a cached
credential outside the Codespace's ephemeral state, or a `gh-gpgsign` config
issue that isn't session-scoped. Next actual diagnostic step needs to look
outside the Codespace session boundary, not inside it.

**Priority bump 2026-08-19 — L has a specific, testable lead, start here
next session:** L's own theory: "its cuz i changed the name to uoyni from
psoulc on git and added my name too" — i.e. the GitHub repo was renamed
(`psoulc` → `uoyni`, matching `git remote get-url origin` →
`github.com/liaskin13/uoyni.git`, which doesn't match the local directory
name `/workspaces/psoulc` — a real, verifiable mismatch) around the same
time the commit author name changed. Both are exactly the kind of thing that
could desync a GitHub App-issued signing identity/token from what `gh-gpgsign`
expects, matching the "account-level GitHub App grant" hypothesis above.
**Concrete next steps, in order:** (1) `gh api user` and `git log -1
--format='%an <%ae>'` — confirm the actual current author identity vs. what
GitHub's signing service thinks it should be; (2) `gh auth status` and check
whether the GitHub App used for commit signing was authorized under the OLD
repo name and never re-granted after the rename — repo renames can silently
break app-level permissions scoped to the old name/URL; (3) if so, the fix is
likely re-authorizing/re-installing the signing app against the renamed repo,
not a Codespace-side change at all. This is NOT resolved — do not write
anywhere that it's "environment-specific and not a code defect" without
actually testing this lead first.

**Depends on:** Nothing technical — needs someone to actually reproduce and
diagnose it instead of bypassing on sight.

</details>

---

### ContextStrip.css declares `'JetBrains Mono'` for COMMS/REACH text, but it's never loaded

**Priority:** Low
**Blocked by:** Nothing.

**What:** `.arch-comms-lcd-status`, `.arch-context-search-input`,
`.arch-context-search-count`, `.arch-reach-lcd-msg`, `.arch-reach-lcd-idle`,
and `.arch-context-loop-btn`/`.arch-context-placeholder` all set
`font-family: 'JetBrains Mono', monospace` — but `index.html` only loads
Chakra Petch, Comfortaa, and Space Mono via Google Fonts. No crash (the
`monospace` fallback catches it), but every COMMS/REACH readout has been
silently rendering in the browser's generic monospace font, not the intended
one, for as long as `ContextStrip.jsx` has existed.

**Why:** Surfaced while exploring `ContextStrip.jsx`/`.css` for the
COMMS-box keyword-help feature (2026-08-14). Also a DESIGN.md law violation
independent of the missing font file: `DESIGN.md`'s typography law reserves
Space Mono for exactly 3 numeric-data-readout surfaces (transport, BPM
nixie, telemetry timestamps) and Chakra Petch for everything else — none of
these COMMS/REACH surfaces are numeric readouts, so even loading JetBrains
Mono properly wouldn't be the DESIGN.md-correct fix.

**Context:** Real fix is likely switching these rules to `Chakra Petch` (per
DESIGN.md's actual law), not adding a new Google Fonts `<link>` for a font
DESIGN.md never sanctions. Also worth noting: neither COMMS nor REACH is
documented in DESIGN.md at all today (zero mentions) — this fix should
probably come with adding a short section for them, not just a CSS swap.

**Depends on:** Nothing technical. Visual-only, worth a screenshot check
against DESIGN.md before changing (per this repo's standing rule: never
touch CSS without reading DESIGN.md first, never ship visual changes without
a screenshot).

---

### Waveform display freezes entirely under prefers-reduced-motion

**Priority:** Medium
**Blocked by:** Nothing — needs a design decision on what "reduced motion"
should mean for a live position readout, not a technical blocker.

**What:** `DeckWaveformV2.jsx`'s `draw()` runs once synchronously at mount,
then only continues via `requestAnimationFrame` `if (!prefersReduced)`.
Under `prefers-reduced-motion`, the entire waveform — playhead, auto-scroll,
hot cues, and (as of the loop-viewport-lock fix) the loop-lock framing — is
static after the first frame. A user with that OS preference who plays
audio or engages a loop sees a frozen image with no indication of where
playback actually is.

**Why:** Surfaced during the loop-viewport-lock eng review (2026-08-21,
Architecture Issue 3) while tracing the rAF gate. Pre-existing — not
introduced or worsened by that fix; loop-lock is exactly as frozen as
everything else in this component already is under that setting.

**Context:** The real fix likely needs to separate two different things
"reduced motion" currently conflates: cosmetic transitions (zoom smoothing,
the loop-lock ease) which SHOULD respect the preference and snap instantly
instead of animating, versus position-critical state (playhead, auto-scroll)
which arguably should keep updating regardless — freezing a live audio
position readout isn't really what `prefers-reduced-motion` is for. Start
by re-reading the `prefersReduced` gate at the top of the `draw()`-loop
`useEffect`.

**Depends on:** Nothing technical.

---

### Loop-length range doesn't match rekordbox's documented ceiling

**Priority:** Low
**Blocked by:** A product decision — does D's actual hip-hop/R&B workflow
need loops longer than 8 bars?

**What:** `LOOP_LENGTH_OPTIONS` (`ArchitectConsole.jsx` lines 134-163) tops
out at 8 bars. rekordbox's official manual (confirmed via direct full-text
search of the downloaded PDF) supports 1/64 to 512 beats (128 bars),
halve/double from the loop-in point, power-of-2 only.

**Why:** DESIGN.md's explicit standing bar for overlapping features is
"meet or beat rekordbox/Serato" (confirmed with D). We already exceed
rekordbox on rhythmic subdivision variety — we have dotted and triplet loop
lengths, confirmed absent from rekordbox's manual entirely — but we're well
short of their long-loop ceiling.

**Context:** Surfaced during the loop-viewport-lock investigation
(2026-08-21). Not a technical blocker, but interacts with that fix's own
`LOOP_LOCK_MAX_WINDOW_SEC` bound (64s) — if loops longer than 8 bars become
selectable, that constant would need reconsidering so very long loops don't
get clipped or forced into an awkwardly zoomed-out frame.

**Depends on:** Nothing technical. Interacts with `computeLoopLockedWindow`'s
max-window bound if picked up.

---

### Deck-header zoom label shows seconds only, not beats

**Priority:** Low
**Blocked by:** Nothing.

**What:** Extend the deck-header `{N}s ↑↓` zoom-seconds label
(`ArchitectConsole.jsx:3425`) to also show the equivalent in beats (e.g.
"32s / 10.7 beats"), using the track's resolved BPM.

**Why:** Raised directly by L during the loop-viewport-lock plan review —
seconds alone don't communicate how much musical content (bars/beats) is
currently visible, which is the more natural framing for beatmatching and
arrangement work. The existing zoom-preset system (`TIME_WINDOWS_SEC`) is
purely seconds-based, so the same zoom preset shows more bars on a fast
track than a slow one — exactly consistent in time, inconsistent in
musical content.

**Context:** BPM is already available via `resolveTrackBpm(deckTrack)`,
used elsewhere in `ArchitectConsole.jsx` — the label math is
`visibleSeconds * bpm / 60`. Should land right next to the existing seconds
label, which the loop-viewport-lock plan already makes loop-lock-aware.
Separately raises a genuinely bigger, explicitly unresolved question from
the same conversation: should the WHOLE zoom-preset system be redefined in
bars/beats instead of seconds, not just this one label? That's a much
larger redesign and its own investigation — don't conflate the two when
picking this up.

**Depends on:** Nothing for the label alone.

---

### "Show your work" page — surface the actual math behind BPM/CONF/ZONES

**Priority:** Medium
**Blocked by:** Nothing technical — needs a decision on scope/location (own
route? panel inside AdminSettings? console rail?) before building.

**What:** L wants a separate place to see how the numbers behind the
tempo-analysis system were actually calculated — not just the resolved
output (a BPM, a confidence %, a ZONES range) but the underlying
math/signal for a given track: the onset envelope, the autocorrelation
score that produced `detected_bpm_confidence`, where `detectTempoSegments`
found (or didn't find) real drift, and why a track landed in the
dynamic/static genre bucket it did.

**Why:** Raised 2026-08-21 right after seeing the CONF/ZONES badges
explained for the first time — L's reaction was "it is cool as fuck" and
immediately wanted a way to inspect the reasoning per-track rather than
just trusting the badge. Good instinct: this system (`beatDetector.js`,
`waveformAnalyzer.js`, `useAudioAnalyzer.js`) has several non-obvious,
heavily-commented decisions (sqrt boost, EMA smoothing, the dynamic/static
confidence-threshold split) that are currently only legible by reading
source code and DESIGN.md's Decisions Log — there's no in-product way to
see "why does this track read 62%" beyond the badge's own tooltip.

**Context:** Real inputs already exist and are computed per-track today —
`bars` (the envelope data), `tempoSegments`, `detectedBpmConfidence` are
all returned by `analyzeWaveform`/`generateAndUploadWaveformV2`
(`src/lib/waveformAnalyzer.js`) but only the final resolved values get
persisted/displayed; the intermediate signal isn't kept around per-track
today. Scope needs a decision: is this a debug-only surface (console-only,
maybe gated to L) or something D would actually want to see too? Start by
rereading `beatDetector.js`'s `detectTempoSegments` header comment and
`useAudioAnalyzer.js:55-86` — both already have unusually thorough
"why" documentation that could seed this page's actual content.

**Depends on:** Nothing technical. Needs a scope decision before design work.

---

### No "select all" for the track browser's REGEN/VOID/PUBLISH multi-select

**Priority:** Low
**Blocked by:** Nothing.

**What:** Track selection (`selectedTrackIds`, `handleTrackSelect` in
`ArchitectConsole.jsx`) is click-to-toggle per row only — no select-all
checkbox, no shift-click range select. To force-regenerate every track in
a vault (e.g. to backfill ZONES data on tracks analyzed before the
2026-08-20 Dynamic Tempo Analysis shipped), you currently have to click
every row's checkbox individually before hitting REGEN.

**Why:** Surfaced 2026-08-21 while explaining how to get ZONES badges to
actually appear across the existing catalog — the REGEN button
(`arch-browser-utility`, both viewers) already does the right thing per
selected track, but there's real friction getting a whole vault selected
at catalog scale.

**Context:** `selectedTrackIds` is a plain `Set` of ids; a "select all
visible" toggle would just need to fill it with every id currently in
`visibleTracks`/`filteredTracks`. Shift-click range select is a separate,
slightly bigger addition (needs a "last clicked index" ref).

**Depends on:** Nothing technical.

---

### Design constraint: instrument meters always keep black backgrounds

**Priority:** N/A (constraint, not a bug) — log for future light-mode/theming work
**Blocked by:** Nothing — this is a standing rule to remember, not a task to build.

**What:** L confirmed (2026-08-21, during the "how hard would a light mode
for D be" conversation): the VU meters, spectrum analyzer, and phase
correlation meter keep their black backgrounds always, regardless of any
future light theme. Only the chrome/shell around them (the achromatic
CSS-token layer — `--void`, `--surface`, `--border`, `--text-primary`, etc.)
would go light; the instrument faces themselves do not.

**Why:** These are canvas-drawn instruments with colors baked directly into
`ctx.fillStyle`/`ctx.strokeStyle` calls (`useAudioAnalyzer.js`, waveform
draw loops in `DeckWaveformV2.jsx`), not CSS tokens — DESIGN.md's VU spec
literally says "Base fill: Black `rgba(0,0,0,0.97)`." Retheming these to
respond to a light mode would require threading theme-aware values into
every canvas draw function — real engineering, not a token flip — and L's
call is that it's not worth it: the instrument-face-stays-black identity is
part of what makes it read as real hardware (matches the "hardware
instrument with a screen" brand personality in PRODUCT.md), not something
to soften for a lighter shell.

**Context:** Directly relevant if/when a `[data-theme="d-light"]` (or
similar) light-mode variant is ever built — see the light-mode feasibility
discussion this session. The CSS/chrome layer would be comparatively cheap
to retheme now specifically because this session's cleanup replaced ~127
hardcoded `rgba(240,237,232,X)` literals with `--text-primary-rgb`/
`--arch-fg-rgb` tokens — but the meters/waveform canvas colors were
deliberately left as literals (correctly, per this constraint) and should
stay that way.

**Depends on:** Nothing technical. This is a design law to respect, not a
build item.

---

### Guest-flow waveform art: PNG path doesn't scroll, contradicting the actual product plan

**Priority:** High — this is a real gap between intended product behavior
and what ships today, not a cosmetic issue.
**Blocked by:** A decision on waveform-art architecture (see Context).

**What:** The intended design (confirmed by L, 2026-08-21) is that the
guest-flow waveform should **scroll as the mix plays** — the same scrolling
zoomed-window behavior the console's `DeckWaveformV2` already does. To
avoid making guests' browsers analyze full WAV files client-side, the
decision was to pre-render a waveform image (PNG) per track and use it as
static "art." But those PNGs are the *entire track's waveform compressed to
fit one screen width* — a static full-track image, not a scrollable zoomed
window. `WaveformImg` (`ListenerVaultView.jsx:404-459`) renders this PNG
with only a CSS playhead line sliding across it — it never scrolls.
Meanwhile `WaveformCanvas` (`ListenerVaultView.jsx:120-361`, the fallback
used when a PNG is missing/fails) *does* do the real 200-bar centered
scrolling zoom, matching the console. So which experience a guest gets
depends entirely on whether that track happens to have a PNG or not —
that's the actual product gap, not a bug in either path individually.

**Also:** the legacy bass-color mapping in `seratoRgb()`
(`ListenerVaultView.jsx:47-51`, bass→blue `#1464dc`) used for old-format
waveform data is **confirmed wrong by L** — "obviously very wrong and
shouldn't show anywhere." This isn't a case of reconciling two valid
mappings; the blue-bass path should never render. Likely means: either
regenerate old tracks' waveform data into the current bass/mid/high format,
or strip color-coding entirely for any track still on the legacy shape
until it's regenerated.

**Why:** Surfaced during the guest-flow audit (2026-08-21) as what looked
like a P2 color-consistency bug, but L's explanation revealed it's actually
about the PNG-art architecture not delivering the "scroll while it plays"
experience at all — the real product intent isn't being met, and different
tracks show inconsistent experiences (scrolling vs. static) depending on
upload history and PNG-generation version, not by design.

**Context:** Needs a real architecture decision, not a patch: does the PNG
approach get replaced with something that supports scrolling (e.g. a
sprite-sheet / tiled PNG approach, or accepting a lightweight client-side
analysis pass after all), or does the static-PNG-as-art approach get
formally kept and the "scroll while it plays" plan revised? Relates
directly to DESIGN.md's already-tracked "ListenerVaultView Waveform
(Pending Upgrade)" note (targeted for Serato frequency-band rendering) —
this is a bigger version of that same gap, not a separate one.

**Depends on:** A product/architecture decision from L before any code
changes. Don't just "fix" the color mismatch without addressing the
underlying scroll-vs-static inconsistency.

**Rollout note (2026-08-21):** once the architecture fix ships, every
already-published track's existing PNG art is stale and needs regenerating
against the new mechanism — regular publish/retract does NOT trigger this
(that only toggles `is_published`, unrelated to waveform assets). The real
mechanism is the console's multi-select REGEN button
(`handleRegenSelected`/`ensureWaveformForTrack(track, false, true)` in
`ArchitectConsole.jsx`), available to both D and L. Regenerating with
today's code would just produce a fresher *squished* PNG — the fix and the
regen have to land together, not regen-then-fix or fix-then-forget-to-regen.
No "select all" exists yet either (separate TODO above), so a full-catalog
regen means selecting every track's checkbox by hand until that ships.

---

### Bring the guest transport in line with the console's real transport style

**Priority:** Medium
**Blocked by:** Nothing technical.

**What:** `StuderTransportBar.jsx` (dead code, unused since some earlier
refactor) was deleted 2026-08-21 along with its orphaned CSS. It was L's
original idea — D likes analog hardware aesthetics, and the plan was an
"analog tape deck" look for the guest transport too. The live guest
transport (`.lvv-transport`/`.lvv-mini-transport` in `ListenerVaultView.jsx`)
is flat (transparent background, 1px borders) — it doesn't share the
console's actual transport visual language.

**Why:** The console's real transport buttons (`.arch-transport-btn`,
`ArchitectConsole.css:1198-1276`) turned out to already be a deliberate
beveled/mechanical-button style — `linear-gradient(180deg, #363636, #181818)`,
layered `box-shadow` simulating a raised key, `transform: translateY(4px)`
press-depth on `:active` — genuinely distinct from the
flat god-btn family (CUE/LOOP/etc). L confirmed directly (2026-08-21): the
guest transport should look the same as the console's transport, not a
separate flat style.

**Context:** Not a straight copy-paste — `StuderTransportBar`'s old attempt
at this same idea had drifted from the current design system (wrong font,
`var(--font-mono)` for word labels instead of Chakra Petch; DESIGN.md
reserves mono strictly for numeric readouts). Whatever replaces
`.lvv-transport`'s current flat styling should match the console's actual
current values (gradient direction, shadow layers, press-depth animation,
Chakra Petch font), not resurrect the old drifted version. See DESIGN.md's
"Audio Transport (Guest Flow)" section, updated the same day this was
logged.

**Depends on:** Nothing technical — this is a straightforward CSS-matching
task once picked up, not a design decision (the reference style already
exists and is confirmed correct in the console).

---

### Run /plan-eng-review on the approved "Show Your Work" math-panel plan

**Priority:** Medium — do this before starting implementation, not after.
**Blocked by:** Nothing technical.

**What:** The "Show Your Work" tempo/confidence diagnostics panel plan
(2026-08-21) went through Explore + Plan-agent design and was approved via
`ExitPlanMode`, but has NOT been through `/plan-eng-review` — the
independent outside-voice pass this project's own lessons.md explicitly
flags as catching real regressions that self-review alone misses (see the
loop-viewport-lock plan's own history: a 4-section self-review felt
complete, the outside-voice pass still found a real bug).

**Why:** Same reasoning applies here as it did there — a plan involving a
new data pipeline (R2 blob, new worker route, extended `beatDetector.js`
return shapes) is exactly the kind of multi-file, architectural change
where an independent second pass is worth running before code gets
written, not just before it ships.

**Context:** Plan file: `~/.claude/plans/wise-conjuring-taco.md`. Full
recommended approach: opt-in `includeDiagnostics` flag on
`dpBeatTrack`/`estimateTempoPeriod` (`src/lib/beatDetector.js`), a new
`buildDiagnosticsPayload` helper in `src/lib/waveformAnalyzer.js`, a third
optional R2 blob via the existing `waveform-assets` upload endpoint
(deliberately NOT a new D1 column, to avoid this project's manual
Cloudflare-dashboard migration gate), and a new inline-expand
`MathPanel.jsx` triggered from the CONF/ZONES badges. 6-task breakdown
(T1-T6) already in the plan file.

**Depends on:** Nothing technical — this is a process step, not a design
decision. Run before T1.

---

## Completed

### AudioContext leak + unthrottled waveform generation on upload

**What:** `analyzeAudio()` never closed its `AudioContext`; `handleUpload` and `loadAndPlay` both bypassed the sequential waveform-generation queue, opening one concurrent decode per file on a multi-file drop.

**Fix:** `analyzeAudio()`'s `decodeAudioData` wrapped in try/finally with `.close()` in both paths; `handleUpload` now routes through `waveformQueueRef`/`runWaveformQueue` via a new `enqueueWaveformGeneration` helper. `loadAndPlay` deliberately calls `ensureWaveformForTrack` directly rather than through the queue — routing it through the queue's playback-pause gate caused a regression (the just-loaded track's own waveform/BPM generation would stall for as long as it played), caught and fixed during pre-ship review.

**Completed:** feat/genre-validation (2026-08-12)

---

### Loop-boundary audible gap — quick fix (rAF polling instead of timeupdate)

**What:** D reported the console's LOOP feature has "a tiny break... not
continuous as a loop must be." `ArchitectConsole.jsx`'s loop-enforcement
effect detected the loop-out boundary via `audioEngine.onStateChange`, which
is driven by the browser's `timeupdate` event — fires only every 15-250ms
per the WHATWG spec (measured ~265ms avg in this project's Chromium build).
By the time a crossing was noticed, playback had already overshot the loop
point by up to that interval before the corrective `seek()` even fired.

**Fix:** extracted the enforcement logic into a standalone, unit-tested
`startLoopEnforcement(loopRegion, loopActiveRef, engine)` function
(`ArchitectConsole.jsx`) that polls `audioEngine.getState()` directly via
`requestAnimationFrame` (~16ms resolution) instead of subscribing to the
throttled listener — cuts the measured overshoot ~94%. New test file:
`src/console/__tests__/startLoopEnforcement.test.js` (4 tests, injectable
raf/caf for deterministic frame-by-frame assertions, no real timers).

**Not fixed by this pass:** true sample-accuracy and click-free splicing at
non-zero-crossing loop points — tracked as its own item above ("Full
sample-accurate gapless loop engine"), deliberately scoped out as a 5-file
architecture change rather than riding in on this fix.

**Completed:** 2026-08-16 (575/575 tests passing, build clean)

---

### Guest session persistence + revalidation, and a live production incident it caused

**What:** built by GitHub Copilot while this session was down (API limit) and
the user was manually finishing the loop-engine deploy — L: "unfortunately, i
had to use copilot." Guest sessions now persist the redemption `code` (not
just `savedAt`), and `ListenerShell` background-revalidates a persisted
session's code against the worker on load, so a revoked/expired code actually
signs the guest out instead of a stale localStorage session staying valid
forever unchecked. `/redeem` also now rejects a missing/empty `fingerprint`
before the device-binding check, closing a scripted-bypass gap.

**The incident:** Copilot's change gated the `0000` public listener code
behind `env.ALLOW_TEST_BYPASS === "true"` — a var that doesn't exist in
production — based on a stale in-code comment calling it a "TEST BYPASS,
remove before public launch." That comment was wrong for the *current*
product: `src/entry/RequestAccessModal.jsx` shows `0000` to every real guest
who requests listening access ("YOUR CODE: 0000 ... unlocks all listening
frequencies. No review required."). It is not a test-only backdoor. Once
deployed, every new guest hit `{"error":"Code not found"}` — confirmed live
via a direct `curl` to the production worker during this session's review.

**Fix:** removed the `ALLOW_TEST_BYPASS` gate (0000 unconditional again,
matching the real product design), rewrote the misleading comment to say
plainly why it must stay that way, deployed the corrected worker immediately
given real users were affected, then confirmed live. Also relaxed
`readPersistedSession()` so a session saved before the `code` field existed
isn't silently signed out — it just skips the new revalidation, same
behavior as before this feature shipped. New regression tests for both: 3 on
the worker's `0000` describe block (`worker/test/redeem.test.js`), 1 for the
legacy-session case (`ListenerShellCodeGate.test.js`).

**Lesson for next time an AI agent (any of them) touches `/redeem` or
anything reading `code === "0000"`:** that literal is a real, permanent,
user-facing product feature, not leftover test scaffolding — verify against
`RequestAccessModal.jsx`'s actual UI copy before "cleaning it up."

**Completed:** 2026-08-19 (651 frontend + 16 worker tests passing, build
clean, deployed to production and verified live — both the worker fix and
the frontend rebuild)
