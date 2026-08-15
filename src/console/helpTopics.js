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
};
