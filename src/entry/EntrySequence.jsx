import React, { useState, useEffect, useRef, useCallback } from "react";
import { findResidentByCode } from "../data/residentBlueprint";
import { redeemCode } from "../lib/accessCodes";
import {
  SESSION_KEY,
  SESSION_TTL_MS,
  GATE_LOCK_KEY,
  GATE_MAX_ATTEMPTS,
  GATE_LOCKOUT_MS,
} from "../config";
import DPWallpaper from "../components/DPWallpaper";

function readLock() {
  try {
    return (
      JSON.parse(localStorage.getItem(GATE_LOCK_KEY)) || {
        count: 0,
        lockedUntil: 0,
      }
    );
  } catch (_) {
    return { count: 0, lockedUntil: 0 };
  }
}
function writeLock(lock) {
  try {
    localStorage.setItem(GATE_LOCK_KEY, JSON.stringify(lock));
  } catch (_) {}
}
function clearLock() {
  try {
    localStorage.removeItem(GATE_LOCK_KEY);
  } catch (_) {}
}

const LEN = 4;

function EntrySequence({ onIgnite }) {
  const [digits, setDigits] = useState("");
  const [cellState, setCellState] = useState("idle"); // idle | correct | wrong
  const [errMsg, setErrMsg] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);
  const [lockoutRemaining, setLockoutRemaining] = useState(0);
  const [isVerifying, setIsVerifying] = useState(false);
  const curBallRef = useRef(null);
  const curRingRef = useRef(null);

  // Custom cursor
  useEffect(() => {
    const move = (e) => {
      if (curBallRef.current) {
        curBallRef.current.style.left = e.clientX + "px";
        curBallRef.current.style.top = e.clientY + "px";
      }
      if (curRingRef.current) {
        curRingRef.current.style.left = e.clientX + "px";
        curRingRef.current.style.top = e.clientY + "px";
      }
    };
    window.addEventListener("mousemove", move);
    return () => window.removeEventListener("mousemove", move);
  }, []);

  // Lockout countdown
  useEffect(() => {
    if (lockoutRemaining <= 0) return;
    const id = setInterval(() => {
      setLockoutRemaining((prev) => Math.max(0, prev - 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [lockoutRemaining]);

  const attempt = useCallback(
    async (code) => {
      const lock = readLock();
      if (lock.lockedUntil > Date.now()) {
        setDigits("");
        setLockoutRemaining(lock.lockedUntil - Date.now());
        return;
      }

      // 1. Resident blueprint check (D, L — synchronous)
      const res = findResidentByCode(code);
      if (res) {
        clearLock();
        setCellState("correct");
        setUnlocked(true);
        const session = {
          owner: res.name,
          vault: res.vaultId,
          tier: res.tier,
          residentId: res.residentId,
          expires: Date.now() + SESSION_TTL_MS,
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        setTimeout(() => setGateOpen(true), 300);
        setTimeout(() => onIgnite(res.name, res.tier), 1600);
        return;
      }

      // 2. /redeem fallback — guest access codes
      setIsVerifying(true);
      try {
        const data = await redeemCode(code);
        const session = {
          ...data,
          code,
          savedAt: Date.now(),
          expires: Date.now() + SESSION_TTL_MS,
        };
        try {
          localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } catch (_) {}
        clearLock();
        setIsVerifying(false);
        setCellState("correct");
        setUnlocked(true);
        setTimeout(() => setGateOpen(true), 300);
        setTimeout(() => onIgnite(null, data.tier), 1600);
      } catch (err) {
        setIsVerifying(false);
        const newCount = lock.count + 1;
        const newLock =
          newCount >= GATE_MAX_ATTEMPTS
            ? { count: 0, lockedUntil: Date.now() + GATE_LOCKOUT_MS }
            : { count: newCount, lockedUntil: 0 };
        writeLock(newLock);
        if (newLock.lockedUntil) setLockoutRemaining(GATE_LOCKOUT_MS);
        setCellState("wrong");
        setErrMsg(
          err.status === 410
            ? "CODE EXPIRED"
            : err.status === 409
              ? "ALREADY CLAIMED"
              : "ACCESS DENIED",
        );
        setTimeout(() => {
          setDigits("");
          setCellState("idle");
          setErrMsg("");
        }, 900);
      }
    },
    [onIgnite],
  );

  useEffect(() => {
    const onKey = (e) => {
      if (unlocked || isVerifying) return;
      if (e.key === "Backspace") {
        setDigits((prev) => prev.slice(0, -1));
        setCellState("idle");
        setErrMsg("");
      } else if (e.key === "Enter" && digits.length === LEN) {
        attempt(digits);
      } else if (digits.length < LEN && /[0-9]/.test(e.key)) {
        const next = digits + e.key;
        setDigits(next);
        if (next.length === LEN) setTimeout(() => attempt(next), 120);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [digits, unlocked, isVerifying, attempt]);

  const cells = Array.from({ length: LEN }, (_, i) => {
    let cls = "entry-cell";
    if (cellState === "correct") cls += " entry-cell-correct";
    else if (cellState === "wrong") cls += " entry-cell-wrong";
    else if (i === digits.length) cls += " entry-cell-active";
    return (
      <div key={i} className={cls}>
        {digits[i] || ""}
      </div>
    );
  });

  return (
    <div className="entry-aperture" style={{ cursor: "none" }}>
      <DPWallpaper opacity={unlocked ? 0 : 1} />

      {/* Gate panels — left/right split */}
      <div
        className={`entry-gate entry-gate-l${gateOpen ? " entry-gate-open" : ""}`}
      />
      <div
        className={`entry-gate entry-gate-r${gateOpen ? " entry-gate-open" : ""}`}
      />

      {/* Wordmark — top-left, locked forever */}
      <div className="entry-wordmark" aria-label="UOYnI">
        UOYnI
      </div>

      {/* Center — request access */}
      <div className="entry-center-form">
        <label className="entry-sr-only" htmlFor="entry-request-contact">
          Phone Or Email
        </label>
        <input
          id="entry-request-contact"
          className="entry-request-input"
          type="text"
          placeholder="PHONE OR EMAIL"
          aria-label="Phone or email"
          autoComplete="off"
          spellCheck="false"
        />
        <button type="button" className="entry-request-btn">
          REQUEST ACCESS
        </button>
        <p className="entry-request-hint">By invitation only.</p>
      </div>

      {/* Bottom-right — mystery code cells */}
      <div
        className="entry-code-corner"
        role="group"
        aria-label="Access code entry"
      >
        <p className="entry-code-hint">ENTER CODE</p>
        <div className="entry-cells">{cells}</div>
        <div className="entry-err" aria-live="polite">
          {lockoutRemaining > 0
            ? `LOCKED ${Math.ceil(lockoutRemaining / 1000)}s`
            : isVerifying
              ? "VERIFYING"
              : errMsg}
        </div>
      </div>

      {/* Custom cursor */}
      <div className="cur-ring" ref={curRingRef} aria-hidden="true" />
      <div className="cur-ball" ref={curBallRef} aria-hidden="true" />
    </div>
  );
}

export default EntrySequence;
