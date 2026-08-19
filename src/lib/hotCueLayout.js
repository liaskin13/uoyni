// A hot cue's pad "position" (1-32) used to be permanent identity — whichever
// pad you clicked is the pad it stayed on forever. Chronological auto-sort
// makes position a computed property instead: this is the single place that
// decides which cue renders at which pad, so every consumer (pad grid,
// waveform markers, bank occupancy dots) reads from the same result.

const TOTAL_SLOTS = 32;

// cues: [{ id, time, label, pinned, slot }]
// sortEnabled: boolean — false reproduces the pre-sort fixed-slot behavior
// exactly; true computes positions from time order, with pinned cues held
// at their frozen slot.
// returns: { [1..32]: cue }
export function computeHotCuePositions(cues, sortEnabled) {
  const positions = {};
  if (!Array.isArray(cues) || cues.length === 0) return positions;

  if (!sortEnabled) {
    for (const cue of cues) {
      if (cue.slot >= 1 && cue.slot <= TOTAL_SLOTS) {
        positions[cue.slot] = cue;
      }
    }
    return positions;
  }

  const occupied = new Set();

  for (const cue of cues) {
    if (!cue.pinned) continue;
    if (cue.slot >= 1 && cue.slot <= TOTAL_SLOTS && !occupied.has(cue.slot)) {
      positions[cue.slot] = cue;
      occupied.add(cue.slot);
    }
  }

  const unpinned = cues
    .filter((cue) => !cue.pinned)
    .slice()
    .sort((a, b) => a.time - b.time);

  let nextSlot = 1;
  for (const cue of unpinned) {
    while (nextSlot <= TOTAL_SLOTS && occupied.has(nextSlot)) nextSlot++;
    if (nextSlot > TOTAL_SLOTS) break; // more cues than pads — drop the overflow, don't crash
    positions[nextSlot] = cue;
    occupied.add(nextSlot);
    nextSlot++;
  }

  return positions;
}

// Converts pre-chronological-sort storage — {trackId: {slot: {time,label?}}}
// — into the current per-track cue-list shape —
// {trackId: [{id,time,label,pinned,slot}]}. Idempotent: a track already in
// list form passes through untouched. Any cue that already carries a label
// becomes pinned at its existing slot, preserving exactly the D-bank-sticky
// behavior that already existed before chronological sort.
export function migrateHotCuesToCueList(stored) {
  if (!stored || typeof stored !== "object") return {};
  const migrated = {};
  for (const [trackId, trackCues] of Object.entries(stored)) {
    if (Array.isArray(trackCues)) {
      migrated[trackId] = trackCues; // already migrated
      continue;
    }
    migrated[trackId] = Object.entries(trackCues || {}).map(([slot, cue]) => ({
      id: crypto.randomUUID(),
      time: cue.time,
      label: cue.label || "",
      pinned: !!cue.label,
      slot: parseInt(slot, 10),
    }));
  }
  return migrated;
}
