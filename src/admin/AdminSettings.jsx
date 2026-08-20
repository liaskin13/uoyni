import React, { useState } from "react";
import { LOCKBOX_CODES, VAULT_DISPLAY_NAMES } from "../config";
import PSCWordmark from "../components/PSCWordmark";
import { useValidationSummary, formatValidationSummary } from "../lib/useValidationSummary";
import "./AdminSettings.css";

const SECTIONS = [
  { id: "system",  label: "SYSTEM" },
  { id: "members", label: "MEMBERS" },
  { id: "lockbox", label: "LOCKBOX" },
];

function SectionSystem({ waveformDetail, setWaveformDetail, trackColorRows, setTrackColorRows, quantizeEnabled, handleQuantizeToggle, autoLoopDefault, setAutoLoopDefault, smartCrates, setSmartCrates, historyEnabled, setHistoryEnabled, consoleDefaultGenre, cycleConsoleDefaultGenre }) {
  const validationSummary = useValidationSummary(); // T13
  return (
    <div className="adm-section-body">
      <div className="adm-group">
        <div className="adm-group-label">DISPLAY</div>
        <div className="adm-row" title="HIGH renders the full-resolution waveform binary; LOW uses the lighter pre-rendered PNG">
          <span className="adm-row-label">Waveform Detail</span>
          <button
            className={`adm-toggle ${waveformDetail === "high" ? "active" : ""}`}
            onClick={() => setWaveformDetail(p => p === "high" ? "low" : "high")}
          >
            {waveformDetail.toUpperCase()}
          </button>
        </div>
        <div className="adm-row" title="Color-code track rows by vault (mixes/original music/live sets)">
          <span className="adm-row-label">Track Color Rows</span>
          <button
            className={`adm-toggle ${trackColorRows ? "active" : ""}`}
            onClick={() => setTrackColorRows(p => !p)}
          >
            {trackColorRows ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div className="adm-group">
        <div className="adm-group-label">PLAYBACK</div>
        <div className="adm-row" title="Snap hot-cue placement and beatgrid edits to the nearest beat">
          <span className="adm-row-label">Quantize Default</span>
          <button
            className={`adm-toggle ${quantizeEnabled ? "active" : ""}`}
            onClick={handleQuantizeToggle}
          >
            {quantizeEnabled ? "ON" : "OFF"}
          </button>
        </div>
        <div className="adm-row" title="Reserved for a future default loop size — not yet wired to a behavior">
          <span className="adm-row-label">Auto Loop Default</span>
          <button
            className={`adm-toggle ${autoLoopDefault ? "active" : ""}`}
            onClick={() => setAutoLoopDefault(p => !p)}
          >
            {autoLoopDefault ? "ON" : "OFF"}
          </button>
        </div>
      </div>

      <div className="adm-group">
        <div className="adm-group-label">VAULT</div>
        <div className="adm-row" title="Surfaces BPM/key-compatible tracks first in the library, relative to the loaded deck track. Same toggle as the SMART button in the track browser.">
          <span className="adm-row-label">Smart Crates</span>
          <button
            className={`adm-toggle ${smartCrates ? "active" : ""}`}
            onClick={() => setSmartCrates(p => !p)}
          >
            {smartCrates ? "ENABLED" : "DISABLED"}
          </button>
        </div>
        <div className="adm-row" title="Log played tracks to your recently-played history">
          <span className="adm-row-label">Track History</span>
          <button
            className={`adm-toggle ${historyEnabled ? "active" : ""}`}
            onClick={() => setHistoryEnabled(p => !p)}
          >
            {historyEnabled ? "ENABLED" : "DISABLED"}
          </button>
        </div>
      </div>

      <div className="adm-group">
        <div className="adm-group-label">BEAT DETECTION</div>
        <div className="adm-row" title="Applied to tracks with no per-track genre override yet (double-click the DYNAMIC/genre badge on a loaded track to set one)">
          <span className="adm-row-label">Default Tempo Genre</span>
          <button className="adm-toggle" onClick={cycleConsoleDefaultGenre}>
            {consoleDefaultGenre}
          </button>
        </div>
        <div className="adm-row">
          <span className="adm-row-label">Validation Suite</span>
          <span className="adm-row-value">{formatValidationSummary(validationSummary)}</span>
        </div>
      </div>
    </div>
  );
}

function SectionMembers({ members }) {
  const [reveal, setReveal] = useState(null);

  return (
    <div className="adm-section-body">
      <div className="adm-group">
        <div className="adm-group-label">{members.length} REGISTERED</div>
        {members.length === 0 ? (
          <div className="adm-empty">— NO MEMBERS —</div>
        ) : (
          <table className="adm-table">
            <thead>
              <tr>
                <th>TIER</th>
                <th>HANDLE</th>
                <th>VAULT</th>
                <th>CODE</th>
                <th>JOINED</th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id}>
                  <td className="adm-cell-mono">{m.tier}</td>
                  <td>{m.name}</td>
                  <td className="adm-cell-muted">
                    {VAULT_DISPLAY_NAMES[m.planet] || m.planet || "—"}
                  </td>
                  <td
                    className="adm-cell-code"
                    tabIndex={0}
                    role="button"
                    aria-label={`Access code for ${m.name}`}
                    onMouseEnter={() => setReveal(m.id)}
                    onMouseLeave={() => setReveal(null)}
                    onFocus={() => setReveal(m.id)}
                    onBlur={() => setReveal(null)}
                    onKeyDown={e => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setReveal(p => p === m.id ? null : m.id);
                      }
                      if (e.key === "Escape") setReveal(null);
                    }}
                  >
                    {reveal === m.id ? m.code : "••••"}
                  </td>
                  <td className="adm-cell-muted">
                    {new Date(m.createdAt).toLocaleDateString("en-US", {
                      month: "short", day: "numeric", year: "2-digit"
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function SectionLockbox() {
  const [reveal, setReveal] = useState(null);
  const entries = Object.entries(LOCKBOX_CODES);

  return (
    <div className="adm-section-body">
      <div className="adm-group">
        <div className="adm-group-label">MUSE ACCESS CODES</div>
        <p className="adm-group-note">
          Transmit each code to the corresponding Muse directly. Do not publish.
        </p>
        <table className="adm-table">
          <thead>
            <tr>
              <th>MUSE</th>
              <th>LOCKBOX</th>
              <th>CODE</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, code]) => {
              const handle = key.replace("lockbox_", "").toUpperCase();
              return (
                <tr key={key}>
                  <td>{handle}</td>
                  <td className="adm-cell-muted">{key}</td>
                  <td
                    className="adm-cell-code"
                    tabIndex={0}
                    role="button"
                    aria-label={`Lockbox code for ${handle}`}
                    onMouseEnter={() => setReveal(key)}
                    onMouseLeave={() => setReveal(null)}
                    onFocus={() => setReveal(key)}
                    onBlur={() => setReveal(null)}
                    onKeyDown={e => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setReveal(p => p === key ? null : key);
                      }
                      if (e.key === "Escape") setReveal(null);
                    }}
                  >
                    {reveal === key ? code : "••••"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AdminSettings({ onClose, members, waveformDetail, setWaveformDetail, trackColorRows, setTrackColorRows, quantizeEnabled, handleQuantizeToggle, autoLoopDefault, setAutoLoopDefault, smartCrates, setSmartCrates, historyEnabled, setHistoryEnabled, consoleDefaultGenre, cycleConsoleDefaultGenre }) {
  const [active, setActive] = useState("system");

  return (
    <div className="adm-overlay" role="dialog" aria-label="Architect admin settings">
      <PSCWordmark />
      <div className="adm-shell">

        <nav className="adm-nav" aria-label="Settings sections">
          <div className="adm-nav-wordmark">ARCHITECT · SYSTEM</div>
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`adm-nav-item ${active === s.id ? "active" : ""}`}
              onClick={() => setActive(s.id)}
            >
              {s.label}
              {active === s.id && <span className="adm-nav-pip" aria-hidden="true" />}
            </button>
          ))}
          <button className="adm-nav-close" onClick={onClose} aria-label="Close admin settings">
            CLOSE
          </button>
        </nav>

        <main className="adm-content">
          <header className="adm-content-header">
            <span className="adm-content-title">
              {SECTIONS.find(s => s.id === active)?.label}
            </span>
          </header>

          {active === "system" && (
            <SectionSystem
              waveformDetail={waveformDetail}
              setWaveformDetail={setWaveformDetail}
              trackColorRows={trackColorRows}
              setTrackColorRows={setTrackColorRows}
              quantizeEnabled={quantizeEnabled}
              handleQuantizeToggle={handleQuantizeToggle}
              autoLoopDefault={autoLoopDefault}
              setAutoLoopDefault={setAutoLoopDefault}
              smartCrates={smartCrates}
              setSmartCrates={setSmartCrates}
              historyEnabled={historyEnabled}
              setHistoryEnabled={setHistoryEnabled}
              consoleDefaultGenre={consoleDefaultGenre}
              cycleConsoleDefaultGenre={cycleConsoleDefaultGenre}
            />
          )}
          {active === "members" && <SectionMembers members={members} />}
          {active === "lockbox" && <SectionLockbox />}
        </main>

      </div>
    </div>
  );
}
