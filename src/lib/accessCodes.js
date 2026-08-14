import { UPLOAD_WORKER_URL, UPLOAD_SECRET } from "../config";

function authHeaders(extra = {}) {
  if (!UPLOAD_SECRET) return { ...extra };
  return { ...extra, "PSC-Secret": UPLOAD_SECRET };
}

function getOrCreateFingerprint() {
  // localStorage, not sessionStorage: this fingerprint identifies "this
  // device" for access-code binding, and must survive tab/browser close —
  // a fingerprint that resets every session would eventually reject the
  // legitimate holder, not just a stranger with the same code.
  let id = localStorage.getItem("psc_fp");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("psc_fp", id);
  }
  return id;
}

// Validate a listener access code.
// Returns { valid, tier, grantedTo, identityColor } on success.
// Throws with .status 404 (unknown), 409 (claimed by another device), or
// 410 (expired/revoked).
export async function redeemCode(code) {
  const fingerprint = getOrCreateFingerprint();
  const res = await fetch(`${UPLOAD_WORKER_URL}/redeem`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, fingerprint }),
  });
  if (res.status === 404) throw Object.assign(new Error("Code not found"), { status: 404 });
  if (res.status === 409) throw Object.assign(new Error("Code already claimed by another device"), { status: 409 });
  if (res.status === 410) throw Object.assign(new Error("Code expired or revoked"), { status: 410 });
  if (!res.ok) throw Object.assign(new Error("Redemption failed"), { status: res.status });
  return res.json();
}

// D generates a new access code for a recipient.
// opts: { tier?: 'MASTERS'|'MUSES'|'MEMBERS', grantedTo?: string, expiresAt?: string }
export async function generateCode({ tier = "MEMBERS", grantedTo, expiresAt } = {}) {
  const body = { tier };
  if (grantedTo) body.granted_to = grantedTo;
  if (expiresAt) body.expires_at = expiresAt;
  const res = await fetch(`${UPLOAD_WORKER_URL}/access-codes`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Failed to generate code");
  }
  return res.json(); // { code, url }
}

export async function revokeCode(codeId) {
  const res = await fetch(`${UPLOAD_WORKER_URL}/access-codes/${codeId}/revoke`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
  });
  if (!res.ok) throw new Error("Failed to revoke code");
  return res.json(); // { success }
}

export async function listCodes() {
  const res = await fetch(`${UPLOAD_WORKER_URL}/access-codes`, {
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("Failed to fetch codes");
  return res.json();
}
