// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

vi.mock("../DirectLinePanel.jsx", () => ({
  default: () => null,
}));

import ContextStrip from "../ContextStrip";

function renderStrip(props = {}) {
  return render(React.createElement(ContextStrip, props));
}

afterEach(() => {
  cleanup();
});

describe("COMMS LCD — idle / searching", () => {
  it("shows the COMMS label and a search input when there is no status", () => {
    renderStrip();
    expect(screen.getByText("COMMS")).toBeTruthy();
    expect(screen.getByPlaceholderText("SEARCH · OR TYPE HELP")).toBeTruthy();
  });

  it("calls onSearchChange as the user types", () => {
    const onSearchChange = vi.fn();
    renderStrip({ onSearchChange });
    fireEvent.change(screen.getByPlaceholderText("SEARCH · OR TYPE HELP"), {
      target: { value: "eightysixty" },
    });
    expect(onSearchChange).toHaveBeenCalledWith("eightysixty");
  });

  it("shows a match count next to the query when searching", () => {
    renderStrip({ libSearch: "eighty", matchCount: 3 });
    expect(screen.getByText("3 MATCHES")).toBeTruthy();
  });

  it("uses singular MATCH for exactly one result", () => {
    renderStrip({ libSearch: "eighty", matchCount: 1 });
    expect(screen.getByText("1 MATCH")).toBeTruthy();
  });

  it("does not show a match count with an empty query", () => {
    renderStrip({ libSearch: "", matchCount: null });
    expect(screen.queryByText(/MATCH/)).toBeNull();
  });

  it("clear button resets the search", () => {
    const onSearchChange = vi.fn();
    renderStrip({ libSearch: "eighty", onSearchChange });
    fireEvent.click(screen.getByLabelText("Clear search"));
    expect(onSearchChange).toHaveBeenCalledWith("");
  });
});

describe("COMMS LCD — system status overlay", () => {
  it("shows the status message instead of the search input when systemStatus is set", () => {
    renderStrip({
      libSearch: "eighty",
      systemStatus: { message: "2 tracks moved → ORIGINAL MUSIC.", kind: "success" },
    });
    expect(screen.getByText("2 tracks moved → ORIGINAL MUSIC.")).toBeTruthy();
    expect(screen.queryByPlaceholderText("SEARCH · OR TYPE HELP")).toBeNull();
  });

  it("applies the error status class for kind: error", () => {
    const { container } = renderStrip({
      systemStatus: { message: "Move failed — HTTP 500", kind: "error" },
    });
    expect(container.querySelector(".arch-comms-lcd.status-error")).toBeTruthy();
  });

  it("applies the success status class for kind: success", () => {
    const { container } = renderStrip({
      systemStatus: { message: "Saved.", kind: "success" },
    });
    expect(container.querySelector(".arch-comms-lcd.status-success")).toBeTruthy();
  });

  it("reverts to showing search (with the same query preserved) once systemStatus clears", () => {
    const { rerender } = renderStrip({
      libSearch: "eighty",
      systemStatus: { message: "Saved.", kind: "success" },
    });
    expect(screen.queryByPlaceholderText("SEARCH · OR TYPE HELP")).toBeNull();

    rerender(
      React.createElement(ContextStrip, { libSearch: "eighty", systemStatus: null }),
    );

    const input = screen.getByPlaceholderText("SEARCH · OR TYPE HELP");
    expect(input.value).toBe("eighty");
  });
});

describe("REACH LCD (regression check — unrelated sibling, should be unaffected)", () => {
  it("still renders the idle REACH window alongside COMMS", () => {
    renderStrip({ reachMessages: [] });
    expect(screen.getByText("REACH")).toBeTruthy();
    expect(screen.getByText("——")).toBeTruthy();
  });
});

describe("COMMS LCD — keyword help (BEATGRID v1)", () => {
  it("typing a known topic alone still behaves as plain live search — no auto-open", () => {
    renderStrip({ libSearch: "BEATGRID" });
    expect(screen.queryByText("Pause playback — anchor edits are gated while a deck is playing.")).toBeNull();
  });

  it("shows the ⏎ HELP hint chip once the typed text matches a known topic", () => {
    renderStrip({ libSearch: "BEATGRID" });
    expect(screen.getByText("⏎ HELP")).toBeTruthy();
  });

  it("does not show the hint chip for a non-matching query", () => {
    renderStrip({ libSearch: "eighty" });
    expect(screen.queryByText("⏎ HELP")).toBeNull();
  });

  it("Enter on a matched topic opens the body with its instructions", () => {
    renderStrip({ libSearch: "BEATGRID" });
    fireEvent.keyDown(screen.getByPlaceholderText("SEARCH · OR TYPE HELP"), { key: "Enter" });
    expect(screen.getByText("BEATGRID")).toBeTruthy();
    expect(screen.getByText("[ and ] cycle which anchor is selected.")).toBeTruthy();
  });

  it("matching is case-insensitive and trims whitespace", () => {
    renderStrip({ libSearch: "  beatgrid  " });
    fireEvent.keyDown(screen.getByPlaceholderText("SEARCH · OR TYPE HELP"), { key: "Enter" });
    expect(screen.getByText("Double-click empty waveform space to add an anchor, snapped to the nearest beat.")).toBeTruthy();
  });

  it("Escape closes the help body without clearing the search text", () => {
    const onSearchChange = vi.fn();
    renderStrip({ libSearch: "BEATGRID", onSearchChange });
    const input = screen.getByPlaceholderText("SEARCH · OR TYPE HELP");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("[ and ] cycle which anchor is selected.")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByText("[ and ] cycle which anchor is selected.")).toBeNull();
    expect(onSearchChange).not.toHaveBeenCalled();
  });

  it("re-searching a different topic while the help body is already open switches to it", () => {
    const { rerender } = renderStrip({ libSearch: "BEATGRID" });
    const input = screen.getByPlaceholderText("SEARCH · OR TYPE HELP");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("[ and ] cycle which anchor is selected.")).toBeTruthy();

    rerender(React.createElement(ContextStrip, { libSearch: "TAP" }));
    fireEvent.keyDown(screen.getByPlaceholderText("SEARCH · OR TYPE HELP"), { key: "Enter" });
    expect(screen.getByText("Needs at least 4 taps — fewer shows \"keep tapping…\" and resets.")).toBeTruthy();
    expect(screen.queryByText("[ and ] cycle which anchor is selected.")).toBeNull();
  });

  it("Enter on a non-matching query is a true no-op — no panel opens", () => {
    const { container } = renderStrip({ libSearch: "not a real topic" });
    fireEvent.keyDown(screen.getByPlaceholderText("SEARCH · OR TYPE HELP"), { key: "Enter" });
    expect(container.querySelector(".arch-context-help")).toBeNull();
    expect(container.querySelector(".is-open")).toBeNull();
  });

  it("Escape on the search input does not close a different panel (e.g. nav) that's open", () => {
    renderStrip({ libSearch: "BEATGRID" });
    fireEvent.click(screen.getByLabelText("PSC navigation"));
    expect(screen.getByText("VAULTS")).toBeTruthy();

    fireEvent.keyDown(screen.getByPlaceholderText("SEARCH · OR TYPE HELP"), { key: "Escape" });
    expect(screen.getByText("VAULTS")).toBeTruthy();
  });
});

describe("COMMS LCD — keyword help (T10, TAP topic)", () => {
  it("shows the ⏎ HELP hint chip for the TAP topic", () => {
    renderStrip({ libSearch: "TAP" });
    expect(screen.getByText("⏎ HELP")).toBeTruthy();
  });

  it("Enter on TAP opens the body with its instructions, same behavior as BEATGRID", () => {
    renderStrip({ libSearch: "TAP" });
    fireEvent.keyDown(screen.getByPlaceholderText("SEARCH · OR TYPE HELP"), { key: "Enter" });
    expect(screen.getByText("TAP")).toBeTruthy();
    expect(
      screen.getByText("Needs at least 4 taps — fewer shows \"keep tapping…\" and resets."),
    ).toBeTruthy();
  });
});
