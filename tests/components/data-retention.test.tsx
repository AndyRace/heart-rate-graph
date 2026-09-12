import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { emptyValidationCounts, type ImportSession } from "../../src/domain/readings";
import { ImportPanel } from "../../src/features/import/ImportPanel";

function session(status: ImportSession["status"], datasetId = "dataset-1"): ImportSession {
  return {
    sessionId: "session-1",
    fileName: "heart-rate.json",
    fileSizeBytes: 256,
    status,
    processedRecords: 12,
    counts: emptyValidationCounts(),
    datasetId,
  };
}

describe("data retention controls", () => {
  it("labels persistent and session retention truthfully", () => {
    const { rerender } = render(
      <ImportPanel
        session={session("ready")}
        activeRetention="persistent"
        storagePersistence="granted"
        onFile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/retained on this device across browser restarts until you clear it/i),
    ).toBeInTheDocument();

    rerender(
      <ImportPanel
        session={session("ready")}
        activeRetention="session"
        onFile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/available for this session and disappears after refresh/i),
    ).toBeInTheDocument();
  });

  it("shows replacement progress and quiet read-ahead without disrupting the replacement control", () => {
    render(
      <ImportPanel
        session={session("replacement-importing")}
        readAheadState="warming"
        onFile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText(/replacing the retained local index/i)).toBeInTheDocument();
    expect(screen.getByText("Replace file")).toBeInTheDocument();
    expect(screen.getByTestId("read-ahead-status")).toHaveTextContent(
      /preparing quietly in the background/i,
    );
  });

  it("surfaces retained-source invalidation with re-index and clear guidance", () => {
    render(
      <ImportPanel
        retainedDataError="Retained data could not be reopened."
        onRequestClear={vi.fn()}
        onFile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /re-index a source file or clear retained data/i,
    );
    expect(screen.getByLabelText(/re-index source/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear retained data" })).toBeInTheDocument();
  });

  it("requires confirmation before clearing retained data and moves focus to confirm", async () => {
    const user = userEvent.setup();
    const onRequestClear = vi.fn();
    const onConfirmClear = vi.fn();
    const onDismissClear = vi.fn();
    const { rerender } = render(
      <ImportPanel
        session={session("ready")}
        onRequestClear={onRequestClear}
        onConfirmClear={onConfirmClear}
        onDismissClear={onDismissClear}
        onFile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear retained data" }));
    expect(onRequestClear).toHaveBeenCalledTimes(1);

    rerender(
      <ImportPanel
        session={session("ready")}
        clearStatus="confirming"
        onRequestClear={onRequestClear}
        onConfirmClear={onConfirmClear}
        onDismissClear={onDismissClear}
        onFile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Confirm clear" });
    expect(confirm).toHaveFocus();
    await user.click(confirm);
    expect(onConfirmClear).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Keep retained data" }));
    expect(onDismissClear).toHaveBeenCalledTimes(1);
  });

  it("disables import actions while deletion is in progress", () => {
    render(
      <ImportPanel
        session={session("ready")}
        clearStatus="deleting"
        onFile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByLabelText(/replace file/i)).toBeDisabled();
    expect(
      screen.getByText(/clearing retained heart-rate data from this device/i),
    ).toBeInTheDocument();
  });

  it("shows blocked clear retry guidance and focuses the retry action", async () => {
    const user = userEvent.setup();
    const onRetryClear = vi.fn();
    render(
      <ImportPanel
        session={session("ready")}
        clearStatus="failed"
        clearError="Retained data could not be deleted because another tab is still using it."
        onRetryClear={onRetryClear}
        onFile={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const retry = screen.getByRole("button", { name: "Retry clear" });
    expect(retry).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent(/closing any other tab/i);
    await user.click(retry);
    expect(onRetryClear).toHaveBeenCalledTimes(1);
  });
});
