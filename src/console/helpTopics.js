// COMMS-box keyword-help registry — type a topic keyword into the COMMS
// search input and press Enter to see it. Topics grow via the console-wide
// button/discoverability audit (TODOS.md), not ad hoc additions here.
export const HELP_TOPICS = {
  BEATGRID: {
    label: "BEATGRID",
    lines: [
      "Pause playback — anchor edits are gated while a deck is playing.",
      "Double-click empty waveform space to add an anchor, snapped to the nearest beat.",
      "Double-click an existing anchor — no effect (there's no delete yet).",
      "[ and ] cycle which anchor is selected.",
      "Arrow keys nudge the selected anchor one beat; hold Shift for one bar.",
    ],
  },
  TAP: {
    label: "TAP",
    lines: [
      "Click TAP on the beat, repeatedly, to set BPM manually.",
      "Needs at least 4 taps — fewer shows \"keep tapping…\" and resets.",
      "Pausing over 2 seconds between taps starts a fresh gesture.",
      "Outlier intervals are discarded before averaging, so one mistimed tap won't throw it off.",
    ],
  },
  VALIDATION: {
    label: "VALIDATION",
    lines: [
      "SYSTEM SETTINGS → BEAT DETECTION shows the validation suite's real numbers.",
      "N/M genres validated, ±70ms tolerance — mir_eval's standard onset F-measure tolerance.",
      "Numbers are generated fresh at build time from the exact code being deployed.",
      "\"PENDING VALIDATION\" means the artifact hasn't loaded yet, not that it failed.",
    ],
  },
  TEMPO: {
    label: "TEMPO",
    lines: [
      "ZONES badge replaces CONF when a track has real measured tempo drift — no single BPM to rate confidence against.",
      "DYNAMIC/genre badge (after the BPM digits) shows the track's tempo genre: DYNAMIC, BREAKBEAT, HOUSE, or TECHNO.",
      "Pause playback, then double-click the genre badge — or focus it and press Enter/Space — to cycle the vocabulary.",
      "Genre changes what confidence triggers the octave-correct button: groove-based genres (DYNAMIC, BREAKBEAT) need a lower reading before it appears.",
      "SYSTEM SETTINGS → BEAT DETECTION sets the console-wide default genre for tracks with no per-track override yet.",
    ],
  },
  HELP: {
    label: "HELP",
    lines: [
      "Type a keyword below, press Enter to see instructions:",
      "BEATGRID · TAP · VALIDATION · HOTCUE · SHORTCUTS · VOID · TEMPO",
    ],
  },
  HOTCUE: {
    label: "HOTCUE",
    lines: [
      "Click an empty pad while playing to set a cue there.",
      "Click a set pad to jump to it.",
      "Click the × that appears on a set pad to clear it.",
      "Double-click any pad to name it — naming pins it in place.",
      "SORT toggle: cues auto-arrange chronologically across all 32 pads; named cues stay put.",
      "▽ points down = bank A/B, △ points up = bank C/D. Solid = A/C, hollow = B/D.",
      "CLR (next to the bank selector) wipes the whole bank at once.",
    ],
  },
  SHORTCUTS: {
    label: "SHORTCUTS",
    lines: [
      "Press ? anywhere in the console to see the full keyboard shortcut list.",
    ],
  },
  VOID: {
    label: "VOID",
    lines: [
      "VOID (track toolbar) — soft-deletes selected tracks. Reversible.",
      "VOID PROTOCOL (side rail) — a different action: archives this vault's placeholder record. Not related to track deletion.",
    ],
  },
};
