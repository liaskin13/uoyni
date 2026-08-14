// @vitest-environment jsdom
//
// No test file existed for ListenerShell.jsx before this. Scoped narrowly to
// CodeGate — the ?code= auto-redeem entry point and the other call site
// (besides EntrySequence) for redeemCode()'s new 409 "already claimed by
// another device" branch. CodeGate is an internal, unexported component;
// it's reached via ListenerShell's `code` prop with no persisted session,
// which returns it as an early render before anything else in the tree.
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";

vi.mock("../../lib/accessCodes", () => ({
  redeemCode: vi.fn(),
}));
vi.mock("../../lib/tracks", () => ({
  fetchPublishedVaultTracks: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../components/DPWallpaper", () => ({ default: () => null }));
vi.mock("../../signal/TheSignal", () => ({ default: () => null }));
vi.mock("../ListenerVaultView", () => ({ default: () => null }));
vi.mock("../../components/PSCWordmark", () => ({ default: () => null }));

import { redeemCode } from "../../lib/accessCodes";
import ListenerShell from "../ListenerShell";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve(null) }),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("ListenerShell CodeGate — ?code= auto-redeem", () => {
  it("calls redeemCode automatically on mount with no typing", async () => {
    redeemCode.mockResolvedValue({ valid: true, tier: "MEMBERS", grantedTo: "PUMP" });
    render(React.createElement(ListenerShell, { code: "ABCD" }));

    await waitFor(() => expect(redeemCode).toHaveBeenCalledWith("ABCD"));
  });

  it("shows the generic VERIFYING state before resolving", () => {
    redeemCode.mockReturnValue(new Promise(() => {})); // never resolves
    render(React.createElement(ListenerShell, { code: "ABCD" }));

    expect(document.body.textContent).toContain("VERIFYING");
  });

  it("shows ALREADY CLAIMED ON ANOTHER DEVICE for a 409", async () => {
    redeemCode.mockRejectedValue(Object.assign(new Error("Code already claimed by another device"), { status: 409 }));
    render(React.createElement(ListenerShell, { code: "ABCD" }));

    await waitFor(() => expect(document.body.textContent).toContain("ALREADY CLAIMED ON ANOTHER DEVICE"));
  });

  it("still shows THIS LINK HAS EXPIRED for a 410 (regression check)", async () => {
    redeemCode.mockRejectedValue(Object.assign(new Error("Code expired or revoked"), { status: 410 }));
    render(React.createElement(ListenerShell, { code: "ABCD" }));

    await waitFor(() => expect(document.body.textContent).toContain("THIS LINK HAS EXPIRED"));
  });

  it("still shows THIS LINK DOESN'T EXIST for a 404 (regression check)", async () => {
    redeemCode.mockRejectedValue(Object.assign(new Error("Code not found"), { status: 404 }));
    render(React.createElement(ListenerShell, { code: "ABCD" }));

    await waitFor(() => expect(document.body.textContent).toContain("THIS LINK DOESN'T EXIST"));
  });
});
