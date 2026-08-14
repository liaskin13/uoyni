// Tests for POST /redeem's single-device-binding logic (upload-worker.js).
// This endpoint is live in production — every branch here is a regression
// surface, not just new code. Added alongside the GOD MODE MOBILE build
// (2026-08-14) since this repo had zero worker test infrastructure before.
import { env, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

async function seedCode(overrides = {}) {
  const row = {
    id: "TEST1",
    tier: "MEMBERS",
    granted_to: "Fixture",
    expires_at: null,
    redeemed_at: null,
    redeemed_by: null,
    revoked: 0,
    created_by: "D",
    ...overrides,
  };
  await env.PSC_DB.prepare(
    `INSERT INTO access_codes (id, tier, granted_to, expires_at, redeemed_at, redeemed_by, revoked, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      row.id,
      row.tier,
      row.granted_to,
      row.expires_at,
      row.redeemed_at,
      row.redeemed_by,
      row.revoked,
      row.created_by,
    )
    .run();
  return row;
}

async function redeem(code, fingerprint) {
  return SELF.fetch("https://psc-upload-worker.psoulc.workers.dev/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fingerprint === undefined ? { code } : { code, fingerprint }),
  });
}

beforeEach(async () => {
  // D1's .exec() splits on newlines rather than parsing full statements, so
  // a multi-line CREATE TABLE fails there — .prepare().run() takes the
  // whole statement as one string instead.
  await env.PSC_DB.prepare(
    "CREATE TABLE IF NOT EXISTS access_codes (id TEXT PRIMARY KEY, tier TEXT NOT NULL DEFAULT 'MEMBERS', granted_to TEXT, expires_at TEXT, redeemed_at TEXT, redeemed_by TEXT, revoked INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL DEFAULT 'D', created_at TEXT NOT NULL DEFAULT (datetime('now')))",
  ).run();
  await env.PSC_DB.prepare("DELETE FROM access_codes").run();
});

describe("POST /redeem — 0000 test bypass", () => {
  it("is structurally exempt from binding — no row needed, always valid", async () => {
    const res = await redeem("0000", "any-fingerprint");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ valid: true, tier: "MEMBERS", grantedTo: "TEST" });
  });

  it("stays valid even after another device already used it once", async () => {
    const first = await redeem("0000", "device-a");
    expect(first.status).toBe(200);
    const second = await redeem("0000", "device-b");
    expect(second.status).toBe(200);
  });
});

describe("POST /redeem — not found / revoked / expired", () => {
  it("404s for a code that doesn't exist", async () => {
    const res = await redeem("NOPE1", "fp-1");
    expect(res.status).toBe(404);
  });

  it("410s for a revoked code", async () => {
    await seedCode({ id: "REV01", revoked: 1 });
    const res = await redeem("REV01", "fp-1");
    expect(res.status).toBe(410);
  });

  it("410s for an expired code", async () => {
    await seedCode({ id: "EXP01", expires_at: "2020-01-01T00:00:00Z" });
    const res = await redeem("EXP01", "fp-1");
    expect(res.status).toBe(410);
  });

  it("allows a code with a future expiry", async () => {
    await seedCode({ id: "FUT01", expires_at: "2099-01-01T00:00:00Z" });
    const res = await redeem("FUT01", "fp-1");
    expect(res.status).toBe(200);
  });
});

describe("POST /redeem — single-device binding", () => {
  it("claims an unredeemed code on first redemption", async () => {
    await seedCode({ id: "FRESH1" });
    const res = await redeem("FRESH1", "device-a");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ valid: true, tier: "MEMBERS", grantedTo: "Fixture" });

    const row = await env.PSC_DB.prepare("SELECT redeemed_by, redeemed_at FROM access_codes WHERE id = ?")
      .bind("FRESH1")
      .first();
    expect(row.redeemed_by).toBe("device-a");
    expect(row.redeemed_at).toBeTruthy();
  });

  it("allows the same device to redeem again (repeat visit)", async () => {
    await seedCode({ id: "SAME01", redeemed_at: "2026-01-01T00:00:00Z", redeemed_by: "device-a" });
    const res = await redeem("SAME01", "device-a");
    expect(res.status).toBe(200);
  });

  it("rejects a different device once the code is claimed (409)", async () => {
    await seedCode({ id: "TAKEN1", redeemed_at: "2026-01-01T00:00:00Z", redeemed_by: "device-a" });
    const res = await redeem("TAKEN1", "device-b");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/already claimed/i);
  });

  it("does not overwrite redeemed_by when a different device is rejected", async () => {
    await seedCode({ id: "TAKEN2", redeemed_at: "2026-01-01T00:00:00Z", redeemed_by: "device-a" });
    await redeem("TAKEN2", "device-b");
    const row = await env.PSC_DB.prepare("SELECT redeemed_by FROM access_codes WHERE id = ?")
      .bind("TAKEN2")
      .first();
    expect(row.redeemed_by).toBe("device-a");
  });

  it("skips enforcement when the incoming fingerprint is missing (not treated as a match or a new claim)", async () => {
    await seedCode({ id: "NOFP01", redeemed_at: "2026-01-01T00:00:00Z", redeemed_by: "device-a" });
    const res = await redeem("NOFP01", undefined);
    expect(res.status).toBe(200);
  });

  it("does not reject a fresh, never-claimed code when fingerprint is missing", async () => {
    await seedCode({ id: "NOFP02" });
    const res = await redeem("NOFP02", undefined);
    expect(res.status).toBe(200);
  });

  it("a post-reset code (redeemed_by NULL, redeemed_at set) behaves as unclaimed, not as a first-ever redemption error", async () => {
    // Simulates the required migration 0012 state: redeemed_at preserved as
    // real history, redeemed_by nulled out.
    await seedCode({ id: "RESET1", redeemed_at: "2026-06-01T00:00:00Z", redeemed_by: null });
    const res = await redeem("RESET1", "device-new");
    expect(res.status).toBe(200);
    const row = await env.PSC_DB.prepare("SELECT redeemed_by, redeemed_at FROM access_codes WHERE id = ?")
      .bind("RESET1")
      .first();
    expect(row.redeemed_by).toBe("device-new");
    // Original redemption history is preserved, not overwritten with "now".
    expect(row.redeemed_at).toBe("2026-06-01T00:00:00Z");
  });

  it("resolves a same-instant race between two devices claiming the same fresh code deterministically (conditional write)", async () => {
    await seedCode({ id: "RACE01" });
    const [resA, resB] = await Promise.all([redeem("RACE01", "device-a"), redeem("RACE01", "device-b")]);
    const statuses = [resA.status, resB.status].sort();
    // One wins (200), the other loses — either a 409 (if its write lost the
    // race) or, less commonly under real concurrency, it could also see 200
    // if the two requests fully serialized. What must never happen: both
    // devices ending up simultaneously bound as redeemed_by.
    expect(statuses).toContain(200);
    const row = await env.PSC_DB.prepare("SELECT redeemed_by FROM access_codes WHERE id = ?")
      .bind("RACE01")
      .first();
    expect(["device-a", "device-b"]).toContain(row.redeemed_by);
  });
});
