// @vitest-environment jsdom
//
// No test file existed for EntrySequence.jsx before this — it's one of two
// call sites for redeemCode()'s new 409 "already claimed by another device"
// branch (the other is ListenerShell's CodeGate). Scoped to the redeem
// fallback path (resident-code entry is unrelated to this change) plus a
// light regression check on the existing 404/410 handling.
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../../lib/accessCodes", () => ({
  redeemCode: vi.fn(),
}));
vi.mock("../../components/DPWallpaper", () => ({ default: () => null }));

import { redeemCode } from "../../lib/accessCodes";
import EntrySequence from "../EntrySequence";

function typeCode(code) {
  for (const digit of code) {
    fireEvent.keyDown(window, { key: digit });
  }
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
});

describe("EntrySequence — guest access code redemption", () => {
  it("calls onIgnite(null, tier) when redeemCode resolves", async () => {
    redeemCode.mockResolvedValue({
      valid: true,
      tier: "MEMBERS",
      grantedTo: "PUMP",
    });
    const onIgnite = vi.fn();
    render(React.createElement(EntrySequence, { onIgnite }));

    typeCode("9999");

    await waitFor(() => expect(redeemCode).toHaveBeenCalledWith("9999"));
    await waitFor(
      () => expect(onIgnite).toHaveBeenCalledWith(null, "MEMBERS"),
      { timeout: 3000 },
    );
  });

  it("persists the guest code so the same device can return until expiry", async () => {
    redeemCode.mockResolvedValue({
      valid: true,
      tier: "MEMBERS",
      grantedTo: "PUMP",
    });
    render(React.createElement(EntrySequence, { onIgnite: vi.fn() }));

    typeCode("9999");

    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem("psc_session"));
      expect(saved).toMatchObject({
        grantedTo: "PUMP",
        tier: "MEMBERS",
        code: "9999",
      });
    });
  });

  it("still grants access when browser persistence is unavailable", async () => {
    redeemCode.mockResolvedValue({ valid: true, tier: "MEMBERS", grantedTo: "PUMP" });
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage unavailable");
    });
    const onIgnite = vi.fn();
    render(React.createElement(EntrySequence, { onIgnite }));

    typeCode("9999");

    await waitFor(() => expect(onIgnite).toHaveBeenCalledWith(null, "MEMBERS"), { timeout: 3000 });
    setItem.mockRestore();
  });

  it("shows ALREADY CLAIMED for a 409 (code claimed by another device)", async () => {
    redeemCode.mockRejectedValue(
      Object.assign(new Error("Code already claimed by another device"), {
        status: 409,
      }),
    );
    render(React.createElement(EntrySequence, { onIgnite: vi.fn() }));

    typeCode("9999");

    await waitFor(() =>
      expect(document.body.textContent).toContain("ALREADY CLAIMED"),
    );
  });

  it("still shows CODE EXPIRED for a 410 (regression check)", async () => {
    redeemCode.mockRejectedValue(
      Object.assign(new Error("Code expired or revoked"), { status: 410 }),
    );
    render(React.createElement(EntrySequence, { onIgnite: vi.fn() }));

    typeCode("9999");

    await waitFor(() =>
      expect(document.body.textContent).toContain("CODE EXPIRED"),
    );
  });

  it("shows ACCESS DENIED for a 404 (regression check)", async () => {
    redeemCode.mockRejectedValue(
      Object.assign(new Error("Code not found"), { status: 404 }),
    );
    render(React.createElement(EntrySequence, { onIgnite: vi.fn() }));

    typeCode("9999");

    await waitFor(() =>
      expect(document.body.textContent).toContain("ACCESS DENIED"),
    );
  });
});
