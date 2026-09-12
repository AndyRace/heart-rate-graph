import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImportPanel } from "../../src/features/import/ImportPanel";
import { emptyValidationCounts, type ImportSession } from "../../src/domain/readings";

const session = (status: ImportSession["status"], datasetId?: string): ImportSession => ({
  sessionId: "s",
  fileName: "health.json",
  fileSizeBytes: 100,
  status,
  processedRecords: 12,
  counts: emptyValidationCounts(),
  datasetId,
});

describe("import flow", () => {
  it("shows local-only privacy and medical context initially", () => {
    render(<ImportPanel onFile={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/choose json file/i)).toBeInTheDocument();
    expect(screen.getByText(/not uploaded/i)).toBeInTheDocument();
    expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
  });

  it("shows progress and cancellation while importing", () => {
    render(<ImportPanel session={session("importing")} onFile={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
  });

  it("blocks import with an accessible capability error", () => {
    render(<ImportPanel missingCapabilities={["BigInt"]} onFile={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("BigInt");
    expect(screen.queryByLabelText(/choose json file/i)).not.toBeInTheDocument();
  });

  it.each(["reading", "sorting", "merging", "publishing", "cleaning"] as const)(
    "shows the %s indexing phase without changing privacy or medical language",
    (phase) => {
      render(
        <ImportPanel
          session={session("indexing")}
          indexingPhase={phase}
          onFile={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
      expect(screen.getByText(new RegExp(phase, "i"))).toBeInTheDocument();
      expect(screen.getByText(/not uploaded/i)).toBeInTheDocument();
      expect(screen.getByText(/not medical advice/i)).toBeInTheDocument();
    },
  );

  it("offers an explicit session-only recovery choice", () => {
    const onRetentionChange = vi.fn();
    render(
      <ImportPanel
        storageUnavailable
        retention="persistent"
        onRetentionChange={onRetentionChange}
        onFile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: "Use for this session" }).click();
    expect(onRetentionChange).toHaveBeenCalledWith("session");
    expect(screen.getByText(/disappears after refresh or tab closure/i)).toBeInTheDocument();
  });

  it("discloses an active session-only index even without a storage failure", () => {
    render(
      <ImportPanel
        session={session("ready", "dataset-1")}
        retention="session"
        onFile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/available for this session and disappears after refresh/i),
    ).toBeInTheDocument();
  });

  it("labels retained-source startup for replacement rather than first-time selection", () => {
    render(
      <ImportPanel session={session("ready", "dataset-1")} onFile={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.getByText("Replace file")).toBeInTheDocument();
    expect(screen.queryByText("Choose JSON file")).not.toBeInTheDocument();
  });

  it("invokes cancellation when the cancel control is used during indexing", () => {
    const onCancel = vi.fn();
    render(<ImportPanel session={session("indexing")} onFile={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the file chooser available for recovery after a failed import", () => {
    render(<ImportPanel session={session("failed")} onFile={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText(/choose json file/i)).toBeEnabled();
  });
});
