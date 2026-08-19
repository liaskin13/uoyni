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
    redeemCode.mockResolvedValue({
      valid: true,
      tier: "MEMBERS",
      grantedTo: "PUMP",
    });
    render(React.createElement(ListenerShell, { code: "ABCD" }));

    await waitFor(() => expect(redeemCode).toHaveBeenCalledWith("ABCD"));
  });

  it("shows the generic VERIFYING state before resolving", () => {
    redeemCode.mockReturnValue(new Promise(() => {})); // never resolves
    render(React.createElement(ListenerShell, { code: "ABCD" }));

    expect(document.body.textContent).toContain("VERIFYING");
  });

  it("shows the saved code prominently for a same-device guest session", async () => {
    redeemCode.mockResolvedValue({
      valid: true,
      tier: "MEMBERS",
      grantedTo: "PUMP",
    });
    localStorage.setItem(
      "psc_session",
      JSON.stringify({
        grantedTo: "PUMP",
        tier: "MEMBERS",
        code: "ABCD",
        savedAt: Date.now(),
      }),
    );

    render(React.createElement(ListenerShell, {}));

    await waitFor(() => {
      expect(document.body.textContent).toContain("SAVE THIS CODE");
      expect(document.body.textContent).toContain("ABCD");
    });
  });

  it("refreshes saved guest metadata from the worker", async () => {
    redeemCode.mockResolvedValue({
      valid: true,
      tier: "MUSES",
      grantedTo: "UPDATED",
    });
    localStorage.setItem("psc_session", JSON.stringify({
      grantedTo: "OLD",
      tier: "MEMBERS",
      code: "ABCD",
      savedAt: Date.now(),
    }));

    render(React.createElement(ListenerShell, {}));

    await waitFor(() => {
      expect(document.body.textContent).toContain("UPDATED");
      expect(JSON.parse(localStorage.getItem("psc_session")).tier).toBe("MUSES");
    });
  });

  it("accepts a legacy session saved before the `code` field existed, without revalidating it", async () => {
    // Sessions saved by the pre-revalidation CodeGate flow were just
    // {...data, savedAt} — no `code`. They must not be silently signed out
    // once this field starts being required for NEW sessions.
    localStorage.setItem("psc_session", JSON.stringify({
      grantedTo: "PUMP",
      tier: "MEMBERS",
      savedAt: Date.now(),
    }));

    render(React.createElement(ListenerShell, {}));

    await waitFor(() => {
      expect(document.body.textContent).toContain("PUMP");
    });
    expect(redeemCode).not.toHaveBeenCalled();
    expect(localStorage.getItem("psc_session")).not.toBeNull();
  });

  it.each([404, 409, 410])("clears a saved session when the worker returns %s", async (status) => {
    redeemCode.mockRejectedValue(Object.assign(new Error("session invalid"), { status }));
    localStorage.setItem("psc_session", JSON.stringify({
      grantedTo: "PUMP",
      tier: "MEMBERS",
      code: "ABCD",
      savedAt: Date.now(),
    }));

    render(React.createElement(ListenerShell, {}));

    await waitFor(() => expect(localStorage.getItem("psc_session")).toBeNull());
  });

  it("shows ALREADY CLAIMED ON ANOTHER DEVICE for a 409", async () => {
    redeemCode.mockRejectedValue(
      Object.assign(new Error("Code already claimed by another device"), {
        status: 409,
      }),
    );
    render(React.createElement(ListenerShell, { code: "ABCD" }));

    await waitFor(() =>
      expect(document.body.textContent).toContain(
        "ALREADY CLAIMED ON ANOTHER DEVICE",
      ),
    );
  });

  it("still shows THIS LINK HAS EXPIRED for a 410 (regression check)", async () => {
    redeemCode.mockRejectedValue(
      Object.assign(new Error("Code expired or revoked"), { status: 410 }),
    );
    render(React.createElement(ListenerShell, { code: "ABCD" }));

    await waitFor(() =>
      expect(document.body.textContent).toContain("THIS LINK HAS EXPIRED"),
    );
  });

  it("still shows THIS LINK DOESN'T EXIST for a 404 (regression check)", async () => {
    redeemCode.mockRejectedValue(
      Object.assign(new Error("Code not found"), { status: 404 }),
    );
    render(React.createElement(ListenerShell, { code: "ABCD" }));

    await waitFor(() =>
      expect(document.body.textContent).toContain("THIS LINK DOESN'T EXIST"),
    );
  });
});
