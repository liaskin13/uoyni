# Design System — Pleasant Soul Collective

## Product Context

- **What this is:** A cinematic, artist-first music platform. Sovereign infrastructure for independent creators.
- **Who it's for:** M³ tiers — MASTERS (D and L), MUSES (invited collaborators), MEMBERS (paying listeners).
- **Space/industry:** Music , archival, and selective sharing. Not simply a streaming platform — a private instrument.
- **Project type:** Web app / artist console system.

## Memorable Thing

"This is D's world — I'm just visiting." AND: "Looks like nothing anyone has ever seen."

---

## Aesthetic Direction

- **Direction:** Achromatic Brutalist Futurism + Artist Identity Layer
- **Decoration level:** Intentional — dp wallpaper canvas texture, 1px structural borders, identity glows. Nothing decorative for its own sake.
- **Mood:** The platform has no color identity of its own. It is pure black architecture — monumental, precise, cold. The artist brings the color.  The color IS the sovereignty.
- **Key insight:** Every music platform has a brand color. PSC's brand color is *whoever you're visiting.*

---

## Typography

| Role | Font | Notes |
|------|------|-------|
| All UI: display titles, labels, nav, console controls, body | **Chakra Petch** | Singular font. Geometric, technical, cinematic. The voice of the console. No serif, no alternate stacks. |
| Logo mark "dp" | **Comfortaa** | QUARANTINED — logo use only. Never assigned to `--font-display`, `--font-primary`, `--font-ui`, or `--font-headers`. Only appears in: DPWallpaper canvas, `.file-cell-dp-mark`, `.psc-seal`, `.aperture-code-cell.aperture-cell-active::after`. |

**Loading:**

```html
<link href="https://fonts.googleapis.com/css2?family=Chakra+Petch:ital,wght@0,300;0,400;0,500;0,600;0,700;1,400&family=Comfortaa:wght@700&display=swap" rel="stylesheet">
```

Note: Space Mono is kept in `--font-mono` only for genuine numeric data readouts (BPM counters, duration displays, telemetry timestamps). All labels, nav, and UI copy use Chakra Petch.

**Scale:**

- Display (vault titles, muse names): 48–96px, Chakra Petch 700, tracking -0.01em
- Heading: 20–36px, Chakra Petch 600
- UI label: 10–13px, Chakra Petch 500, uppercase, tracking 0.08–0.12em
- Body / track data: 13–14px, Chakra Petch 400
- Micro label: 9–10px, Chakra Petch 500, uppercase, tracking 0.14em

**Why Chakra Petch and not Geist + Cormorant + Space Mono:** D's console is one instrument, one voice. Three fonts = three personalities fighting. Chakra Petch reads equally well as a data readout, a vault title, and a nav label — it just changes weight and scale. No serifs. One typeface, full sovereignty.

---

## Color System

### Base Tokens (achromatic — applies before any theme)

```css
:root {
  /* Foundation */
  --void:            #050505;   /* universal canvas */
  --surface:         #0d0d0d;   /* panels, cards */
  --surface-raised:  #141414;   /* modals, dropdowns */
  --border:          #222222;   /* 1px structural borders */

  /* Typography — ZERO WARMTH. Cold achromatic only. */
  --text-primary:    rgba(230, 230, 230, 0.92);  /* cold near-white — NO warmth */
  --text-secondary:  rgba(160, 160, 160, 0.72);  /* cold mid-gray */
  --text-muted:      rgba(90, 90, 90, 0.80);     /* cold dark-gray */

  /* Identity — filled by theme, transparent by default */
  --identity:        transparent;
  --identity-dim:    transparent;
  --identity-glow:   none;

  /* System states (theme-agnostic) */
  --record-red:      #cc2200;   /* REC active — blood red */
  --error-surface:   #1a0505;
  --error-text:      #ff4444;
  --cmd-success:     rgba(0, 200, 80, 0.22);
  --cmd-fail:        rgba(204, 34, 0, 0.32);

  /* Section tags */
  --section-unreleased: #1a1200;
  --section-released:   #0a1a0a;
  --section-archive:    #181818;

  /* Font system */
  --font-display:  'Chakra Petch', sans-serif;
  --font-primary:  'Chakra Petch', sans-serif;
  --font-ui:       'Chakra Petch', sans-serif;
  --font-headers:  'Chakra Petch', sans-serif;
  --font-mono:     'Space Mono', 'SF Mono', monospace;  /* data readouts only */
}
```

### Pre-Auth Entry Accent (Scrapped — see Settled Entry Design)

Concept: copper accent before theme applied. **Current state (settled 2026-04-26):** This has been removed. Entry screen is now BLACK ON BLACK (no copper, no amber, no color identity until post-auth theme applied). All entry controls use near-white rgba only (0.07–0.22 opacity). The DPWallpaper canvas is the sole visual element on entry.

### Theme Application (implemented)

`App.jsx` sets `data-theme` on `<body>` when a user authenticates:

```js
const themeMap = { D: 'd-soul', L: 'l-architect' };
document.body.setAttribute('data-theme', themeMap[owner]);
```

No theme attribute on entry — pre-auth state stays achromatic.

### Adding Future Artist Themes

```css
[data-theme="custom-{memberId}"] {
  --identity:      /* their chosen color */;
  --identity-dim:  /* rgba version at 0.12 */;
  --identity-glow: /* 0 0 24px rgba version at 0.22 */;
}
```

### Meters vs. Chrome (clarified 2026-08-15, confidence badge resolved same day)

The console's neutral-color rules (e.g. the confidence badge's former
"never red/green-coded" law) apply to **chrome** — static UI tags, labels,
scale markings, structural borders — not to **meters**. A meter's actual
reading has always been allowed real color: VU's needle, SA's frequency
bars, WF's bass/mid/high bands. The badge's old neutral rule borrowed "the
VU-meter principle" by name, but that principle was always about the arc
*markings* staying neutral while the *needle* itself moves and colors
normally — never a blanket "no color" rule.

**Confidence badge — final decision:** the badge itself now carries real
color, discretely — see the updated rule below. (An earlier version of this
clarification proposed a separate always-on meter element, continuously
ramped on `var(--identity)`, living in the deck header's divider. That
element was cut same-day, on direct comparison to the 2026-06-03 "vibe
meter" failure — an ambient colored element sitting next to information
already precisely available as text adds no real signal, just decoration.
The badge's own color carries the meaning instead; no separate element.)

**General principle stands for future work:** a genuine instrument-style
meter (a live reading, not a static tag) may use color. A small static
badge/tag is still chrome by default and should still stay neutral *unless*
there's a specific, reasoned exception (like the confidence badge below) —
this isn't a blanket relaxation for every future tag or button.

**Context:** this console (D's, and L's admin view) is the *stock* theme —
built by L working solo, achromatic by deliberate choice at the time. D has
said directly he dislikes the monochrome look. Per-Master custom theming
(above) is the actual long-term plan, not yet built for D specifically. This
clarification exists so meters read correctly and consistently under any
future theme, not just the current stock one.

---

## Entry Screen

### DP Monogram Wallpaper

Canvas-based, rendered by `DPWallpaper.jsx`. Half-drop tessellation (like Fendi/LV). Comfortaa 700 at 44px. Colors stay within 0–15% lightness — specular layer at #242424, body gradient #0a0a0a–#161616, shadow at #020202. Black gloss on black matte. The door.

**Important:** `.entry-aperture` must have `background: transparent` — the canvas provides the full-screen background. The gate panels carry their own background for the open animation.

### Entry Z-Index Layering

```
DPWallpaper canvas:  position: fixed, z-index: 0   (page level — paints first)
.entry-aperture:     position: fixed, z-index: 1000 (transparent, sits over canvas)
.aperture-gate-*:    position: absolute, z-index: 10 (within aperture stacking context)
.aperture-controls:  position: relative, z-index: 20 (above gates)
```

---

## Spacing

- **Base unit:** 4px
- **Density:** Compact. This is infrastructure, not a landing page.
- **Scale:** 2(2px) 4 8 12 16 24 32 48 64 96
- **Border radius:** `0px` everywhere, except pill toggles (`9999px`). Hard edges. No rounded corners. The material language of milled steel and anodized aluminum.
- **Borders:** 1px only, `var(--border)`. Structural, never decorative.

---

## Layout

- **Approach:** Grid-disciplined. Strict columns, predictable alignment. Hardware console faceplate logic.
- **Grid:** 12 columns desktop, 4 mobile
- **Max content width:** 1440px
- **Console layout:** Full-bleed dark surface, controls justified to a strict 4px grid. Dense, purposeful, no wasted space.
- **Device targets:** Listener view = iPhone primary. D/L consoles = desktop/laptop primary.
- **Console mobile scope:** The D-sovereign and L-sovereign console views are explicitly desktop/laptop-only. Touch targets follow desktop sizing. Mobile breakpoints on the console only handle library column hiding. The Listener Shell is the mobile-first surface — console mobile optimization is out of scope.
- **GOD MODE MOBILE (named exception, 2026-08-14):** A single, narrow, mobile-first surface for tier-A (D/L) sessions authenticating on a phone — access-code generation only (generate/list/revoke, QR display). This is NOT the console made responsive; `ArchitectConsole`/`ContextStrip` remain desktop-only per the rule above, unchanged. It exists because D/L explicitly need to grant access from their phones — a real, confirmed need distinct from "optimize the DJ console for mobile." Touch targets follow the mobile minimum (44px, per the `god-btn` mobile spec below), not desktop sizing.

---

## Motion

- **Approach:** Minimal-functional. State transitions only. No entrance animations. No scroll-driven flourishes. Instruments respond; they don't perform.
- **Easing:** `cubic-bezier(0.25, 0, 0, 1)` — fast-in, controlled-out. Hardware response curve.
- **Durations:** micro 60ms / short 120ms / medium 200ms / long 350ms
- **Identity glow transition:** `transition: box-shadow 200ms, border-color 200ms`
- **Command result flash:** 80ms ease-out peak → 400ms ease-in decay. VU needle behavior.
- **REC armed pulse:** `1.6s ease-in-out infinite`. Slow heartbeat. Never frantic.
- **Theme transition (when switching):** `transition: background-color 300ms, color 300ms, border-color 300ms` on `:root`. The world shifts slowly, like light changing in a room.
- **DPWallpaper on entry exit:** `opacity: 0, transition: opacity 1.6s ease`. The door dissolves.

---

## Listener Shell

The listening room for Shadow subscribers (LISTENER_CODE). iPhone-primary. Post-auth surface but identity-neutral — this is D's world presented to guests, not D's personal console.

- **Background:** `--void` (#050505). DPWallpaper canvas at full opacity (same canvas as entry — the tessellation is permanent, not just a door).
- **Header:** Solid `--surface` (#0d0d0d) strip, 1px `--border` bottom. No gradients. `position: fixed; top: 0; z-index: 10`. Left: LISTENING ROOM kicker + CURATED BY D at 8px/0.2em Chakra Petch. Right: EXIT button.
- **Signal banner:** When D is live — full-width strip at 48px fixed below header. Blood red `--record-red` (#cc2200) 7px pulse dot with `ls-dot-pulse` animation. 1px `--record-red` accent border at bottom. No gradient. `z-index: 20`.
- **Stage hero:** Selected vault preview fills remaining height. Vault label as 48px Chakra Petch 700 display heading. Tagline copy at 11px 0.2em tracking. 1px horizontal rule divider (`--border`). CTA button: Chakra Petch 500, 10px, 0.24em, `border: 1px solid rgba(240,237,232,0.14)`, height 56px, full width.
- **Vault dock:** Fixed bottom bar, 64px, 3-column grid (one per vault). `z-index: 15`. `border-top: 1px solid --border`. Each button: full height, Chakra Petch label at 8-9px, 0.2em tracking. Active vault: `--vault-color` pip (Serato color per vault). Touch target: full button width.
- **Handoff overlay:** Full-screen `--void`, centered OPENING kicker + vault label. 180ms in, 120ms out.
- **Vault names:** MIXES / ORIGINAL MUSIC / LIVE SETS. Never show internal IDs (venus/saturn/mercury) in UI.

---

## Guest Flow

The guest was invited — not discovering. Every design decision in this flow should reflect that. The sensation is receiving a mixtape, not browsing a catalog. Abundance is communicated through time, not marketing.

### Vault Landing

- **Hero:** Total runtime of all published mixes. 72–96px `--font-mono` (Space Mono, valid numeric readout surface). Format: `5:42` = 5 hours 42 minutes. The number IS the promise. No kicker — the number stands alone.
- **Vault name:** Below the hero — vault label + session count at 8px Chakra Petch 600, 0.24em tracking, `--text-secondary`.
- **No CTA button.** Entry is: `TOUCH ANYWHERE TO ENTER` — 10px Chakra Petch 500, 0.14em tracking, `rgba(240,237,232,0.35)` color. Breathes at `opacity: 0.35 ↔ 0.65` over `2.6s ease-in-out infinite`. An invitation, not a button.
- **Background:** DPWallpaper canvas at full opacity. Permanent — same tessellation as entry. The wallpaper is the room, not a door.
- **Layout:** Vertically centered content block. No wasted empty space — if it reads as "page failed to load," something is wrong.

### Mix List

Visual identity problem: PSC has no cover art, no album art, no per-mix image. The **waveform shape IS the artwork** for each mix. Every mix has a distinct waveform fingerprint.

- **Row structure:** track number · title · duration · waveform thumbnail · voice badge
  - Track number: Space Mono 15px, left-anchored, `--text-muted`
  - Title: Chakra Petch 500, flex-grow, `--text-primary`
  - Duration: Space Mono 11px, right-anchored, `--text-secondary`
  - Waveform thumbnail: 52×26px, seeded pseudorandom bars (seed = track title string → always same shape per mix), bar color `rgba(240,237,232,0.55)` (warm off-white — achromatic, not identity green)
  - Voice badge: count only, `--vc` color, 9px Chakra Petch, shown only if comments exist
- **Row height:** 52px. `border-bottom: 1px solid var(--border)`.
- **Seeded waveform:** Use track title as string seed for PRNG. Same input → same bar heights every render. The waveform shape becomes how guests recognize a mix before playing it.

### Player — Paused State

Browser autoplay restrictions make this state extremely common. It must feel inhabited, not broken.

- **Main area:** Ghost waveform at 11% opacity — all bars `rgba(240,237,232,0.11)`. Spatial presence without implying playback.
- **Center overlay:** Track title (14px Chakra Petch 600) + pulsing ▶ SVG polygon glyph (24px, `opacity: 0.4 ↔ 1.0` at `2s ease-in-out`).
- **Reading:** "Something is loaded here. Tap to hear it."

### Player — Playing State

The waveform IS the stage. No album art needed. The shape is identity.

**Current implementation (ListenerVaultView — pending upgrade):**
- Played bars: `#14dc14` at 0.92 alpha — D's identity green
- Unplayed bars: `rgba(240,237,232,0.55)` — warm off-white. Never cold grey.
- Playhead: `1px solid rgba(240,237,232,0.9)`, no glow. Clean wire through the shape.

**Canonical waveform spec (DeckWaveform — see Waveform section below):**
The listener waveform is pending upgrade to the Serato frequency-band approach. When upgraded, it should match the DeckWaveform rendering exactly.

- **Voice comment markers:** Warm diamond dots (6×6px `rotate(45deg)` square, `--vc-dot` color) positioned along the top edge of the waveform at time-mapped x positions. Tapping a diamond opens the comment card.

### Mini-Transport Strip

Persists when a guest navigates from the player back to the track list during playback. The music must not stop — the strip is the bridge.

- **Container:** Fixed bottom strip above the vault dock. `--surface` background, `border-top: 1px solid var(--border)`. Height 48px.
- **Content:** Track title (truncated, Chakra Petch 500 11px) + PAUSE/RESUME button (god-btn compact, 28px) + elapsed time (Space Mono 10px, valid mono surface).
- **Tapping strip:** Returns to full player view. Tapping PAUSE/RESUME acts in place.
- **Critical:** Never hide or remove the strip while audio is playing. The guest navigated away from the player — that was their choice. The music plays until they stop it.

---

## Waveform (Canonical — DeckWaveform)

**The waveform is not decoration. It is the visual identity of the mix.**

PSC has no album art concept. The waveform shape is how a mix is recognized before it plays. This is not a limitation — it is the principle. Every rendering decision reinforces it.

### Serato Frequency-Band Rendering

Used by `DeckWaveform.jsx` (console). Mirrors Serato DJ Pro's GEOB overview. Three frequency bands stacked per bar, tallest drawn first so the dominant color shows at the peak.

| Band | Color | Role |
|------|-------|------|
| Bass | `rgba(226, 88, 20, α)` | Warm orange — the groove |
| Mid  | `rgba(20, 220, 20, α)` | Serato green — the melody |
| High | `rgba(255, 248, 180, α)` | Bright yellow-white — transients, attack |

**Alpha:** Unplayed bars at 1.0. Played (past playhead) bars at 0.25.

**Transient peak cap:** 2px bright line `rgba(255, 255, 220, α)` drawn where the tallest band exceeds 80% of half-height. Marks drum hits and loud transients.

**Playhead:** `rgba(255, 255, 255, 0.9)` — 2px white vertical line. No glow. Precise.

**Center reference:** `rgba(255, 255, 255, 0.10)` — 1px horizontal midline. Subtle axis.

**sqrt boost:** Each band height = `Math.sqrt(band_value) * halfHeight`. Lifts quieter frequencies so orange and yellow remain visible on bass-heavy mixes. Without it, only green shows.

**Waveform is symmetric:** bars mirror above and below the center line. Same height both directions.

### Seeded Placeholder (No Real Waveform Data)

Used in track lists (52×26px thumbnail) and wherever real FFT data isn't available. Seed = track title string → deterministic PRNG → same shape every render. The waveform fingerprint is stable: a guest learns to recognize a mix by its shape before they tap it.

- Thumbnail color: `rgba(240,237,232,0.55)` — warm off-white. Single color (no frequency bands at thumbnail scale).
- Thumbnail size: 52×26px. Seeded bar heights. No playhead.

### ListenerVaultView Waveform (Pending Upgrade)

Currently renders single-color (played green / unplayed off-white). Targeted for upgrade to Serato frequency bands in a future sprint. Until then, use the NEXT_SESSION.md values:

- Played: `#14dc14` at 0.92 alpha
- Unplayed: `rgba(240,237,232,0.55)` — warm off-white, not cold grey
- Ghost (paused): `rgba(240,237,232,0.11)`

### Beatgrid & Quantize (Console-only — DeckWaveformV2)

Shipped 2026-07-24. Real Quantize, offline beat detection, and a multi-point beatgrid — the platform's overlapping-with-pro-DJ-software features must meet or beat rekordbox/Serato (standing bar, confirmed with D). Cue/grid metadata is D's internal production data — console only, **never guest-facing**, same rule as Serato cue labels above.

**Confidence badge:** sits LEFT of the BPM digits (read-first, left-to-right scan order). Rectangular tag, 0px border-radius, `1px solid var(--border)`, `--surface` background — same anatomy as the BPM nixie. Label "CONF" in Chakra Petch 500 8-9px uppercase; number in Space Mono, percentage format ("62%"), no decimal. Hidden entirely (not dimmed) until a detection has actually run.

**Color — revised 2026-08-15 (supersedes the prior "always neutral" rule dated 2026-07-24, see Decisions Log):** the badge's border/text color maps to confidence in discrete 10%-wide bands, reusing the SA's already-established 5-band palette verbatim (`useAudioAnalyzer.js:55-82`) rather than inventing a new confidence-color scale:

| Confidence | Color | Hex |
|---|---|---|
| ≤60% | Red | `#ff0000` |
| 60-70% | Red-orange | `#ff5500` |
| 70-80% | Green | `#00ff00` |
| 80-90% | Cyan | `#00ffff` |
| 90-100% | Indigo | `#6600ff` |

Discrete bands, not a continuous gradient — matches the SA's own discrete-band treatment (frequency doesn't interpolate between band colors either). This is the one carve-out from the platform's general neutral-chrome rule for this specific badge; see "Meters vs. Chrome" above for why, and don't extend it to other tags/buttons without the same reasoning.

**Double/halve octave-correction control:** full `god-btn` pattern — `background: transparent`, `border: 1px solid var(--border)`, Chakra Petch 500 11px 0.12em uppercase, hover → `border-color`/`color: var(--identity)`, 28px height desktop. Renders ONLY when `detected_bpm_confidence` is below the 0.6 threshold — invisible entirely for high-confidence detections, not merely disabled. Corrects the known DP-beat-tracker octave-ambiguity failure mode (90 vs 180 BPM reading equally strong).

**Anchor markers (beatgrid editor):** 6×6px diamonds, three visual states:
- Idle: `rgba(240,237,232,0.55)` — same warm off-white token as unplayed waveform bars, never cold grey.
- Focused (keyboard-selected via `[`/`]`, not dragging): identity-colored 1px outline, no fill, no glow — distinct from idle and dragging.
- Active/dragging: full `var(--identity)` with the existing 200ms glow transition.

Inter-anchor segment line: same `rgba(240,237,232,0.55)` off-white as the idle marker, not `--border` (near-invisible against the void background).

**Playback-state gate:** grid editing (drag/insert) is paused-only. While playing, anchors dim to `opacity: 0.4` and an attempted drag/insert shows a transient inline "PAUSE TO EDIT GRID" label (Chakra Petch 500, small, `--text-secondary`, fading per the standard 120ms motion timing — no modal/toast). Avoids audible glitches from loop/quantize math recalculating mid-playback. Persisted anchor position is the only confirmation on success — no toast, matching "instrument responds, doesn't perform."

**Idle discoverability hint (2026-08-16):** before this, beatgrid editing had zero on-screen affordance at all — double-click-to-add-anchor, `[`/`]` cycling, arrow-key nudging were 100% invisible until you already knew to type BEATGRID into COMMS. A static hint, "DOUBLE-CLICK TO SET BEATGRID," now renders top-center of the waveform, same exact color/style as the "PAUSE TO EDIT GRID" cue above (`rgba(160,160,160,0.85)`, 7px JetBrains Mono). Shows only when paused AND zero anchors exist yet — disappears the moment a first anchor is set, so it never fights the anchor UI once discovered. Console-wide button/discoverability audit, see Decisions Log.

**Not settled:** L flagged discomfort with pause-required editing during plan review (2026-07-22) but chose not to relitigate; shipped as the safe v1 default. Revisit if D finds pausing-to-edit genuinely annoying in practice — see TODOS.md.

---

### COMMS / REACH (Console — ContextStrip)

Fixed-window hardware-style LCD readouts in the console's top strip, MPC III / Pioneer styling. COMMS is search-first (live substring filter against the vault list); REACH is a message preview. Neither has a border-radius or identity/status color for its idle chrome — informational, not a status signal.

**Keyword-help (COMMS).** Typing a recognized topic keyword shows a small "⏎ HELP" hint chip (`--text-secondary`-family, Chakra Petch, ~8px) next to the search field — discoverable before commit, doesn't interrupt live search. **Enter** (not auto-expand-while-typing) opens the existing expandable body panel with the topic's instructions; **Escape** closes it without touching the typed search text. Body content: Chakra Petch, `--text-secondary`, simple vertical list — same neutral treatment as the nav portal, no modal/toast (matches "instruments respond, they don't perform"). Topics live in `src/console/helpTopics.js`; new topics come from the console-wide button/discoverability audit (TODOS.md), not ad hoc additions.

**Entry-point fix (2026-08-16):** the mechanism above shipped 2026-08-15 with one topic (BEATGRID) but stayed invisible — the placeholder just said "SEARCH VAULT," and the "⏎ HELP" chip only appears *after* you've already typed a matching keyword, so nobody could discover the feature existed without being told out-of-band. Placeholder is now `"SEARCH · OR TYPE HELP"`, and a `HELP` topic (self-updating index of every other keyword) makes the whole system findable from itself. Current topics: `BEATGRID`, `TAP`, `VALIDATION`, `HOTCUE`, `SHORTCUTS`, `VOID`, `HELP`.

---

### Hot Cues (Console — hot-cue bank, ArchitectConsole)

8 pads per bank, 4 banks (A/B/C/D) — 32 pads total. Click an empty pad while playing to set a cue there; click a set pad to jump to it.

**Chronological auto-sort (2026-08-19).** A `SORT` toggle (default ON) next to `CLR` makes pad position computed rather than fixed: with sort on, the 32 pads form one continuous chronological sequence (A1 = earliest cue in the track, D8 = latest) — matching Serato's own "Sort Cues and Loops Chronologically" preference, extended to 32 pads instead of 8. A newly-set cue lands wherever it sorts by time, not necessarily on the pad that was clicked; the console announces where it actually landed. Toggle off reproduces the pre-sort behavior exactly — every cue stays on the literal pad it was set on. Data model: `hotCueLayout.js`'s `computeHotCuePositions(cues, sortEnabled)` is the single pure function every consumer (pad grid, waveform markers, bank occupancy dots) reads from — see that file for the full cue-list shape.

**Bank identity glyph (2026-08-19).** Each pad shows a triangle instead of a number: orientation signals the bank pair (A/B point down, C/D point up), fill signals which bank within the pair (A/C solid, B/D hollow, reinforced by solid-vs-dotted pad border). Deliberately shape-coded rather than color-coded — unlike Serato, where cue color alone differentiates same-type markers, PSC's hue channel (`ALL_CUE_COLORS`) is already spent identifying each individual cue's own waveform-marker color, so bank identity needed an orthogonal signal. The glyph uses `currentColor`, so it inherits the same ghost (empty, low-opacity) → full cue-color (occupied) swap the pad's `color` already drove for the old numeral.

**Naming pins a cue in place.** Double-click any pad (all 4 banks, not just D) to open an inline rename editor. Giving a cue a label pins it — it's excluded from auto-sort and keeps its exact pad forever, while unlabeled cues auto-organize by time around it. Clearing the label back to empty un-pins it, letting it rejoin the sort. This is the intended way to keep a memorized structural cue (drop, breakdown) under a fixed finger position while everything else reflows automatically.

**Clearing.** Every occupied pad shows a small always-visible `×` in the top-right corner (`.arch-hotcue-clear`, 12×12px, `rgba(255,255,255,0.45)` idle → `#ff4444` on hover) — click it to clear that one cue. Works on all 4 banks. (The old double-click-twice-within-3s confirm gesture on banks A/B/C was removed 2026-08-19 as fully redundant once every bank's double-click was claimed by rename — the always-visible `×` was already the primary, discoverable clear path.)

**Discoverability hint.** Hovering any pad shows a small tag, in that cue's own color, reading "DOUBLE-CLICK TO EDIT" — covers the pad on hover rather than extending outside it (the pad's `overflow: hidden`, needed for the occupied-state glow overlay, would clip anything positioned below/beside it).

---

### Smart Crates (Console — track browser, ArchitectConsole)

Implemented 2026-08-16 — the toggle existed since an earlier session but was never wired to a behavior (persisted, showed ENABLED/DISABLED, changed nothing). Researched Serato's real Smart Crates feature (rule-based dynamic crates, arbitrary metadata fields, Match All/Any) before building, per direct instruction, rather than guessing.

**Scoped to what's real, not what Serato has.** This schema (`worker/schema.sql`) has no genre/comment/year columns, and `musical_key` is unpopulated freeform text for nearly every track — no key-detection pipeline exists, unlike BPM which every track runs through. So this isn't a full arbitrary-field rule builder: BPM compatibility (±6%, the standard CDJ/turntable pitch-fader range) is the core signal; key is a bonus when it happens to be populated, never a hard requirement. `isBpmCompatible`/`isKeyCompatible`/`smartCrateScore` in `ArchitectConsole.jsx`, pure and unit-tested (`smartCrateScore.test.js`).

**Where it lives:** a `SMART` toggle button directly in the track-browser toolbar (`arch-lib-actions`, next to `LOAD DECK`) — not buried in Settings only, so it's visible right where the library is actually being browsed. The Settings-panel toggle (both viewers) still controls the same state.

**Behavior:** when on and a track is loaded to the deck, tracks compatible with it sort to the top of whatever vault/filter is currently showing and get a small `MATCH` badge — same anatomy as the detected-BPM confidence badge (bordered tag, `JetBrains Mono`), but identity-colored (not confidence-colored) since it's a "this fits" signal, not a measurement.

---

## Voice Comments

Timed voice notes anchored to precise waveform positions. Like SoundCloud timed comments, but with voice — and with rules that protect the mix.

### Philosophy

Voice comments are **listener-authored content** — not platform chrome, not artist identity. They are moments of connection: a listener whispering something about the music at exactly the moment it hit them. The warm near-white color communicates humanity and intimacy, distinct from the cold achromatic system and from D's sovereign identity green.

### Color Tokens

```css
--vc:        rgba(240,230,200,0.72);   /* warm near-white — voice content accent */
--vc-dot:    rgba(240,230,200,0.55);   /* marker dots at rest */
--vc-active: rgba(240,230,200,0.92);   /* active/tapped marker */
--vc-bg:     rgba(20,18,14,0.96);      /* comment card background (dark warm) */
```

Why warm near-white and not identity green: green = D's sovereignty. Warm near-white = a person speaking. The distinction is immediate and correct.

### Marker Anatomy

- 6×6px `rotate(45deg)` square (diamond shape) at `--vc-dot` color
- Positioned at `x = (timestamp / total_duration) × waveform_width` along top edge of waveform
- Tapping expands comment card inline below the waveform. Waveform remains visible.
- Tapping again or tapping elsewhere closes card.

### Comment Card

```
[00:42:17]  L         ×
"the way this break hits after the build..."
[ HEAR IT ]
PLAYS AT WHISPER VOLUME · MIX CONTINUES
```

- Full-width, `--vc-bg` background, `border: 1px solid rgba(240,230,200,0.18)`
- Timestamp: Space Mono 11px (valid mono surface — it's a timestamp readout)
- Handle: Chakra Petch 500 11px. `D` renders in Serato green. `L` renders in L's cyan. Guest handles render in `--vc`.
- Transcript: Chakra Petch 400 **italic**, 13px, `--vc` color. Auto-transcribed from voice by default.
- HEAR IT: 28px god-btn variant, `--vc` border and color. Never auto-plays.
- Footer: `PLAYS AT WHISPER VOLUME · MIX CONTINUES` — 9px Chakra Petch 500, `--text-muted`.

### Audio Behavior (HEAR IT)

The mix never stops. The comment is a layer, not a takeover.

```js
// Web Audio API gain ramping — never interrupts the mix
mixGainNode.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.3)
vcAudio.play()
vcAudio.onended = () => {
  mixGainNode.gain.linearRampToValueAtTime(1.0, ctx.currentTime + 2.0)
}
```

The sensation: someone leans over and whispers to you while the music plays. Then the music comes back up.

Auto-transcription is the **default display**. Voice is always opt-in (HEAR IT button). This solves public-space listening, accessibility, and the "I don't want to make noise" case simultaneously.

### Access Model

**Phase 1 (current spec):**
- Listeners (guests with valid access codes) can post voice comments on any track
- Comments auto-transcribe via Cloudflare AI (Whisper)
- D receives all new comments in console — pending review queue
- D can: respond (text or voice), react (like in Serato green), or ignore
- D's reactions and responses are visible to guests on the comment card
- L's console comments are **never** surfaced to guests — internal only

**Phase 2 (future — do not build yet):**
- D can **sample approved voice comments as audio clips in future mixes** — pull a fan's voice in as an effect or texture
- A fan hears their own voice in a published mix. They lose their mind. They tell everyone.
- This is a deliberate platform differentiator. It closes the loop between listener and artist in a way no platform has done. Spec it when building the comment approval queue.

### Never

- Auto-play voice comments
- Overlay comment text on the waveform (cluttered)
- Show L's internal notes to guests
- Allow voice comments without a valid access code session
- Show Serato cue point labels in the guest view (D does not want this)

---

## Vault Interior

Post-auth vault screen. Full-screen dark surface. Same rules as console: hard edges, Chakra Petch, 1px structural borders, `--identity` glow on active items.

- **Background:** `--void` (#050505). Vault dp wallpaper via CSS `::before` pseudo-element at 2.2% white opacity (pattern texture on surface, not entry canvas).
- **Vault header:** Vault name at 20px Chakra Petch 600 uppercase. Subtitle at 10px 0.2em tracking. Left-aligned. `border-bottom: 1px solid --border`.
- **Command strip:** `god-btn` row below vault header. See god-btn spec below.
- **god-btn pattern** (canonical across vault + console):
  - `background: transparent`
  - `border: 1px solid var(--border, #222222)`
  - Chakra Petch 500, 11px, 0.12em tracking, uppercase
  - Hover: `border-color: var(--identity)`, `color: var(--identity)` (uses whatever identity is active)
  - Disabled: `opacity: 0.35`
  - Height: 28px desktop. Min-height 44px on mobile (touch target).
- **RecordShelf / file cells:** Grid of file cells. Active cell: 2px `--identity` left border + subtle `--identity-glow` background highlight. Void-armed state: cell dims to 0.4 opacity.
- **Void operation overlay:** Full-viewport, `--void` at 0.94 opacity. Title "VOID [TRACK NAME]?" 14px Chakra Petch 600. CANCEL = ghost god-btn. CONFIRM = `--record-red` border god-btn.
- **File cell dp mark:** Comfortaa 700 "dp" mark on cells — this is one of the 4 whitelisted Comfortaa locations.

---

## Audio Transport (StuderTransportBar)

Visual metaphor: Studer A800 tape deck. Hardware readout. Post-auth surface.

- **Container:** `--surface` (#0d0d0d) background. `border-top: 1px solid --border`. Fixed or sticky at bottom of vault screen.
- **Transport controls:** PLAY / STOP / REW / FF / PAUSE / REC. `transport-btn` class: Chakra Petch 500, 10px, 0.12em tracking, 1px `--border` border. Active: `--identity` fill or accent border.
- **REC button:** `--record-red` (#cc2200) border when armed. `rec-pulse` animation at 1.6s ease-in-out (slow heartbeat, matches DESIGN.md motion spec).
- **Status readout:** Track title at 11px Chakra Petch 500. BPM and duration via `--font-mono` (Space Mono, tabular-nums). This is one of 3 valid mono surfaces (the others: BPM nixie in upload modal, telemetry timestamps).
- **Pitch fader:** Range input styled with no rounded thumb. Hidden on mobile (< 640px).

---

## Intake (Upload Modal)

INTAKE is a console-level action. The button lives in the browser utility bar (`arch-browser-utility`) alongside PUBLISH / RETRACT / LOAD DECK — not in the top rail (deliberately clean) and not buried in loop controls.

- **Modal overlay:** `position: fixed; inset: 0; z-index: 1200; background: rgba(0,0,0,0.88)`. The high z-index ensures it clears all console surfaces. NOTE: the UploadModal must be rendered OUTSIDE any `motion.div` that applies a CSS transform — transforms create stacking contexts that trap fixed-position children.
- **Modal container:** `--surface` background, `border: 1px solid --border`, 0px border-radius.
- **Vault selector:** Buttons show MIXES / ORIGINAL MUSIC / LIVE SETS / SONIC ARCH. Internal IDs (venus/saturn/mercury/earth) never shown in UI. Default vault: MIXES (venus).
- **BPM display:** Nixie-style digits using Space Mono tabular-nums. 1px `--border` cell border. No glow or radial gradients.
- **Progress bar:** 2px `--border` track, `--identity` fill.
- **Error state:** `--error-text` (#ff4444) color, `--error-surface` (#1a0505) background, `--error-text` border.

---

---

## Scrapped Concepts (do not revisit)

- **Space/astronomical themes** — scrapped. No planets, no orbital UI, no chakras.
- **Cormorant Garant** — scrapped. Was proposed as display serif. Rejected. Chakra Petch only.
- **Geist** — scrapped. Was proposed for UI. Rejected. Chakra Petch only.
- **Space Mono for labels** — scrapped for labels. Kept only for numeric data readouts via `--font-mono`.
- **Pull cord visual** — scrapped. Button TBD.
- **30/70 vault split** — scrapped. Vault is full-screen.
- **Three.js flyby/warp animations** — removed. Too heavy, off-brand.

---

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-04-24 | Achromatic base + artist identity layer | Platform's brand color is the artist's identity color. Sovereignty model expressed visually. |
| 2026-04-24 | Chakra Petch as the singular typeface | One instrument, one voice. Reads as data readout, vault title, and nav label. No serifs. |
| 2026-04-24 | Comfortaa quarantined to logo/dp mark only | Comfortaa = the brand mark. Every functional element gets Chakra Petch. |
| 2026-04-24 | 0px border-radius everywhere | Hard edges = hardware language. Anodized aluminum, not rounded plastic. |
| 2026-04-24 | DPWallpaper canvas on entry | Canvas-rendered half-drop tessellation. Comfortaa in canvas = correct (it's the logo). |
| 2026-04-24 | D's theme initial concept = 70s soul (warm amber #ffb347) | First theme. Superseded — see 2026-05-04. |
| 2026-05-04 | D's theme = Serato green `--identity: #14dc14`. Amber fully removed. | Locked. variables.css is source of truth. The identity IS the Serato cue green. |
| 2026-04-24 | Theme system via data-theme on body + CSS custom property overrides | `--identity` / `--identity-dim` / `--identity-glow` are the three core theme tokens. |
| 2026-04-24 | Pre-auth entry accent = copper #B87333, not D's amber | Entry is before identity. Copper hints at the premium without committing to D's world. |
| 2026-04-25 | Vault dp wallpaper via CSS ::before at 2.2% white opacity | CSS vars can't go in SVG data URIs. White at near-zero opacity reads as luxury texture against dark identity backgrounds. |
| 2026-04-25 | Orphan track row fix: span full-width via rAF + getBoundingClientRect | Detects lone last-row cells after grid render, applies grid-column: 1 / -1. |
| 2026-04-26 | entry-aperture background: transparent | DPWallpaper canvas provides the background. Aperture must be transparent or canvas is hidden behind it. |
| 2026-05-13 | Listener header: solid --surface + 1px --border, no gradient | Linear gradient is a soft edge in a hard-edge language. Gradient removed. |
| 2026-05-13 | god-btn documented as canonical vault/console control | Shared pattern across all admin surfaces. Needed spec to prevent drift. |
| 2026-05-13 | Space Mono valid in 3 surfaces: transport readout, BPM nixie, telemetry timestamps | All three are numeric data readouts. Everything else: Chakra Petch. |
| 2026-05-13 | UploadModal must render outside any CSS-transform ancestor | CSS transforms create stacking contexts that trap fixed-position modals. Modal moved to sibling of cockpit motion.div. |
| 2026-05-13 | INTAKE button moved to arch-browser-utility bar alongside PUBLISH / RETRACT / LOAD DECK | Top rail is deliberately clean — no functional controls. Loop controls were wrong too. Browser utility bar is correct. |
| 2026-05-13 | Vault selector in INTAKE shows friendly names only | MIXES / ORIGINAL MUSIC / LIVE SETS / SONIC ARCH. Venus/saturn/mercury/earth are internal IDs — never surface them in UI. |
| 2026-05-13 | tune-modal CSS added back to index.css with design system tokens | CSS was deleted in May 10 reconciliation (had banned amber colors). Rewritten with --surface, --border, --identity, 0px border-radius. |
| 2026-05-18 | SIGNAL button neutral at rest, red only when is-live | Red = live signal only. Permanently red SIGNAL conflated idle with broadcasting. |
| 2026-05-18 | BPM sort is 2-state toggle (desc ↔ asc), not 3-state cycle | 3-state cycle returns to date order on 3rd click — accidental sort loss during live use. |
| 2026-05-18 | INTAKE uses --arch-identity color (green D / cyan L) | INTAKE is a sovereign vault action. Identity color marks it as D's control, not platform chrome. |
| 2026-05-19 | Guest flow: total runtime as vault landing hero | Guest was invited, not discovering. Duration communicates abundance and trust. No marketing language. |
| 2026-05-19 | No CTA button on vault landing — "TOUCH ANYWHERE TO ENTER" breathing | An invitation, not a button. The breathing opacity (2.6s ease-in-out) is the only motion on the landing. |
| 2026-05-19 | Waveform shape = visual identity of each mix. No album art. | PSC has no cover art concept. Seeded PRNG from track title → stable, unique waveform fingerprint per mix. |
| 2026-05-19 | Voice comments in warm near-white (--vc), not identity green | Green = D's sovereignty. Warm near-white = a person speaking. The distinction is legible and correct. |
| 2026-05-19 | Voice comments: listener-authored, D can respond/react/like via console | Comments are guest-facing. D's response carries authority (Serato green badge). L's internal notes never surface to guests. |
| 2026-05-19 | HEAR IT ducks mix to 25% gain, ramps back over 2s on ended | Mix is never interrupted. Comment is a layer. Web Audio API linearRampToValueAtTime. |
| 2026-05-19 | Phase 2: D can sample fan voice comments as audio in future mixes | Closes the listener↔artist loop in a way no platform has done. Fan hears their voice in a published mix. Build when comment approval queue ships. |
| 2026-05-19 | Serato cue labels never shown in guest/listener view | D does not want this. Cue points are his internal production metadata, not guest-facing content. |
| 2026-05-20 | User tiers renamed to M³: MASTERS / MUSES / MEMBERS | MASTERS = D and L (sovereign). MUSES = invited collaborators. MEMBERS = paying listeners. Formalizes what was implicit. |
| 2026-05-20 | DeckWaveform: Serato frequency-band rendering (orange/green/yellow-white) | Three bands stacked per bar, sqrt boost, 0.25 alpha past playhead. Mirrors Serato DJ Pro GEOB overview. The waveform IS the artwork. |
| 2026-05-20 | ListenerVaultView waveform: unplayed bars rgba(240,237,232,0.55) not cold grey | Off-white is warm and legible. Cold grey (rgba(160,160,160,0.13)) was wrong — too invisible on void background. |
| 2026-05-20 | Mini-transport strip: persists above vault dock during playback while in tracklist | Guest navigated away from player — their choice. Music plays until they stop it. Strip is the bridge back. |
| 2026-05-27 | Stereo VU: two canvases, L=cyan, R=green | Identity colors on the most live instrument in the console. The stereo field as a collaboration metaphor: L's eye on the left, D's soul on the right. Amber officially retired. |
| 2026-05-27 | Loudness meter: green→cyan gradient arc (the fused mix) | Neither L nor D — the combined signal. Completes the trio: cyan / green / gradient. |
| 2026-05-27 | Waveform 200px → 160px, analyzer row 96px → 120px | Brings waveform:meters ratio from 2.08x to 1.33x, matching pro DJ software proportions. Net deck: −16px. |
| 2026-05-27 | Arc geometry fix: r = min(cx×0.88, H×0.60) | Previous formula Math.min(W,H)×0.78 caused needle to clip off canvas edge at 205°/335° extremes. |
| 2026-05-27 | DPR fix: canvas backing store × devicePixelRatio, ctx.setTransform(dpr,0,0,dpr,0,0) | All needle gauges were rendering at 1x on Retina displays. setTransform before draw; coordinates remain in CSS pixels. |
| 2026-06-20 | VU arc: ctx.ellipse() replacing ctx.arc() — rx=W*0.687, ry=H*0.48, sweep 236.4°→303.6° | Circle cannot produce wide+flat arc on small canvas. Ellipse decouples horizontal/vertical extent. Pivot at H*0.88 (visible, like real instrument). |
| 2026-06-20 | D'Arsonval amplitude-linear normalization — pow(10, vu/20) not linear-dB | Real VU needle deflects ∝ V_rms. This collapses the 20↔10 gap from 38.5% to 11.4% of sweep, matching analog reference. |
| 2026-06-20 | Display range −20 to +6 VU (not +3) — 0 VU sits at center | D's mixes run hot; +6 gives earlier warning before clip. Side effect: 0 VU at 47.5% of sweep (center) vs 68.5% on standard face. Intentional. |
| 2026-06-20 | VU col widened: clamp(380px,38%,520px) desktop | Each canvas ≈260px — enough width for label scale. SA col absorbs shrinkage via flex:1. |
| 2026-07-24 | Confidence badge always neutral cream, never red/green by confidence level | Matches VU-meter principle: arc markings are neutral instrument chrome, not identity colors. A wrong-but-confident-looking badge would be worse than a plain one. |
| 2026-07-24 | Octave double/halve control hidden (not disabled) above the 0.6 confidence threshold | Invisible-when-irrelevant beats a dead button. Only surfaces for the exact failure mode it fixes. |
| 2026-07-24 | Beatgrid anchor editing is paused-only (v1) | Avoids audible glitches from loop/quantize math recalculating mid-playback. L flagged discomfort but didn't relitigate — logged in TODOS.md as not-settled, revisit if D finds it annoying in practice. |
| 2026-07-24 | Beatgrid anchor idle color = rgba(240,237,232,0.55), same token as unplayed waveform bars | One off-white token for "present but not active" across the whole waveform surface, not a new value invented per element. |
| 2026-07-24 | Beat/cue grid metadata is console-only, never guest-facing | Same rule as Serato cue labels — D's internal production data, not guest content. |
| 2026-08-12 | PUBLISH-selection checkbox enlarged 10px→14px, wired to `--arch-muted-rgb`/`--arch-identity` instead of `--arch-accent-rgb` | Was using the wrong achromatic token — accent (labels/headers) instead of muted (structural/inactive controls) — so the checked state had no real identity-color contrast. Fixed alongside a tooltip when nothing is selected. Found via `/investigate`. |
| 2026-08-14 | GOD MODE MOBILE named as a scoped exception to "console mobile optimization is out of scope" | D/L need to generate access codes from their phones — confirmed real, near-term. Kept narrow: one screen, one purpose, not the console made responsive. `ArchitectConsole`/`ContextStrip` stay desktop-only, unchanged. Caught during `/plan-design-review` — the design doc had been through `/office-hours` and `/plan-eng-review` before DESIGN.md was read this session. |
| 2026-08-14 | `--text-secondary`/`--text-muted` brightened (~4.5:1 → ~7.15:1 / ~5.9:1) | These color rules were set by L without D's direct input while building. Real usage surfaced that both sat at the bare WCAG AA line — technically legal, murky in practice, especially for D. L confirmed directly: design rules made without D's input change when real feedback says so. Still strictly grayscale (no warmth added), still keeps `--text-muted` darker than `--text-secondary` (hierarchy preserved). |
| 2026-08-15 | Confidence badge color — supersedes the 2026-07-24 "always neutral" rule. Badge now maps to confidence in 5 discrete 10%-wide bands, reusing the SA's palette verbatim (red→red-orange→green→cyan→indigo) | The neutral rule was set solo, pre-dated D's stated dislike of the monochrome console (see "Meters vs. Chrome" above). L explicitly overrode it during `/plan-eng-review`: "my word is law... there are colours in the VU AND WF AND SA." Reuses the already-vetted SA palette rather than inventing a new confidence-color mapping. A companion always-on meter element (continuously ramped, separate from the badge) was proposed, then cut same-day — direct comparison to the 2026-06-03 vibe-meter failure (ambient color next to info already precisely available as text = decoration, not signal). |
| 2026-08-16 | Idle-state text on enabled console buttons brightened: `.arch-btn`/`.arch-browser-btn` 0.38→0.55 white, `.arch-vault-tab` 0.35→0.75 `--arch-muted-rgb`, `.arch-signal-btn` 0.55→0.75 `--arch-muted-rgb`, `.arch-bank-btn` 0.45→0.75 `--arch-muted-rgb`, `.arch-intake-tab-btn` 0.40→0.80 text / 0.12→0.35 border | Follow-on to the 2026-08-14 text-secondary/muted fix, which only covered passive label text. A `/design-review` contrast sweep against actual rendered backgrounds found these enabled, clickable button classes (vault tabs, browser toolbar, signal, hot-cue banks) sitting at 1.99–3.48:1 — below the 4.5:1 AA floor for their font sizes, i.e. usable but genuinely hard to read, same complaint as the text fix. `+ INTAKE` was pushed further (~7.3:1) rather than just to the floor, per its standing "must be prominent for both viewers" status. Idle-state placeholders that are deliberately near-invisible by design (envelope-row hint, REACH LCD empty state, unassigned hot-cue pads, hover-revealed track-nav arrows) were left alone — they're empty/idle affordances, not buttons carrying information at rest. Hierarchy preserved throughout: idle < hover < active/accent in every fixed class. |
| 2026-08-16 | Round 2, same audit: track-list content text brightened — `.arch-track-artist` 0.45→0.75 `--arch-accent-rgb`, staged-row title/artist dimming 0.55→0.85 opacity, `.arch-track-staged .arch-track-state` 0.5→0.9, `.arch-vault-count` 0.5→0.95 opacity, `.arch-comms-lcd-label`/`.arch-reach-lcd-label` 0.26→0.65, deck-overview `LAYERS ↑↓` hint 0.25→0.5 | D confirmed he's been struggling to read the console since day one ("he needs glasses but is in denial, but he is not wrong" — L, this session) and asked to brighten everything to the legibility floor, not stop at button chrome. A full-page contrast sweep (all text, not just buttons) found the track browser's title/artist/status columns — the content D reads most, to identify and manage his own tracks — at 1.7–3.7:1, worse than the button findings above. Staged-row dimming (0.55 opacity, meant to visually recede unpublished tracks) was compounding with already-low base alphas down to ~3:1; raised the wrapper alone couldn't fix it without also raising the base colors, so both moved together. Same exemptions as round 1 (disabled controls, brand marks, idle placeholders) still apply and were re-verified against the full sweep, not just re-asserted. |
| 2026-08-16 | Console-wide button/discoverability audit executed (the initiative TODOS.md had been tracking since 2026-08-11): HISTORY filter rewired (was bound to an unrelated Settings preference, not `publishFilter`), individual hot-cue clear shipped for all 4 banks (see Hot Cues section above), COMMS keyword-help made findable (placeholder + `HELP` topic), `?` shortcuts trigger added (previously keypress-only), beatgrid idle hint added (see Beatgrid section above), Smart Crates implemented for real (see Smart Crates section above), ~25 previously-undocumented controls got tooltips, ACCESS CODES REVOKE gained a confirm dialog (previously immediate/irreversible with zero warning) | Full accounting of every finding (chosen and not) is in the build plan; nothing was dropped silently. Two items were deliberately scoped out as non-documentation questions rather than built: the octave-correction UX gap (behavior change, new TODOS.md entry) and D's ability to reach admin-tier rail panels (CMD MATRIX/ACCESS CODES/VOID PROTOCOL/ARCHIVE LOG) — L confirmed directly this is intentional, not an oversight: D has full access if he needs it but the admin side isn't meant to be part of his regular workflow, L runs that side. ARCHIVE LOG's "Architect access only" panel text was corrected to match — it was overstating a restriction that doesn't actually exist. |
| 2026-08-19 | Hot cue banks: chronological auto-sort (toggle, default ON) across a continuous 32-slot sequence; bank identity moved from numerals to a triangle glyph (orientation = A/B vs C/D, solid/hollow fill = which bank in the pair); every bank gained D-bank's rename-on-double-click | Researched Serato/Rekordbox before building — Serato ships an actual "Sort Cues and Loops Chronologically" preference, confirming the sort request wasn't a novelty; Serato differentiates same-type cues by color alone, but PSC's hue channel (`ALL_CUE_COLORS`) is already spent per-cue, so bank identity needed shape instead. Labeling a cue pins it (excluded from auto-sort, frozen slot) — L's own resolution to the "does a named cue drift?" question, and the direct mitigation for auto-sort's live-reflow-during-a-set risk. |

---

## Pro-Grade Analyzer Row (VU + φ + Spectrum)

The analyzer row holds three instruments: **VU meters** (left), **Phase Correlation** (center), **Spectrum** (right). All three are canvas-drawn at 120px height, using screen-blend compositing for cinematic PSC aesthetic.

### VU Meter — Stereo Analog Needle Gauges L + R

Two side-by-side canvases in `.arch-vu-col`. Each canvas is `calc(50% - 2px)` width, 120px height. Professional-grade analog VU meter rendering with mechanical needle, matching broadcast/DJ reference standard.

**Design Direction & Rationale (locked 2026-06-18):**

This is a deliberate risk. We're not emulating hardware constraints — we're taking what hardware does well (mechanical precision, proven ballistic response) and adding what software does well (cinematic depth, responsive rendering, identity color integration).

*Why this matters:* Pro DJ software (Serato, Pioneer, Traktor) has settled on either hardware-like mechanical needles (beautiful but limited in rendering) or flat LED bargraphs (accurate but utilitarian). PSC combines both: mechanical needle AESTHETICS with software precision and cinematic depth. The 300ms ballistic response is real (IEC 60268-17 standard), not faked. The shadow layers and screen-blend compositing add professional visual weight that hardware cannot achieve.

*The three strategic bets:*

1. **Software-rendered mechanical needle with shadow depth** — We render a classic analog needle with shadow layers using canvas 2D compositing. This looks more professional and precise than both hardware and flat software meters. Browsers handle this at 60fps effortlessly.

2. **Identity color system (cyan L / green R) instead of generic red/yellow/green** — Every DJ software uses red/yellow/green because they copied hardware standards. PSC uses cyan (L channel) and green (R channel) because this is D's console language. The VU meters reinforce that this is not Serato or Pioneer — this is PSC. Color consistency across waveform, spectrum, and meters = visual coherence.

3. **Fixed-row label alignment matching analog meter faces** — All scale labels share a single horizontal baseline above the arc, with vertical ticks dropping down to meet the arc. This matches how real analog meter faces are printed (flat face, labels on a shared line) and makes every label readable at a glance regardless of where the arc curves beneath it.

*The payoff:* When D opens the console, the cyan/green needles immediately signal "this is my world." The mechanical response feels responsive and precise. The shadow depth makes the needle feel like a real instrument. And the whole meter set reinforces PSC's visual identity without sacrificing professional standards.

**Calibration & Range:**
- Pro standard: **0 VU = -18 dBFS** (SMPTE/AES)
- Display range: **-20 VU to +6 VU** (26 VU total — 3 dB wider than the standard ±3 face, deliberately, so D sees hot signals earlier before the clip LED fires)
- Clipping threshold: **> 0.99 amplitude** (just before digital hard clip)
- **Why "0 VU" sits near center (not right-of-center like a standard face):** Standard meters stop at +3 VU, so 0 lands at 68.5% of sweep. Our scale goes to +6, putting 0 at 47.5% — center. This is a feature, not a bug.

**Geometry (Canvas-relative, DPR-aware) — Ellipse Arc:**
- **Why ellipse:** A circle cannot produce a wide sweep that is also visually flat on a small canvas — curvature is fixed. `ctx.ellipse()` decouples horizontal and vertical radii, making both possible simultaneously.
- **Ellipse center (pivot):** `(W/2, H*0.88)` — visible near bottom of canvas, like a real D'Arsonval movement. Pivot cap: 3px white filled circle.
- **Radii:** `rx = W*0.687` (horizontal, fills canvas width) · `ry = H*0.48` (vertical, shallow → flat arc)
- **Arc sweep:** 236.4° → 303.6° (67.2° total, symmetric around 270° = straight up)
  - 236.4° = -20 VU (upper-left) · 268.3° = 0 VU (near center) · 303.6° = +6 VU (upper-right)
- **Point on arc at angle θ:** `(W/2 + rx·cos θ, H*0.88 + ry·sin θ)`
- **D'Arsonval movement:** Needle deflects ∝ RMS amplitude (V), not dB. Normalization: `normVal = (pow(10, vu/20) − ampMin) / ampRange` where `ampMin = pow(10, −20/20)`, `ampMax = pow(10, 6/20)`. Same formula in rAF loop (EMA) and label positioning.
- **Panel width:** `.arch-vu-col = clamp(380px, 38%, 520px)` desktop · `clamp(220px, 28%, 340px)` at 1100px · `clamp(180px, 26%, 270px)` at 900px

**Background & Depth (Warm Gold Glow from Below):**
- **Base fill:** Black `rgba(0,0,0,0.97)` (canvas background)
- **Warm gold glow (NEW):** Radial gradient radiating from bottom-center (below canvas)
  - Center (bottom-middle): Warm amber-gold `rgba(184, 134, 11, 0.35)`
  - Mid-fade: Darker amber `rgba(139, 90, 0, 0.15)`
  - Edge fade: Transparent `rgba(0,0,0,0)` — fades to black at edges
  - Effect: Backlighting aesthetic from below, like hardware VU meter glow
  - Same glow for both L and R meters

**Scale Ticks & Labels (Fixed Marks):**
- **Major labels (with number):** `20  10  7  5  3  0` (cream) · `3  6` (red) — unsigned display
- **Minor ticks (no label):** `-2  -1  +1  +2` — 4px vertical hash marks, 1px line width, 70% opacity
- **Fixed label row:** All labels share `FIXED_LABEL_Y = (ellipseCY − ry) − 10`. Vertical ticks: `ctx.moveTo(arcX, arcY)` → `ctx.lineTo(arcX, TICK_TIP_Y)` where `TICK_TIP_Y = FIXED_LABEL_Y + 3`. Ticks are longer at edges (arc dips lower there), shorter at center.
- **Colors:** Safe zone (≤0 VU): `rgba(240, 237, 232, 0.85)` cream · Hot zone (>0 VU): `#cc2200` red. NOT identity colors — arc markings are neutral instrument chrome.
- **Font:** Chakra Petch 600, `clamp(8px, H*0.067, 9px)`, `textBaseline: "bottom"`, `textAlign: "center"` (flips to left/right at canvas edges to prevent clip)

**Arc (Two-Color Scale Line):**
- The arc IS the scale line — drawn directly on the ellipse, no separate guide arc behind it.
- **Safe zone** (−20 to 0 VU): `rgba(240, 237, 232, 0.80)` cream · 1.5px stroke · `ctx.ellipse(cx, cy, rx, ry, 0, startRad, zeroAngRad)`
- **Hot zone** (0 to +6 VU): `#cc2200` red · 2.0px stroke · `shadowBlur: 6` glow · `ctx.ellipse(cx, cy, rx, ry, 0, zeroAngRad, endRad)`
- Split point: amplitude-linear 0 VU position ≈ 268.3° (47.5% of sweep)
- `lineCap: "round"` on both segments

**Needle (Mechanical Pointer):**
- **Anatomy:** Shadow layer + bright layer (classical analog gauges)
- **Shadow:** 2.5px dark stroke `rgba(0,0,0,0.5)`, offset +1px (x and y) — deeper shadow for white contrast
- **Bright:** 1.8px white stroke `#ffffff` (pure white, maximum contrast on gold glow background)
- Both: `lineCap: "round"` for soft points, full radius from pivot to arc
- **Pivot cap:** 3px filled circle `#ffffff` at pivot point — white to match needle

**VU Header Label:**
- Text: "VU" (uppercase)
- Position: `(W/2, H*0.65)` — between arc peak and pivot, below needle sweep zone
- Font: Chakra Petch 700 (bold), `clamp(13px, H*0.12, 16px)` — intentionally prominent
- Color: `rgba(240,237,232,0.6)` (cream, muted)

**Peak Hold Indicator:**
- White arc segment at peak level position, 1.5s hold, then ~8dB/sec decay
- Thickness: 2px, color `rgba(240,237,232,0.85)`, `lineCap: "round"`
- Length: ~8% of arc radius

**Channel Label (Bottom):**
- Text: "L" (left canvas) or "R" (right canvas)
- Position: Bottom-center, 2px from bottom
- Font: Chakra Petch 500, 9px
- Color: `rgba(185,185,185,0.50)` (muted gray)

**Clipping Indicator (Emergency State):**
- Appears when peak amplitude > 0.99 (pre-clip headroom gone)
- Visual: Bright red block `rgba(255, 68, 68, α)` spanning canvas width at top, 12px tall
- Animation: 2-second hold at full opacity, then 200ms fade-out
  - `opacity = 1.0` for first 1800ms
  - `opacity = linear fade` from 1800ms → 2000ms
- Purpose: Unmissable emergency indicator; persistent enough to catch eye but not overwhelming

**EMA Needle Smoothing:**
- Time constant: 300ms (IEC 268-17 VU ballistic standard)
- Formula: `alpha = 1 - exp(-dt / 300)`
- Applies to both L and R needles independently
- Result: Mechanical-feeling response, not jittery or sluggish

**DPR Handling:**
- Canvas backing store: `width = dispWidth × devicePixelRatio`, `height = dispHeight × devicePixelRatio`
- Transform: `ctx.setTransform(dpr, 0, 0, dpr, 0, 0)` before all drawing
- Coordinate math: Always in CSS pixels (W, H passed as display dimensions)
- Result: Crisp, anti-aliased rendering on Retina and standard displays

**Responsive Behavior (Mobile):**
- Canvas maintains 1:1 aspect ratio (square)
- Height drives scaling: 70px (mobile) → 90px (tablet) → 120px (desktop)
- All proportional values (radii, font sizes, line widths) scale via percentage formulas
- Never use fixed px values except where explicitly specified (e.g., 3px pivot cap → `max(3px, H*0.025)` on mobile)
- **Clip indicator:** Red block above 0 dBFS, holds 2s after clipping event (value > 0.99)
- **dBFS labels:** Monospace text at each marker (-24, -18, -12, -6, -3, 0), muted gray

**Signal routing:** L = left stereo channel RMS (live FFT time-domain), R = right stereo channel RMS (live FFT time-domain). Fallback when paused: symmetric RMS approximation from overall peak.

**VU Calibration:** 0 VU = -18 dBFS (SMPTE/AES standard). Display range: -20 to +6 VU. A well-mastered track at -18 dBFS average RMS reads exactly 0 VU; 0 dBFS (clipping threshold) reads +18 VU (far off-scale, LED fires at +0.99 amplitude).

**DPR scaling:** Canvas backing store = `canvas.width = dispW * dprLive`, then `ctx.setTransform(dprLive, 0, 0, dprLive, 0, 0)` for sharp retina rendering.

### Phase Correlation Meter (φ) — Mono Compatibility (Center Column)

Single canvas, ~60px wide × 120px tall. Indicates stereo width and phase coherence.

**Scale:** -1 (fully anti-phase, cancels in mono) to +1 (mono-correlated, safe).
- Computed via Pearson correlation on time-domain L/R buffers (ChannelSplitterNode).
- Range visual: -1 at bottom, +1 at top (center axis = 0).

**Visual components:**
- **Background:** Black (rgba(0,0,0,0.97))
- **Ghost segments:** Faint horizontal lines at -1, -0.5, 0, +0.5, +1 (idle state)
- **In-phase fill:** Green (rgba(20,220,20,0.8)) upward from center (positive values)
- **Anti-phase fill:** Red-orange (rgba(229,96,32,0.8)) downward from center (negative values)
- **Pointer:** White line at current correlation value
- **Scale markers:** Small tick marks and numeric labels at -1, -0.5, 0, +0.5, +1
- **Label:** φ symbol, monospace style
- **Tooltip:** "Phase Correlation — +1: mono-safe, -1: cancels in mono"

### Spectrum Analyzer (3-Band RGB) — Right Column

Single canvas, remaining width × 120px tall. Live FFT or pre-analyzed fallback.

**Band assignment (PSC original, forward-thinking):**
- **Bins 0–N/3 (bass):** RED rgba(255,0,0,0.8) — low frequencies, kick energy
- **Bins N/3–2N/3 (mid):** GREEN rgba(0,255,0,0.8) — midrange, vocal/snare energy
- **Bins 2N/3–N (high):** CYAN rgba(0,255,255,0.8) — treble, hi-hat/shimmer energy

**Visual components:**
- **150 bars** (SPEC_N=150), one per frequency band
- **Bar height:** Proportional to frequency-bin energy (clamped to minimum visible floor)
- **Live path:** FFT data from analyser.getByteFrequencyData (bin averaging)
- **Fallback path:** Pre-analyzed waveform data when paused or FFT unavailable
- **Peak hold:** White line (rgba(255,255,220,0.9)) at peak position, decays per-bar
- **Ghost floor:** When idle, all bars show at floor height (subtle baseline)
- **Compositing:** Screen-blend globalCompositeOperation for cinematic crossover blending

**DPR scaling:** Canvas backing store = `canvas.width = dispW * dprLive`, then `ctx.setTransform(dprLive, 0, 0, dprLive, 0, 0)`.

**Visual language coherence:** The 3-band RGB model (red/green/cyan) directly mirrors DeckWaveformV2 waveform bands, making the spectrum and waveform speak the same visual dialect. Kicks hitting the red section of both waveform and spectrum reinforce each other. Cyan hi-hats spike both. This unified language replaces the old rainbow spectrum and positions the console as a coherent instrument, not a patchwork interface.

### Analyzer Row Layout & Proportions (Redesigned 2026-06-18)

**New layout: Colored instrument faces + primary focus on VU meters**

| Element | Width | Height | Reason |
|---------|-------|--------|--------|
| `.arch-vu-col` (L+R) | 60% (30% each) | 100px | Primary meter for DJs; cyan (L) + green (R) faces dominate |
| `.arch-spectrum-deck` | 40% | 100px | Context/reference indicator (reduced from 42% for visual priority) |
| Total deck height | — | 100px | Compact, bold (was 120px); colored faces provide visual weight |

**Responsive scaling:**
- Height formula: `clamp(80px, 12vh, 140px)` — scales with viewport, stays readable
- Desktop (120px+): Full 100px meter height, proportional spectrum
- Tablet (768px): Scales to 90px smoothly
- Mobile (360px): Scales to 80px, still readable with bold faces

**VU meter face design (NEW):**
- **L meter background:** Solid cyan face `rgba(0,255,255,0.25)` — identity color, subtle depth
- **R meter background:** Solid green face `rgba(20,220,20,0.25)` — identity color, subtle depth
- **Geometry:** Horizontal landscape (wider than tall), arc sweep still 215°–325°
- **Visual effect:** Colored face makes needles feel like they sweep across an instrument, not float on black

---

## Idle States (Critical for First Impression)

When no track is loaded or playback is paused:
- **VU meters:** Show ghost bar outlines (faint segments), no peak hold, no clip indicator
- **φ meter:** Show ghost segment grid, pointer returns to 0, no fill bar
- **Spectrum:** Show bars at floor level (minimal visibility), all colors equally dim

These idle states are intentionally designed as backgrounds, not errors. They communicate "ready for input" not "broken."

---

## Console Variable Namespace (`--arch-*`)

`ArchitectConsole.css` uses an `--arch-*` prefix for console-scoped tokens that shadow or extend the global design system. This is intentional isolation — the console is an instrument, not a general surface.

| Token | Value (D-sovereign) | Value (L-sovereign) | Purpose |
|-------|--------------------|--------------------|---------|
| `--arch-identity` | `#14dc14` | `#00e5ff` | Sovereign identity color — active track row, SIGNAL live, INTAKE border |
| `--arch-identity-rgb` | `20, 220, 20` | `0, 229, 255` | RGB triplet for `rgba()` identity calculations |
| `--arch-accent` | `rgba(185,185,185,0.9)` | same | Column headers, labels, muted UI text |
| `--arch-accent-rgb` | `185, 185, 185` | same | Pure achromatic. Zero warmth. |
| `--arch-muted-rgb` | `165, 175, 180` | same | Structural borders and inactive controls |
| `--arch-surface` | `#060606` | same | Console background (distinct from global `--surface`) |

**Planned unification (P2 backlog):** `--arch-identity` → `--identity`, `--arch-accent` → global token. Requires audit of all `--arch-*` usages in ArchitectConsole.css before collapsing.
