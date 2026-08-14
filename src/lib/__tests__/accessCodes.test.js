// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../config", () => ({
  UPLOAD_WORKER_URL: "https://psc-worker.example.com",
  UPLOAD_SECRET: "test-secret",
}));

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

import { redeemCode, generateCode, revokeCode } from "../accessCodes";

// ── helpers ───────────────────────────────────────────────────────────────────

function mockFetch(status, body) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  }));
}

const MOCK_REDEMPTION = {
  valid: true,
  tier: "MEMBERS",
  grantedTo: "PUMP",
  identityColor: "#14dc14",
};

// ── redeemCode ────────────────────────────────────────────────────────────────

describe("redeemCode", () => {
  it("returns redemption data on success (200)", async () => {
    mockFetch(200, MOCK_REDEMPTION);
    const result = await redeemCode("valid-uuid");
    expect(result.valid).toBe(true);
    expect(result.tier).toBe("MEMBERS");
    expect(result.identityColor).toBe("#14dc14");
  });

  it("throws with status 404 for unknown code", async () => {
    mockFetch(404, { error: "Code not found" });
    const err = await redeemCode("bad-uuid").catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(404);
  });

  it("throws with status 410 for expired or revoked code", async () => {
    mockFetch(410, { error: "Code expired or revoked" });
    const err = await redeemCode("expired-uuid").catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(410);
  });

  it("throws with status 409 for a code already claimed by another device", async () => {
    mockFetch(409, { error: "Code already claimed by another device" });
    const err = await redeemCode("taken-uuid").catch(e => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(409);
  });

  it("includes fingerprint in request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(MOCK_REDEMPTION) });
    vi.stubGlobal("fetch", fetchMock);
    await redeemCode("some-uuid");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.fingerprint).toBeTruthy();
    expect(typeof body.fingerprint).toBe("string");
  });

  it("sends the same fingerprint on repeated calls (localStorage stable)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(MOCK_REDEMPTION) });
    vi.stubGlobal("fetch", fetchMock);
    await redeemCode("uuid-1");
    await redeemCode("uuid-2");
    const fp1 = JSON.parse(fetchMock.mock.calls[0][1].body).fingerprint;
    const fp2 = JSON.parse(fetchMock.mock.calls[1][1].body).fingerprint;
    expect(fp1).toBe(fp2);
  });

  it("keeps the same fingerprint across a simulated tab/session close (localStorage, not sessionStorage)", async () => {
    // This is the actual point of the sessionStorage -> localStorage
    // migration: sessionStorage.clear() (what a real tab close does) must
    // NOT rotate the fingerprint, or single-device binding would eventually
    // reject the legitimate holder after their 20-day session expires.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(MOCK_REDEMPTION) });
    vi.stubGlobal("fetch", fetchMock);
    await redeemCode("uuid-1");
    const fp1 = JSON.parse(fetchMock.mock.calls[0][1].body).fingerprint;

    sessionStorage.clear(); // simulates closing the tab/browser

    await redeemCode("uuid-2");
    const fp2 = JSON.parse(fetchMock.mock.calls[1][1].body).fingerprint;
    expect(fp2).toBe(fp1);
  });

  it("POSTs to /redeem with the code in the body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve(MOCK_REDEMPTION) });
    vi.stubGlobal("fetch", fetchMock);
    await redeemCode("test-uuid-abc");
    expect(fetchMock.mock.calls[0][0]).toBe("https://psc-worker.example.com/redeem");
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.code).toBe("test-uuid-abc");
  });
});

// ── generateCode ──────────────────────────────────────────────────────────────

describe("generateCode", () => {
  it("returns { code, url } on success", async () => {
    mockFetch(200, { code: "new-uuid", url: "https://uoyni.com/enter?code=new-uuid" });
    const result = await generateCode({ tier: "MASTERS", grantedTo: "PUMP" });
    expect(result.code).toBe("new-uuid");
    expect(result.url).toContain("new-uuid");
  });

  it("sends PSC-Secret header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ code: "x", url: "y" }) });
    vi.stubGlobal("fetch", fetchMock);
    await generateCode();
    expect(fetchMock.mock.calls[0][1].headers["PSC-Secret"]).toBe("test-secret");
  });

  it("sends tier in body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ code: "x", url: "y" }) });
    vi.stubGlobal("fetch", fetchMock);
    await generateCode({ tier: "MUSES", grantedTo: "JANET" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tier).toBe("MUSES");
    expect(body.granted_to).toBe("JANET");
  });

  it("defaults tier to MEMBERS", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ code: "x", url: "y" }) });
    vi.stubGlobal("fetch", fetchMock);
    await generateCode();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.tier).toBe("MEMBERS");
  });

  it("includes expiresAt when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ code: "x", url: "y" }) });
    vi.stubGlobal("fetch", fetchMock);
    await generateCode({ expiresAt: "2026-12-31T00:00:00Z" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.expires_at).toBe("2026-12-31T00:00:00Z");
  });

  it("throws on error response", async () => {
    mockFetch(400, { error: "tier must be one of: MASTERS, MUSES, MEMBERS" });
    await expect(generateCode({ tier: "INVALID" })).rejects.toThrow();
  });
});

// ── revokeCode ────────────────────────────────────────────────────────────────

describe("revokeCode", () => {
  it("sends PSC-Secret header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await revokeCode("some-code-id");
    expect(fetchMock.mock.calls[0][1].headers["PSC-Secret"]).toBe("test-secret");
  });

  it("PUTs to /access-codes/:id/revoke", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await revokeCode("abc-123");
    expect(fetchMock.mock.calls[0][0]).toBe("https://psc-worker.example.com/access-codes/abc-123/revoke");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
  });

  it("throws on error", async () => {
    mockFetch(500, {});
    await expect(revokeCode("x")).rejects.toThrow("Failed to revoke code");
  });
});
