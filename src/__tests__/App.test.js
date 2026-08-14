// @vitest-environment jsdom
//
// Scope note: this file does NOT attempt full App.jsx coverage (every stage
// transition, every guard) — that's a much larger surface than either of
// the two things it actually tests. It exists for two reasons:
//
// 1. Regression-proof the identity-change queue reset added while fixing
//    the INTAKE batch-upload bug. Without it, App.jsx (which never unmounts
//    across a power-down/re-login cycle) would leak one owner's upload
//    queue into the next owner's console. The reset lives inside
//    handleIgnite itself (synchronous, same handler that flips
//    consoleOwner) rather than in a useEffect keyed on consoleOwner — a
//    dependency-array effect runs after commit/paint, which left a real
//    (if sub-frame) window for React to paint the new owner's console with
//    the previous owner's stale queue still in it. Flagged by
//    /security-review, fixed by moving the reset into the handler so
//    there's no separate render for a stale frame to exist in.
//
// 2. Regression-proof the GOD MODE MOBILE routing branch (2026-08-14):
//    tier==="A" && isMobile must land D/L on the mobile quick-grant screen,
//    not the guest room — and a guest session on mobile must still land in
//    the room, completely unaffected. Before this, useBreakpoint was
//    hardcoded to isMobile: false at module scope, so no mobile branch in
//    this file had ever been exercised at all.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { SESSION_KEY } from "../config";

// ─── Module mocks (hoisted before imports) ───────────────────────────────────

let mockSystemState = {
  consoleOwner: null,
  sessionMeta: null,
  setConsoleOwner: vi.fn(),
  setSessionMeta: vi.fn(),
};
vi.mock("../state/SystemContext", () => ({
  useSystem: () => mockSystemState,
}));

vi.mock("../hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => true,
}));

// Reassignable per-test, unlike a static `() => ({ isMobile: false })` —
// lets individual tests simulate a phone viewport without a new mock file.
let mockIsMobile = false;
vi.mock("../hooks/useBreakpoint", () => ({
  useBreakpoint: () => ({ isMobile: mockIsMobile }),
}));

const mockReset = vi.fn();
vi.mock("../hooks/useDragDropBatch", () => ({
  useDragDropBatch: () => ({
    queue: [],
    addFiles: vi.fn(),
    retry: vi.fn(),
    dismiss: vi.fn(),
    reset: mockReset,
    duplicateCount: 0,
    isDraggingOver: false,
    onDragEnter: vi.fn(),
    onDragOver: vi.fn(),
    onDragLeave: vi.fn(),
    onDrop: vi.fn(),
  }),
}));

// Stands in for the real EntrySequence with a single button that fires
// onIgnite exactly the way a real login does, so handleIgnite runs for
// real. owner/tier are reassignable per test (default: D, tier A) so the
// same mock can simulate a guest login too.
let mockIgniteOwner = "D";
let mockIgniteTier = "A";
vi.mock("../entry/EntrySequence", () => ({
  default: ({ onIgnite }) =>
    React.createElement(
      "button",
      { onClick: () => onIgnite(mockIgniteOwner, mockIgniteTier) },
      "MOCK IGNITE",
    ),
}));

vi.mock("../components/CommandPalette", () => ({
  default: () => null,
}));

// GodModeMobile and ListenerShell are real, lazily-loaded components (async
// dynamic import even when mocked) — stubbed with identifiable markers so
// stage-routing tests can assert which one actually rendered, via an
// awaited query rather than a synchronous one.
vi.mock("../console/GodModeMobile", () => ({
  default: () => React.createElement("div", { "data-testid": "godmode-mobile-mock" }),
}));
vi.mock("../listener/ListenerShell", () => ({
  default: () => React.createElement("div", { "data-testid": "listener-shell-mock" }),
}));

import App from "../App";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  mockSystemState = {
    consoleOwner: null,
    sessionMeta: null,
    setConsoleOwner: vi.fn(),
    setSessionMeta: vi.fn(),
  };
  mockIsMobile = false;
  mockIgniteOwner = "D";
  mockIgniteTier = "A";
});

describe("batch-upload queue identity reset", () => {
  it("resets the batch queue synchronously as part of a fresh login (handleIgnite)", () => {
    render(React.createElement(App));
    expect(mockReset).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector("button"));

    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("resets the batch queue on auto-login from a persisted session on mount", () => {
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ owner: "D", tier: "A", expires: Date.now() + 60_000 }),
    );

    render(React.createElement(App));

    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it("does not reset on unrelated re-renders that don't call handleIgnite", () => {
    const { rerender } = render(React.createElement(App));
    expect(mockReset).not.toHaveBeenCalled();

    rerender(React.createElement(App));

    expect(mockReset).not.toHaveBeenCalled();
  });
});

describe("GOD MODE MOBILE routing (tier===A && isMobile)", () => {
  it("routes a tier-A phone login to GOD MODE MOBILE, not the guest room", async () => {
    mockIsMobile = true;
    mockIgniteOwner = "L";
    mockIgniteTier = "A";
    render(React.createElement(App));

    fireEvent.click(document.querySelector("button"));

    expect(await screen.findByTestId("godmode-mobile-mock")).toBeTruthy();
    expect(screen.queryByTestId("listener-shell-mock")).toBeNull();
  });

  it("still routes a tier-A phone login for D (not just L) to GOD MODE MOBILE", async () => {
    mockIsMobile = true;
    mockIgniteOwner = "D";
    mockIgniteTier = "A";
    render(React.createElement(App));

    fireEvent.click(document.querySelector("button"));

    expect(await screen.findByTestId("godmode-mobile-mock")).toBeTruthy();
  });

  it("regression: a guest (non tier-A) session on mobile still lands in the room, unaffected by the new branch", async () => {
    mockIsMobile = true;
    mockIgniteOwner = null;
    mockIgniteTier = "G";
    render(React.createElement(App));

    fireEvent.click(document.querySelector("button"));

    expect(await screen.findByTestId("listener-shell-mock")).toBeTruthy();
    expect(screen.queryByTestId("godmode-mobile-mock")).toBeNull();
  });
});
