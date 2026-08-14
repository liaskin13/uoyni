import React, { useState, useEffect, lazy, Suspense } from "react";
import { motion, useReducedMotion } from "framer-motion";
import "./App.css";

import { useSystem } from "./state/SystemContext";
import { SESSION_KEY, VAULT_IDS } from "./config";
import { useNetworkStatus } from "./hooks/useNetworkStatus";
import { useBreakpoint } from "./hooks/useBreakpoint";
import { useDragDropBatch } from "./hooks/useDragDropBatch";

// ── STATIC IMPORTS ───────────────────────────────────────────────────────────
import EntrySequence from "./entry/EntrySequence";
import CommandPalette from "./components/CommandPalette";

// ── LAZY IMPORTS ─────────────────────────────────────────────────────────────
const ArchitectConsole = lazy(() => import("./console/ArchitectConsole"));
const ListenerShell = lazy(() => import("./listener/ListenerShell"));
const GodModeMobile = lazy(() => import("./console/GodModeMobile"));
const WaveformSandbox = lazy(() => import("./components/WaveformSandbox"));

const UploadModal = lazy(() => import("./components/UploadModal"));

import BottomNav from "./components/BottomNav";

import { BROADCAST_DURATION_MS } from "./config";

function refreshSessionMeta() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s || Date.now() > s.expires) return null;
    return {
      owner: s.owner,
      vault: s.vault ?? s.planet ?? null,
      tier: s.tier ?? "G",
      residentId: s.residentId ?? null,
    };
  } catch (_) {
    return null;
  }
}

// Stages: 'entry' | 'console' | 'architect' | 'room' | 'code-entry'
function App() {
  const { setConsoleOwner, consoleOwner, sessionMeta, setSessionMeta } =
    useSystem();
  const online = useNetworkStatus();
  const { isMobile } = useBreakpoint();
  const prefersReduced = useReducedMotion();

  const pendingCode = new URLSearchParams(window.location.search).get("code");
  const [stage, setStage] = useState(pendingCode ? "code-entry" : "entry");
  const [accessCode] = useState(pendingCode);
  const [owner, setOwner] = useState(null);
  const [activeNode, setActiveNode] = useState(null);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadVault, setUploadVault] = useState(null);
  const batchUpload = useDragDropBatch(uploadVault ?? sessionMeta?.vault ?? "saturn");

  // Apply identity theme to <body> based on authenticated owner
  useEffect(() => {
    const themeMap = { D: "d-soul", L: "l-architect" };
    const theme = owner ? (themeMap[owner] ?? null) : null;
    if (theme) {
      document.body.setAttribute("data-theme", theme);
    } else {
      document.body.removeAttribute("data-theme");
    }
  }, [owner]);

  // Auto-login: skip entry gate if a valid session exists
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return;
      const session = JSON.parse(raw);
      if (session?.owner && session.expires > Date.now()) {
        handleIgnite(session.owner, session.tier);
      }
    } catch (_) {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isMobile && (stage === "console" || stage === "architect")) {
      setStage("room");
    }
    // Mirror image: GOD MODE MOBILE only makes sense on mobile — if the
    // viewport grows past the mobile breakpoint mid-session (external
    // monitor, tablet rotation), fall back to the real desktop console
    // rather than leaving a phone-only screen stranded on a desktop viewport.
    if (!isMobile && stage === "godmode-mobile") {
      setStage(consoleOwner === "L" ? "architect" : "console");
    }
  }, [isMobile, stage, consoleOwner]);

  useEffect(() => {
    const handleOpenUploadModal = () => setShowUploadModal(true);
    window.addEventListener("psc:open-upload-modal", handleOpenUploadModal);
    return () =>
      window.removeEventListener(
        "psc:open-upload-modal",
        handleOpenUploadModal,
      );
  }, []);

  const handleIgnite = (ownerVal, tier = "G") => {
    const meta = refreshSessionMeta();
    setOwner(ownerVal);
    setConsoleOwner(ownerVal);
    setSessionMeta(meta);
    // Wipe the batch queue synchronously, in the same handler that flips
    // consoleOwner — not in a useEffect keyed on it. A dependency-array
    // effect runs after commit/paint (that's the documented difference from
    // useLayoutEffect), which left a real, if sub-frame, window where React
    // could paint the new owner's console with the previous owner's queued
    // filenames still in it. Resetting here means the queue-wiped state is
    // part of the very same batched update as the identity change — there is
    // no separate render for a stale frame to exist in. Flagged by
    // /security-review during the eng-review pass on this fix; see TODOS.md
    // history / decision log for the full writeup.
    batchUpload.reset();
    setUploadVault(null);

    // Tier-based routing — Masters on desktop get their full console; on mobile
    // they get GOD MODE MOBILE (access-code quick-grant only, not the console
    // made responsive — see DESIGN.md's named exception, 2026-08-14)
    if (tier === "A" && !isMobile) {
      if (ownerVal === "L") setStage("architect");
      else setStage("console");
    } else if (tier === "A" && isMobile) {
      setStage("godmode-mobile");
    } else {
      setStage("room");
      // Auto-focus vault if assigned
      if (meta?.vault) setActiveNode({ id: meta.vault });
    }
  };

  const handlePowerDown = () => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (_) {}
    setSessionMeta(null);
    setStage("entry");
  };

  const handleBroadcast = () => {
    setIsBroadcasting(true);
    setTimeout(() => setIsBroadcasting(false), BROADCAST_DURATION_MS);
  };

  const handleArchitectExplore = (planetRef) => {
    const planetId = typeof planetRef === "string" ? planetRef : planetRef?.id;
    if (!planetId) return;
    setActiveNode({ id: planetId });
  };

  const offlineBanner = !online && (
    <div className="offline-banner" role="status">
      SIGNAL LOST — ARCHIVE CACHED LOCALLY
    </div>
  );

  // ── SANDBOX — dev-only waveform engine prototype ─────────────────────────
  if (new URLSearchParams(window.location.search).has("sandbox")) {
    return <Suspense fallback={null}><WaveformSandbox /></Suspense>;
  }

  // ── CODE ENTRY — listener arriving via access code link ─────────────────
  if (stage === "code-entry") {
    return (
      <Suspense fallback={null}>
        <ListenerShell code={accessCode} />
      </Suspense>
    );
  }

  // ── ENTRY ────────────────────────────────────────────────────────────────
  if (stage === "entry") {
    return (
      <>
        {offlineBanner}
        <a href="#main-content" className="skip-nav">
          Skip to archive
        </a>
        <main id="main-content">
          <EntrySequence onIgnite={handleIgnite} />
        </main>
      </>
    );
  }

  // ── LISTENER SHELL — guest / member listening room ───────────────────────
  if (stage === "room" && !activeNode) {
    return (
      <Suspense fallback={null}>
        <ListenerShell
          onPowerDown={handlePowerDown}
          sessionMeta={sessionMeta}
        />
      </Suspense>
    );
  }

  // ── CONSOLE MOBILE GUARD — safety net, routing handles this at login ─────
  if (isMobile && (stage === "console" || stage === "architect")) {
    return null;
  }
  // ── GOD MODE MOBILE GUARD — mirror image, safety net for the reverse case ─
  if (!isMobile && stage === "godmode-mobile") {
    return null;
  }

  // ── GOD MODE MOBILE — D/L access-code quick-grant, phone-only ────────────
  if (stage === "godmode-mobile") {
    return (
      <>
        {offlineBanner}
        <Suspense fallback={null}>
          <GodModeMobile owner={owner} onPowerDown={handlePowerDown} />
        </Suspense>
      </>
    );
  }

  // ── L's CONSOLE — GOD MODE PLUS (sovereign root) ──────────────────────────
  if (stage === "architect") {
    return (
      <>
        {offlineBanner}
        <a href="#main-content" className="skip-nav">
          Skip to archive
        </a>
        <div
          className="universe god-mode-mainframe state-create"
          id="main-content"
        >
          <CommandPalette />
          <div className="glitter-grain" />
          {isBroadcasting && (
            <div className="system-broadcast-pulse" aria-live="polite">
              SYSTEM BROADCAST ACTIVE
            </div>
          )}
          <Suspense fallback={null}>
            <ArchitectConsole
              onPowerDown={handlePowerDown}
              onExplorePlanet={handleArchitectExplore}
              onBroadcast={handleBroadcast}
              onIntake={() => setShowUploadModal(true)}
              batchQueue={batchUpload.queue}
              onBatchRetry={batchUpload.retry}
              onBatchDismiss={batchUpload.dismiss}
            />
          </Suspense>
          {showUploadModal && (
            <Suspense fallback={null}>
              <UploadModal
                onClose={() => setShowUploadModal(false)}
                vault={
                  uploadVault ??
                  (VAULT_IDS.includes(sessionMeta?.vault)
                    ? sessionMeta.vault
                    : "saturn")
                }
                setVault={setUploadVault}
                queue={batchUpload.queue}
                addFiles={batchUpload.addFiles}
                retry={batchUpload.retry}
                dismiss={batchUpload.dismiss}
                duplicateCount={batchUpload.duplicateCount}
                isDraggingOver={batchUpload.isDraggingOver}
                onDragEnter={batchUpload.onDragEnter}
                onDragOver={batchUpload.onDragOver}
                onDragLeave={batchUpload.onDragLeave}
                onDrop={batchUpload.onDrop}
              />
            </Suspense>
          )}
          <div className="psc-wordmark-footer" aria-hidden="true">
            UOYnI
          </div>
        </div>
      </>
    );
  }

  // ── D's CONSOLE — ARTIST VIEW ──────────────────────────────────────────────
  return (
    <>
      {offlineBanner}
      <a href="#main-content" className="skip-nav">
        Skip to archive
      </a>
      <div className="universe god-mode-mainframe state-create">
        <CommandPalette />
        <div className="glitter-grain" />
        <div className="receded-logo">dp</div>
        <div className="psc-wordmark-footer" aria-hidden="true">
          UOYnI
        </div>
        {isBroadcasting && (
          <div className="system-broadcast-pulse" aria-live="polite">
            SYSTEM BROADCAST ACTIVE
          </div>
        )}

        <motion.div
          id="main-content"
          className="cockpit"
          initial={
            prefersReduced ? { opacity: 1 } : { opacity: 0, scale: 1.04 }
          }
          animate={{ opacity: 1, scale: 1 }}
          transition={
            prefersReduced
              ? { duration: 0.15 }
              : { duration: 1.6, ease: [0.08, 0, 0.3, 1] }
          }
        >
          <Suspense fallback={null}>
            <ArchitectConsole
              viewer="D"
              onExplorePlanet={handleArchitectExplore}
              onBroadcast={handleBroadcast}
              onIntake={() => setShowUploadModal(true)}
              onPowerDown={handlePowerDown}
              batchQueue={batchUpload.queue}
              onBatchRetry={batchUpload.retry}
              onBatchDismiss={batchUpload.dismiss}
            />
          </Suspense>
        </motion.div>

        {showUploadModal && (
          <Suspense fallback={null}>
            <UploadModal
              onClose={() => setShowUploadModal(false)}
              vault={
                uploadVault ??
                (VAULT_IDS.includes(sessionMeta?.vault)
                  ? sessionMeta.vault
                  : "venus")
              }
              setVault={setUploadVault}
              queue={batchUpload.queue}
              addFiles={batchUpload.addFiles}
              retry={batchUpload.retry}
              dismiss={batchUpload.dismiss}
              duplicateCount={batchUpload.duplicateCount}
              isDraggingOver={batchUpload.isDraggingOver}
              onDragEnter={batchUpload.onDragEnter}
              onDragOver={batchUpload.onDragOver}
              onDragLeave={batchUpload.onDragLeave}
              onDrop={batchUpload.onDrop}
            />
          </Suspense>
        )}

        {isMobile && (
          <BottomNav
            activeId={activeNode?.id}
            onSelect={(id) => setActiveNode({ id })}
          />
        )}
      </div>
    </>
  );
}

export default App;
