import { describe, it, expect } from "vitest";
import { computeHotCuePositions, migrateHotCuesToCueList } from "../hotCueLayout";

describe("computeHotCuePositions", () => {
  it("returns an empty object for no cues", () => {
    expect(computeHotCuePositions([], true)).toEqual({});
    expect(computeHotCuePositions(undefined, true)).toEqual({});
  });

  it("toggle off: every cue renders at its stored slot, unconditionally", () => {
    const cues = [
      { id: "a", time: 50, slot: 20, pinned: false },
      { id: "b", time: 5, slot: 3, pinned: false },
    ];
    const positions = computeHotCuePositions(cues, false);
    expect(positions[20]).toBe(cues[0]);
    expect(positions[3]).toBe(cues[1]);
    expect(Object.keys(positions)).toHaveLength(2);
  });

  it("toggle on: fills pads in pure chronological order, ignoring stored slot", () => {
    const cues = [
      { id: "late", time: 90, slot: 1, pinned: false },
      { id: "early", time: 5, slot: 5, pinned: false },
      { id: "mid", time: 40, slot: 3, pinned: false },
    ];
    const positions = computeHotCuePositions(cues, true);
    expect(positions[1].id).toBe("early");
    expect(positions[2].id).toBe("mid");
    expect(positions[3].id).toBe("late");
  });

  it("pinned cue holds its slot while unpinned cues reflow around it", () => {
    const cues = [
      { id: "pinned-mid", time: 50, slot: 2, pinned: true },
      { id: "early", time: 5, slot: 4, pinned: false },
      { id: "late", time: 90, slot: 6, pinned: false },
    ];
    const positions = computeHotCuePositions(cues, true);
    // Pinned cue stays exactly at its frozen slot regardless of time order.
    expect(positions[2].id).toBe("pinned-mid");
    // Unpinned cues fill the remaining slots (1, 3, 4, ...) in time order,
    // skipping the occupied pinned slot.
    expect(positions[1].id).toBe("early");
    expect(positions[3].id).toBe("late");
    expect(positions[4]).toBeUndefined();
  });

  it("un-pinning (label cleared) rejoins the cue to normal chronological flow", () => {
    const pinnedCase = [
      { id: "was-pinned", time: 50, slot: 2, pinned: true },
      { id: "early", time: 5, slot: 4, pinned: false },
    ];
    const pinnedPositions = computeHotCuePositions(pinnedCase, true);
    expect(pinnedPositions[2].id).toBe("was-pinned");

    const unpinnedCase = [
      { id: "was-pinned", time: 50, slot: 2, pinned: false },
      { id: "early", time: 5, slot: 4, pinned: false },
    ];
    const unpinnedPositions = computeHotCuePositions(unpinnedCase, true);
    expect(unpinnedPositions[1].id).toBe("early");
    expect(unpinnedPositions[2].id).toBe("was-pinned");
  });

  it("truncates gracefully instead of crashing when there are more cues than pads", () => {
    const cues = Array.from({ length: 35 }, (_, i) => ({
      id: `cue-${i}`,
      time: i,
      slot: i + 1,
      pinned: false,
    }));
    const positions = computeHotCuePositions(cues, true);
    expect(Object.keys(positions)).toHaveLength(32);
    expect(positions[32].id).toBe("cue-31");
  });

  it("two pinned cues never collide: the later one is simply not placed", () => {
    const cues = [
      { id: "first-pinned", time: 10, slot: 5, pinned: true },
      { id: "second-pinned", time: 20, slot: 5, pinned: true },
    ];
    const positions = computeHotCuePositions(cues, true);
    expect(positions[5].id).toBe("first-pinned");
    expect(Object.keys(positions)).toHaveLength(1);
  });
});

describe("migrateHotCuesToCueList", () => {
  it("converts old slot-keyed-object storage into the new cue-list shape", () => {
    const old = {
      track1: {
        3: { time: 12.5 },
        7: { time: 40.1, label: "DROP" },
      },
    };
    const migrated = migrateHotCuesToCueList(old);
    expect(migrated.track1).toHaveLength(2);
    const drop = migrated.track1.find((c) => c.label === "DROP");
    expect(drop.pinned).toBe(true);
    expect(drop.slot).toBe(7);
    expect(drop.time).toBe(40.1);
    const unlabeled = migrated.track1.find((c) => !c.label);
    expect(unlabeled.pinned).toBe(false);
    expect(unlabeled.slot).toBe(3);
  });

  it("is idempotent — a track already in list form passes through unchanged", () => {
    const alreadyMigrated = {
      track1: [{ id: "x", time: 5, label: "", pinned: false, slot: 1 }],
    };
    const migrated = migrateHotCuesToCueList(alreadyMigrated);
    expect(migrated).toEqual(alreadyMigrated);
  });

  it("handles empty/missing input without throwing", () => {
    expect(migrateHotCuesToCueList(null)).toEqual({});
    expect(migrateHotCuesToCueList(undefined)).toEqual({});
    expect(migrateHotCuesToCueList({})).toEqual({});
  });
});
