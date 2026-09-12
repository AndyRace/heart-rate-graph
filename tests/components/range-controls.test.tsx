import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("uplot", () => ({ default: vi.fn() }));

import { TimeRangeControls } from "../../src/features/range/TimeRangeControls";
import { HeartRateChart } from "../../src/features/chart/HeartRateChart";
import { RangeLoadingStatus } from "../../src/features/range/RangeLoadingStatus";

describe("range controls", () => {
  const startMs = new Date(2024, 0, 1, 0, 0).getTime();
  const endMs = new Date(2024, 0, 2, 0, 0).getTime();
  const fullRange = { startMs, endMs, revision: 0, origin: "reset" as const };

  it("commits fields on Enter and retains focus", async () => {
    const onCommit = vi.fn();
    render(
      <TimeRangeControls
        range={fullRange}
        fullRange={fullRange}
        onCommit={onCommit}
        onReset={vi.fn()}
      />,
    );
    const start = screen.getByLabelText("Start");
    start.focus();
    await userEvent.keyboard("{Enter}");
    expect(onCommit).toHaveBeenCalledWith(startMs, endMs);
    expect(start).toHaveFocus();
  });

  it("rejects reversed fields and resets in one action", async () => {
    const onReset = vi.fn();
    render(
      <TimeRangeControls
        range={fullRange}
        fullRange={fullRange}
        onCommit={vi.fn()}
        onReset={onReset}
      />,
    );
    const start = screen.getByLabelText("Start");
    await userEvent.clear(start);
    await userEvent.type(start, "2024-01-02T00:00");
    const end = screen.getByLabelText("End");
    await userEvent.clear(end);
    await userEvent.type(end, "2024-01-01T00:00");
    await userEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(screen.getByText(/end must be at or after start/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /reset/i }));
    expect(onReset).toHaveBeenCalledOnce();
  });

  it("routes zoom, keyboard, Today, adjacent days, reset, and exact fields through onCommit", async () => {
    const onCommit = vi.fn();
    const navigationRange = {
      startMs: new Date(2023, 11, 31, 0, 0).getTime(),
      endMs: new Date(2024, 0, 3, 23, 59, 59, 999).getTime(),
      revision: 0,
      origin: "reset" as const,
    };
    render(<TimeRangeControls range={fullRange} fullRange={navigationRange} onCommit={onCommit} />);

    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await userEvent.click(screen.getByRole("button", { name: "Next day" }));
    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply range" }));
    fireEvent.keyDown(screen.getByRole("form", { name: "Time range" }), { key: "+" });

    expect(onCommit).toHaveBeenCalledTimes(8);
    expect(onCommit.mock.calls.map((call) => call[2])).toEqual([
      "nested",
      "nested",
      "nested",
      "nested",
      "today",
      "reset",
      undefined,
      "nested",
    ]);
  });

  it("keeps controls enabled and focused while a range is loading", async () => {
    render(
      <TimeRangeControls range={fullRange} fullRange={fullRange} onCommit={vi.fn()} loading />,
    );
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    zoomIn.focus();
    expect(zoomIn).toHaveFocus();
    expect(zoomIn).toBeEnabled();
    expect(screen.getByLabelText("Start")).toBeEnabled();
  });

  it.each([
    ["mouse", "brush"],
    ["touch", "touch"],
  ] as const)("commits %s chart selection through onRange", (pointerType, origin) => {
    const onRange = vi.fn();
    HTMLElement.prototype.setPointerCapture = vi.fn();
    vi.stubGlobal(
      "PointerEvent",
      class extends MouseEvent {
        readonly pointerId: number;
        readonly pointerType: string;

        constructor(type: string, init: PointerEventInit = {}) {
          super(type, init);
          this.pointerId = init.pointerId ?? 0;
          this.pointerType = init.pointerType ?? "";
        }
      },
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    render(
      <HeartRateChart range={fullRange} onRange={onRange} onInspect={vi.fn()} onResize={vi.fn()} />,
    );
    const chart = screen.getByRole("img");
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 360,
      width: 100,
      height: 360,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(chart, { clientX: 10, pointerId: 1, pointerType });
    fireEvent.pointerUp(chart, { clientX: 80, pointerId: 1, pointerType });

    expect(onRange).toHaveBeenCalledWith(
      startMs + Math.round((endMs - startMs) * 0.1),
      startMs + Math.round((endMs - startMs) * 0.8),
      origin,
    );
  });

  it.each([
    ["queued", /queued/i],
    ["loading", /loading/i],
    ["partial", /partially available/i],
    ["complete", /complete/i],
    ["empty", /no readings/i],
    ["cancelled", /cancelled/i],
    ["failed", /could not load/i],
  ] as const)("names the requested range in the %s status", (status, expected) => {
    render(
      <RangeLoadingStatus
        status={status}
        requestedRange={fullRange}
        progress={{ loadedChunkCount: status === "partial" ? 1 : 0, totalChunkCount: 2 }}
        readingCount={status === "complete" ? 12 : undefined}
        error={status === "failed" ? "Could not load this range." : undefined}
      />,
    );

    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.getByText(/Jan/)).toBeInTheDocument();
  });
});
