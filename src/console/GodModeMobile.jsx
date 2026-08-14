import { useState, useEffect, useRef, useCallback } from "react";
import { generate as generateQR } from "lean-qr";
import { generateCode, listCodes, revokeCode } from "../lib/accessCodes";
import "./GodModeMobile.css";

const DEFAULT_TIER = "MEMBERS";
const DEFAULT_EXPIRY_DAYS = 20;

function defaultExpiryISO() {
  return new Date(Date.now() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

function daysUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

function QRCode({ value }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !value) return;
    const code = generateQR(value);
    code.toCanvas(canvasRef.current, {
      on: [0, 0, 0, 255],
      off: [255, 255, 255, 255],
    });
  }, [value]);

  return (
    <canvas
      ref={canvasRef}
      className="gmm-qr-canvas"
      role="img"
      aria-label={`QR code, scan to auto-join — code ${value}`}
    />
  );
}

function GodModeMobile({ owner, onPowerDown, onBrowseVault }) {
  const [name, setName] = useState("");
  const [tier, setTier] = useState(DEFAULT_TIER);
  const [expiresAt, setExpiresAt] = useState(defaultExpiryISO());
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  const [result, setResult] = useState(null); // { code, url }

  const [codes, setCodes] = useState([]);
  const [listState, setListState] = useState("loading"); // loading | ready | error
  const [pendingRevoke, setPendingRevoke] = useState(null); // { id, granted_to }
  const [revokingId, setRevokingId] = useState(null);
  const [revokeError, setRevokeError] = useState(null); // { id, message }

  const loadCodes = useCallback(() => {
    setListState("loading");
    listCodes()
      .then((data) => {
        setCodes(Array.isArray(data) ? data : []);
        setListState("ready");
      })
      .catch(() => setListState("error"));
  }, []);

  useEffect(() => {
    loadCodes();
  }, [loadCodes]);

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!name.trim() || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const data = await generateCode({
        tier,
        grantedTo: name.trim(),
        expiresAt: expiresAt || undefined,
      });
      setResult(data);
      setName("");
      setShowAdvanced(false);
      setTier(DEFAULT_TIER);
      setExpiresAt(defaultExpiryISO());
      loadCodes();
    } catch (err) {
      setGenerateError(err.message || "Failed to generate code");
    } finally {
      setGenerating(false);
    }
  };

  const handleConfirmRevoke = async () => {
    if (!pendingRevoke) return;
    const { id } = pendingRevoke;
    setRevokingId(id);
    setRevokeError(null);
    try {
      await revokeCode(id);
      setCodes((prev) => prev.filter((c) => c.id !== id));
      setPendingRevoke(null);
    } catch (err) {
      // Close the overlay and surface the error on the row itself — the
      // row returns to full opacity, the rest of the list stays
      // interactive, per the design doc's Interaction States table.
      setPendingRevoke(null);
      setRevokeError({ id, message: err.message || "Failed to revoke code" });
    } finally {
      setRevokingId(null);
    }
  };

  const joinUrl = result ? `${window.location.origin}/?code=${result.code}` : null;

  return (
    <div className="gmm-root">
      <div className="gmm-header">
        <div className="gmm-header-row">
          <span className="gmm-header-label">Access Codes</span>
          <span className="gmm-owner-badge">
            {owner === "D" ? "D · GOD MODE" : "L · GOD MODE PLUS"}
          </span>
        </div>
        <div className="gmm-header-row gmm-header-actions">
          {onBrowseVault && (
            <button
              className="gmm-exit-btn"
              onClick={onBrowseVault}
              aria-label="Go to listening view"
            >
              LISTEN
            </button>
          )}
          <button className="gmm-exit-btn" onClick={onPowerDown} aria-label="Exit">
            EXIT
          </button>
        </div>
      </div>

      <div className="gmm-content">
        <section aria-label="Generate new code">
          <div className="gmm-section-title">Generate New Code</div>
          <form onSubmit={handleGenerate}>
            <div className="gmm-field">
              <label className="gmm-field-label" htmlFor="gmm-recipient">
                Recipient
              </label>
              <input
                id="gmm-recipient"
                className="gmm-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="who is this for"
                maxLength={64}
                autoComplete="off"
                required
              />
            </div>

            {!showAdvanced ? (
              <div className="gmm-defaults-summary">
                <span>
                  {tier.charAt(0) + tier.slice(1).toLowerCase()} · Expires in{" "}
                  {daysUntil(expiresAt)} days
                </span>
                <button
                  type="button"
                  className="gmm-change-link"
                  onClick={() => setShowAdvanced(true)}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="gmm-field">
                <label className="gmm-field-label">Tier</label>
                <div className="gmm-tier-row">
                  {["MASTERS", "MUSES", "MEMBERS"].map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`gmm-tier-btn${tier === t ? " gmm-active" : ""}`}
                      onClick={() => setTier(t)}
                    >
                      {t.charAt(0) + t.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                <label className="gmm-field-label" htmlFor="gmm-expiry" style={{ marginTop: 12 }}>
                  Expires
                </label>
                <input
                  id="gmm-expiry"
                  type="date"
                  className="gmm-input"
                  value={expiresAt ? expiresAt.slice(0, 10) : ""}
                  onChange={(e) =>
                    setExpiresAt(
                      e.target.value
                        ? new Date(e.target.value + "T00:00:00Z").toISOString()
                        : null,
                    )
                  }
                />
              </div>
            )}

            <button
              type="submit"
              className="gmm-generate-btn"
              disabled={!name.trim() || generating}
            >
              {generating ? "Generating…" : "Generate Code"}
            </button>
            {generateError && (
              <div className="gmm-inline-error" role="alert">
                {generateError}
              </div>
            )}
          </form>

          {result && (
            <div className="gmm-result-panel">
              <div className="gmm-result-label">Code Ready — Share To Join</div>
              <div className="gmm-result-code">{result.code}</div>
              <div className="gmm-qr-frame">
                <QRCode value={joinUrl} />
              </div>
              <div className="gmm-result-hint">Scan auto-joins · no typing needed</div>
            </div>
          )}
        </section>

        <section aria-label="Active codes">
          <div className="gmm-section-title">Active Codes</div>

          {listState === "loading" && (
            <div className="gmm-skeleton-list">
              <div className="gmm-skeleton-row" />
              <div className="gmm-skeleton-row" />
            </div>
          )}

          {listState === "error" && (
            <div className="gmm-list-error">
              <span>Couldn't load active codes</span>
              <button className="god-btn" onClick={loadCodes}>
                Retry
              </button>
            </div>
          )}

          {listState === "ready" && codes.length === 0 && (
            <div className="gmm-empty-state">No active codes yet</div>
          )}

          {listState === "ready" &&
            codes.map((c) => (
              <div
                className="gmm-list-row"
                key={c.id}
                style={{ opacity: revokingId === c.id ? 0.4 : 1 }}
              >
                <div className="gmm-list-row-info">
                  <span className="gmm-list-row-name">{c.granted_to || "—"}</span>
                  <span className="gmm-list-row-meta">
                    {c.tier} ·{" "}
                    {c.expires_at ? `Expires in ${daysUntil(c.expires_at)} days` : "Expires never"}
                  </span>
                  {revokeError?.id === c.id && (
                    <span className="gmm-inline-error">{revokeError.message}</span>
                  )}
                </div>
                <button
                  className="gmm-revoke-btn"
                  disabled={revokingId === c.id}
                  onClick={() => {
                    setRevokeError(null);
                    setPendingRevoke({ id: c.id, granted_to: c.granted_to });
                  }}
                >
                  Revoke
                </button>
              </div>
            ))}
        </section>
      </div>

      {pendingRevoke && (
        <div className="gmm-void-overlay" role="alertdialog" aria-modal="true">
          <div>
            <div className="gmm-void-title">
              Revoke {pendingRevoke.granted_to || "this"}'s Code?
            </div>
            <div className="gmm-void-sub">They lose access immediately</div>
          </div>
          <div className="gmm-void-actions">
            <button
              className="gmm-void-btn gmm-void-cancel"
              onClick={() => setPendingRevoke(null)}
            >
              Cancel
            </button>
            <button
              className="gmm-void-btn gmm-void-confirm"
              onClick={handleConfirmRevoke}
              disabled={revokingId === pendingRevoke.id}
            >
              {revokingId === pendingRevoke.id ? "Revoking…" : "Confirm"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default GodModeMobile;
