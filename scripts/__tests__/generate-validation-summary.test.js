import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// T13 — generate-validation-summary.js self-executes on import (it calls
// main() at module load, per its own design — see the script's header),
// so it can't be imported and unit-tested like a normal module without
// side-effecting the real public/validationSummary.json. Run it as a real
// subprocess instead, matching exactly how npm run build invokes it and
// how this was manually verified during /qa (forcing a failure by lowering
// DRIFT_THRESHOLD_PCT and confirming exit code 1).

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(__dirname, "../generate-validation-summary.js");
const outPath = resolve(__dirname, "../../public/validationSummary.json");
// Must live in the same directory as the real script (scripts/), not here
// in scripts/__tests__/ — the script resolves its own output path via
// `resolve(__dirname, "../public/validationSummary.json")`, so running a
// copy from a different directory would silently write (or fail to write)
// to the wrong location and this test would read stale data instead.
const failingScriptPath = resolve(__dirname, "../__generate-validation-summary-forced-fail.tmp.js");

// The second test below deliberately forces a failing run, which overwrites
// the REAL public/validationSummary.json with fabricated failing data
// before exiting — that's the artifact npm run dev/build serves. Without
// restoring it, a local `npm test` run leaves the app showing a false
// "genres failing" state until the next real build. Found by /ship's
// testing specialist, 2026-08-15.
let originalOutContent;

beforeAll(() => {
  originalOutContent = existsSync(outPath) ? readFileSync(outPath, "utf8") : null;
});

afterEach(() => {
  if (existsSync(failingScriptPath)) unlinkSync(failingScriptPath);
});

afterAll(() => {
  if (originalOutContent != null) writeFileSync(outPath, originalOutContent);
});

describe("generate-validation-summary.js (subprocess)", () => {
  it("exits 0 and writes a well-formed summary with the real detector (all genres passing)", () => {
    execFileSync("node", [scriptPath], { encoding: "utf8" }); // throws on non-zero exit
    const summary = JSON.parse(readFileSync(outPath, "utf8"));
    expect(summary.allPassing).toBe(true);
    expect(summary.totalGenres).toBe(5);
    expect(summary.genresValidated).toBe(5);
    expect(summary.toleranceMs).toBe(70);
    expect(Array.isArray(summary.perGenre)).toBe(true);
    expect(summary.perGenre).toHaveLength(5);
    for (const g of summary.perGenre) {
      expect(typeof g.genre).toBe("string");
      expect(typeof g.passed).toBe("boolean");
    }
  });

  it("exits non-zero and does not silently claim success when the validation suite fails", () => {
    // A temp copy with an unreachable threshold — not touching the real
    // script — forces every genre to fail on the BPM-accuracy check.
    const src = readFileSync(scriptPath, "utf8");
    const forced = src.replace(
      "const DRIFT_THRESHOLD_PCT = 4;",
      "const DRIFT_THRESHOLD_PCT = 0.00001;",
    );
    expect(forced).not.toBe(src); // sanity: the replace actually matched something
    writeFileSync(failingScriptPath, forced);

    let threw = false;
    let status = 0;
    try {
      execFileSync("node", [failingScriptPath], { encoding: "utf8", stdio: "pipe" });
    } catch (err) {
      threw = true;
      status = err.status;
    }
    expect(threw).toBe(true);
    expect(status).toBe(1);

    // The artifact on disk (still written before the exit) must honestly
    // report the failure, not a stale/fabricated success.
    const summary = JSON.parse(readFileSync(outPath, "utf8"));
    expect(summary.allPassing).toBe(false);
    expect(summary.genresValidated).toBeLessThan(summary.totalGenres);
  });
});
