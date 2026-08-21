import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import DPWallpaper from "../components/DPWallpaper";
import TheSignal from "../signal/TheSignal";
import ListenerVaultView from "./ListenerVaultView";
import {
  VAULT_ACCENT_COLORS,
  UPLOAD_WORKER_URL,
  SESSION_KEY,
  SESSION_TTL_MS,
} from "../config";
import { fetchPublishedVaultTracks } from "../lib/tracks";
import PSCWordmark from "../components/PSCWordmark";
import { redeemCode } from "../lib/accessCodes";

const WORKER_URL = UPLOAD_WORKER_URL;
const SIGNAL_POLL_MS = 10000;

// Fallback used while /vaults fetch is in flight
const LISTENER_VAULTS_FALLBACK = [
  {
    id: "venus",
    label: "MIXES",
    color: VAULT_ACCENT_COLORS.venus,
    copy: "EXTENDED SETS · FULL SEQUENCES · NO INTERRUPTIONS",
  },
  {
    id: "saturn",
    label: "ORIGINAL MUSIC",
    color: VAULT_ACCENT_COLORS.saturn,
    copy: "STUDIO RECORDINGS · STEMS · UNRELEASED CUTS",
  },
  {
    id: "mercury",
    label: "LIVE SETS",
    color: VAULT_ACCENT_COLORS.mercury,
    copy: "RAW FROM THE ROOM · CAPTURED · MASTERED FOR THE ARCHIVE",
  },
];

// ── CODE GATE — renders before vault when an access code is present ──────────
function CodeGate({ code, onGranted }) {
  const [status, setStatus] = useState("loading"); // loading | error-404 | error-409 | error-410 | error-unknown
  const [closeBlocked, setCloseBlocked] = useState(false);

  useEffect(() => {
    redeemCode(code)
      .then((data) => onGranted(data))
      .catch((err) => {
        if (err.status === 404) setStatus("error-404");
        else if (err.status === 409) setStatus("error-409");
        else if (err.status === 410) setStatus("error-410");
        else setStatus("error-unknown");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const messages = {
    loading: null,
    "error-404": "THIS LINK DOESN'T EXIST",
    "error-409": "ALREADY CLAIMED ON ANOTHER DEVICE",
    "error-410": "THIS LINK HAS EXPIRED",
    "error-unknown": "SOMETHING WENT WRONG",
  };

  if (status === "loading") {
    return (
      <div className="code-gate" aria-live="polite">
        <DPWallpaper opacity={1} />
        <div className="code-gate-identity-glow" aria-hidden="true" />
        <span className="code-gate-status">VERIFYING</span>
      </div>
    );
  }

  return (
    <div className="code-gate code-gate--error" role="alert">
      <DPWallpaper opacity={1} />
      <div className="code-gate-identity-glow" aria-hidden="true" />
      <p className="code-gate-message">{messages[status]}</p>
      {closeBlocked ? (
        <p className="code-gate-close-hint">YOU CAN CLOSE THIS TAB NOW</p>
      ) : (
        <button
          className="code-gate-close god-btn"
          onClick={() => {
            if (window.history.length > 1) {
              window.history.back();
              return;
            }
            window.close();
            // Neither browser history nor a script-opened tab was
            // available, so window.close() is a silent no-op here — if
            // we're still around a beat later, tell the guest plainly
            // instead of leaving a CLOSE button that visibly did nothing.
            setTimeout(() => setCloseBlocked(true), 150);
          }}
        >
          CLOSE
        </button>
      )}
    </div>
  );
}

function formatDurationHero(totalSecs) {
  if (!totalSecs) return "--";
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  return `${h}H ${m}M`;
}

function readPersistedSession() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    // `code` is required to background-revalidate (see the isRevalidating
    // effect below) but NOT to accept the session — a guest who logged in
    // before this field existed still has a legitimate, unexpired session
    // and shouldn't be silently signed out. Sessions without `code` just
    // never revalidate (isRevalidating stays false for them), same as
    // before this feature existed.
    if (
      saved?.grantedTo &&
      saved.savedAt &&
      Date.now() - saved.savedAt < SESSION_TTL_MS
    ) {
      return saved;
    }
  } catch (_) {}
  return null;
}

function clearPersistedSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (_) {}
}

function saveGuestSession(data, code) {
  const session = {
    ...data,
    code: data?.code || code,
    savedAt: Date.now(),
    expires: Date.now() + SESSION_TTL_MS,
  };
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch (_) {}
  return session;
}

function ListenerShell({ onPowerDown, sessionMeta, code, onGodModeMobile }) {
  const [initialSession] = useState(() =>
    code ? null : readPersistedSession(),
  );
  const [codeSession, setCodeSession] = useState(initialSession);
  const [isRevalidating, setIsRevalidating] = useState(
    Boolean(initialSession?.code),
  );
  const [showWelcome, setShowWelcome] = useState(false);
  const [vaults, setVaults] = useState(LISTENER_VAULTS_FALLBACK);
  const [selectedVaultId, setSelectedVaultId] = useState(
    LISTENER_VAULTS_FALLBACK[0].id,
  );
  const [activeVault, setActiveVault] = useState(null);
  const [vaultStats, setVaultStats] = useState({});
  const [inSignal, setInSignal] = useState(false);
  const [signalState, setSignalState] = useState({ is_live: 0, title: null });
  const [isHandoff, setIsHandoff] = useState(false);
  const [handoffLabel, setHandoffLabel] = useState("");
  const handoffTimerRef = useRef(null);
  const prefersReduced = useReducedMotion();

  // Derive selectedVault from current vaults list
  const selectedVault =
    vaults.find((v) => v.id === selectedVaultId) ?? vaults[0];

  const fetchSignal = useCallback(async () => {
    try {
      const res = await fetch(`${WORKER_URL}/signal`);
      if (res.ok) setSignalState(await res.json());
    } catch (_) {}
  }, []);

  // Fetch published vaults from worker — replaces fallback when ready
  useEffect(() => {
    fetch(`${WORKER_URL}/vaults`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || data.length === 0) return;
        const normalized = data.map((v) => ({
          id: v.vault_id,
          label: v.label,
          color: v.color ?? null,
          copy: v.copy ?? "",
        }));
        setVaults(normalized);
        setSelectedVaultId(normalized[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedVaultId) return;
    fetchPublishedVaultTracks(selectedVaultId)
      .then((tracks) => {
        const totalDuration = tracks.reduce(
          (sum, t) => sum + (Number(t.duration) || 0),
          0,
        );
        setVaultStats((prev) => ({
          ...prev,
          [selectedVaultId]: { totalDuration, count: tracks.length },
        }));
      })
      .catch(() => {});
  }, [selectedVaultId]);

  useEffect(() => {
    if (code && !codeSession) return;
    fetchSignal();
    const poll = setInterval(fetchSignal, SIGNAL_POLL_MS);
    return () => clearInterval(poll);
  }, [fetchSignal, code, codeSession]);

  useEffect(() => () => window.clearTimeout(handoffTimerRef.current), []);

  // Show welcome interstitial when code guest is validated
  useEffect(() => {
    if (!codeSession) return;
    setShowWelcome(true);
    const t = window.setTimeout(() => setShowWelcome(false), 2500);
    return () => window.clearTimeout(t);
  }, [codeSession]);

  useEffect(() => {
    if (code || !isRevalidating || !codeSession?.code) return;
    let active = true;
    redeemCode(codeSession.code)
      .then((data) => {
        if (!active) return;
        setCodeSession(saveGuestSession(data, codeSession.code));
      })
      .catch((err) => {
        if (!active) return;
        if ([404, 409, 410].includes(err.status)) {
          clearPersistedSession();
          setCodeSession(null);
        }
      })
      .finally(() => {
        if (active) setIsRevalidating(false);
      });
    return () => {
      active = false;
    };
  }, [code, codeSession?.code, isRevalidating]);

  const handleGranted = useCallback(
    (data) => {
      const session = saveGuestSession(data, code);
      setCodeSession(session);
    },
    [code],
  );

  // ── CODE GATE — all hooks above, conditional return is safe here ───────────
  if (code && !codeSession) {
    return <CodeGate code={code} onGranted={handleGranted} />;
  }

  if (isRevalidating) {
    return (
      <div className="code-gate" aria-live="polite">
        <DPWallpaper opacity={1} />
        <div className="code-gate-identity-glow" aria-hidden="true" />
        <span className="code-gate-status">VERIFYING</span>
      </div>
    );
  }

  const openVault = (vault) => {
    const delay = prefersReduced ? 0 : 220;
    setHandoffLabel(vault.label);
    setIsHandoff(delay > 0);
    window.clearTimeout(handoffTimerRef.current);
    handoffTimerRef.current = window.setTimeout(() => {
      setActiveVault(vault.id);
      setIsHandoff(false);
    }, delay);
  };

  const handleVaultBack = () => {
    setActiveVault(null);
  };

  const handoffOverlay = (
    <AnimatePresence>
      {isHandoff && (
        <motion.div
          className="listener-handoff"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          aria-hidden="true"
        >
          <motion.span
            className="listener-handoff-kicker"
            initial={{ opacity: 0 }}
            animate={{ opacity: 0.5 }}
            transition={{ duration: 0.15, delay: 0.04 }}
          >
            OPENING
          </motion.span>
          <motion.span
            className="listener-handoff-label"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.1, ease: [0.25, 1, 0.5, 1] }}
          >
            {handoffLabel}
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // ── SIGNAL ROOM ──────────────────────────────────────────────────
  if (inSignal) {
    return (
      <TheSignal
        signalTitle={signalState.title}
        onBack={() => setInSignal(false)}
        sessionMeta={sessionMeta}
      />
    );
  }

  // ── VAULT INTERIOR ───────────────────────────────────────────────
  if (activeVault) {
    const activeVaultObj = vaults.find((v) => v.id === activeVault);
    return (
      <ListenerVaultView
        key={activeVault}
        vault={activeVault}
        vaultColor={activeVaultObj?.color || null}
        vaultLabel={activeVaultObj?.label || null}
        onBack={handleVaultBack}
        onExitSystem={onPowerDown}
      />
    );
  }

  // ── MAIN SHELL ───────────────────────────────────────────────────
  const shellStyle = selectedVault?.color
    ? { "--vault-color": selectedVault.color }
    : undefined;

  return (
    <div className="listener-shell" style={shellStyle}>
      <DPWallpaper opacity={0.35} />
      <PSCWordmark />

      <header className="listener-header">
        <div className="listener-header-id" aria-hidden="true">
          <span className="listener-header-kicker">LISTENING ROOM</span>
          <span className="listener-header-owner">CURATED BY D</span>
          {codeSession?.grantedTo && (
            <span className="listener-header-guest">
              {codeSession.grantedTo}
            </span>
          )}
        </div>
        <div className="listener-header-actions">
          {onGodModeMobile && (
            <button
              className="listener-exit"
              onClick={onGodModeMobile}
              aria-label="Go to access codes"
            >
              CODES
            </button>
          )}
          <button
            className="listener-exit"
            onClick={
              code
                ? () => {
                    window.history.back();
                    window.close();
                  }
                : onPowerDown
            }
            aria-label={code ? "Close" : "Exit system"}
          >
            {code ? "CLOSE" : "EXIT"}
          </button>
        </div>
      </header>

      <AnimatePresence>
        {signalState.is_live === 1 && (
          <motion.button
            className="listener-signal-banner"
            onClick={() => setInSignal(true)}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.28 }}
            aria-label="Enter The Signal — D is live"
          >
            <span className="listener-signal-dot" aria-hidden="true" />
            <span className="listener-signal-text">
              {signalState.title || "THE SIGNAL"}
            </span>
            <span className="listener-signal-live">D IS LIVE</span>
            <span className="listener-signal-enter" aria-hidden="true">
              ENTER →
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      <main
        className="listener-stage"
        id="main-content"
        onClick={selectedVault ? () => openVault(selectedVault) : undefined}
        onKeyDown={
          selectedVault
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openVault(selectedVault);
                }
              }
            : undefined
        }
        role={selectedVault ? "button" : undefined}
        tabIndex={selectedVault ? 0 : undefined}
        style={selectedVault ? { cursor: "pointer" } : undefined}
        aria-label={selectedVault ? `Open ${selectedVault.label}` : undefined}
      >
        {selectedVault ? (
          <AnimatePresence mode="wait">
            <motion.div
              key={selectedVault.id}
              className="listener-stage-content"
              initial={prefersReduced ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.3, ease: [0.25, 0, 0, 1] }}
            >
              <p className="ls-duration-hero">
                {formatDurationHero(vaultStats[selectedVaultId]?.totalDuration)}
              </p>
              <p className="ls-duration-subtitle">
                {selectedVault.label} ·{" "}
                {vaultStats[selectedVaultId]?.count ?? "--"} SESSIONS
              </p>
              <p className="ls-duration-meta">
                {selectedVault.copy.split(" · ").map((phrase, i, arr) => (
                  <span key={i}>
                    {phrase}
                    {i < arr.length - 1 && <br />}
                  </span>
                ))}
              </p>
              <div className="listener-stage-rule" aria-hidden="true" />
              <p className="ls-touch-hint">TOUCH ANYWHERE TO ENTER</p>
            </motion.div>
          </AnimatePresence>
        ) : (
          <div className="listener-stage-empty" aria-live="polite" />
        )}
      </main>

      {vaults.length > 0 && (
        <nav className="listener-dock" aria-label="Vault navigation">
          {vaults.map((vault) => (
            <button
              key={vault.id}
              className={`listener-dock-btn${selectedVault?.id === vault.id ? " listener-dock-active" : ""}`}
              style={vault.color ? { "--vault-color": vault.color } : {}}
              onClick={() => {
                if (selectedVault?.id === vault.id) {
                  openVault(vault);
                } else {
                  setSelectedVaultId(vault.id);
                }
              }}
              aria-pressed={selectedVault?.id === vault.id}
            >
              <span className="listener-dock-pip" aria-hidden="true" />
              <span className="listener-dock-label">{vault.label}</span>
            </button>
          ))}
        </nav>
      )}

      {handoffOverlay}

      {/* Welcome interstitial — full-screen theatrical entry for code guests */}
      <AnimatePresence>
        {showWelcome && (
          <motion.div
            className="listener-welcome"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
            aria-live="polite"
          >
            <span className="listener-welcome-kicker">WELCOME</span>
            {codeSession?.grantedTo && (
              <span className="listener-welcome-name">
                {codeSession.grantedTo.toUpperCase()}
              </span>
            )}
            <span className="listener-welcome-sub">CURATED BY D</span>
            {codeSession?.code && (
              <>
                <span className="listener-welcome-save">SAVE THIS CODE</span>
                <span className="listener-welcome-code">
                  {codeSession.code}
                </span>
              </>
            )}
            <span className="listener-welcome-browse">
              BROWSE THE VAULTS BELOW
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ListenerShell;
