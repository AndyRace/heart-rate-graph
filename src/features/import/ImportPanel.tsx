import { useEffect, useRef, type ChangeEvent } from "react";
import type { ImportSession, Retention } from "../../domain/readings";
import { formatCount } from "../../shared/format";

interface ImportPanelProps {
  readonly session?: ImportSession;
  readonly disabled?: boolean;
  readonly missingCapabilities?: readonly string[];
  readonly indexingPhase?: "reading" | "sorting" | "merging" | "publishing" | "cleaning";
  readonly storageUnavailable?: boolean;
  readonly retention?: Retention;
  readonly activeRetention?: Retention;
  readonly storagePersistence?: "granted" | "denied" | "unsupported";
  readonly retainedDataError?: string;
  readonly readAheadState?: "idle" | "warming" | "ready";
  readonly clearStatus?: "idle" | "confirming" | "deleting" | "failed";
  readonly clearError?: string;
  readonly onRetentionChange?: (retention: Retention) => void;
  readonly onRequestClear?: () => void;
  readonly onConfirmClear?: () => void;
  readonly onDismissClear?: () => void;
  readonly onRetryClear?: () => void;
  readonly onFile: (file: File) => void;
  readonly onCancel: () => void;
}

export function ImportPanel({
  session,
  disabled,
  missingCapabilities = [],
  indexingPhase,
  storageUnavailable,
  retention = "persistent",
  activeRetention,
  storagePersistence = "unsupported",
  retainedDataError,
  readAheadState = "idle",
  clearStatus = "idle",
  clearError,
  onRetentionChange,
  onRequestClear,
  onConfirmClear,
  onDismissClear,
  onRetryClear,
  onFile,
  onCancel,
}: ImportPanelProps) {
  const importing =
    session?.status === "importing" ||
    session?.status === "indexing" ||
    session?.status === "replacement-importing";
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const selectFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    event.target.value = "";
  };
  useEffect(() => {
    if (clearStatus === "confirming") confirmButtonRef.current?.focus();
    if (clearStatus === "failed") retryButtonRef.current?.focus();
  }, [clearStatus]);
  const effectiveRetention = activeRetention ?? retention;
  const fileLabel = retainedDataError
    ? "Re-index source"
    : session?.datasetId
      ? "Replace file"
      : "Choose JSON file";
  const showClearControls = Boolean(
    session?.datasetId || retainedDataError || clearStatus !== "idle",
  );
  const controlsDisabled = disabled || importing || clearStatus === "deleting";
  const retentionMessage =
    effectiveRetention === "session"
      ? "This index is available for this session and disappears after refresh or tab closure."
      : storagePersistence === "granted"
        ? "Retained on this device across browser restarts until you clear it."
        : "Retained locally on this device until you clear it, but the browser may evict it if storage is needed.";
  return (
    <section className="import-panel" aria-labelledby="import-title">
      <div>
        <p className="eyebrow">Private health data viewer</p>
        <h1 id="import-title">Heart rate history</h1>
        <p className="lede">
          Inspect a Google Fit heart-rate JSON export without sending it anywhere.
        </p>
      </div>
      {missingCapabilities.length > 0 ? (
        <div className="notice error" role="alert" tabIndex={-1}>
          This browser is missing: {missingCapabilities.join(", ")}.
        </div>
      ) : (
        <div className="file-actions">
          <label className="file-button">
            <span>{fileLabel}</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={selectFile}
              disabled={controlsDisabled}
            />
          </label>
          {importing && (
            <button type="button" className="secondary" onClick={onCancel} disabled={disabled}>
              Cancel import
            </button>
          )}
          {storageUnavailable && retention === "persistent" && onRetentionChange && (
            <button
              type="button"
              className="secondary"
              onClick={() => onRetentionChange("session")}
              disabled={controlsDisabled}
            >
              Use for this session
            </button>
          )}
          {showClearControls && clearStatus === "idle" && onRequestClear && (
            <button
              type="button"
              className="secondary"
              onClick={onRequestClear}
              disabled={controlsDisabled}
            >
              Clear retained data
            </button>
          )}
          {showClearControls && clearStatus === "failed" && onRetryClear && (
            <button
              type="button"
              className="secondary"
              onClick={onRetryClear}
              disabled={disabled}
              ref={retryButtonRef}
            >
              Retry clear
            </button>
          )}
        </div>
      )}
      {retainedDataError && (
        <div className="notice error" role="alert" tabIndex={-1}>
          {retainedDataError} Re-index a source file or clear retained data.
        </div>
      )}
      {importing && session && (
        <div className="progress-block">
          <progress
            value={session.processedRecords}
            max={Math.max(session.processedRecords + 1, 1)}
          />
          <span>
            {indexingPhase
              ? `${indexingPhase[0]!.toUpperCase()}${indexingPhase.slice(1)} local index`
              : session.status === "replacement-importing"
                ? `Replacing the retained local index from ${session.fileName}`
                : `${formatCount(session.processedRecords)} records processed from ${session.fileName}`}
          </span>
        </div>
      )}
      {storageUnavailable && (
        <p className="retention-note" role="status">
          Persistent storage is unavailable. A session-only index disappears after refresh or tab
          closure.
        </p>
      )}
      {(session?.datasetId || retainedDataError || effectiveRetention === "session") && (
        <p className="retention-note" role="status">
          {retentionMessage}
        </p>
      )}
      {readAheadState !== "idle" && (
        <p className="retention-subtle" data-testid="read-ahead-status">
          {readAheadState === "ready"
            ? "Nearby days are ready for quicker revisits."
            : "Adjacent days are preparing quietly in the background without changing the visible range."}
        </p>
      )}
      {clearStatus === "confirming" && (
        <div
          className="notice retention-confirmation"
          role="alertdialog"
          aria-labelledby="clear-retained-title"
        >
          <p id="clear-retained-title">Clear retained local heart-rate data from this device?</p>
          <div className="button-row">
            <button type="button" onClick={onConfirmClear} ref={confirmButtonRef}>
              Confirm clear
            </button>
            <button type="button" className="secondary" onClick={onDismissClear}>
              Keep retained data
            </button>
          </div>
        </div>
      )}
      {clearStatus === "deleting" && (
        <p className="retention-note" role="status">
          Clearing retained heart-rate data from this device.
        </p>
      )}
      {clearStatus === "failed" && clearError && (
        <div className="notice error" role="alert" tabIndex={-1}>
          {clearError} Try clear again after closing any other tab using this data.
        </div>
      )}
      <p className="privacy">
        Processing stays on this device. Your file is not uploaded or retained after this session.
      </p>
      <p className="disclaimer">
        This visualization is informational only and is not medical advice.
      </p>
    </section>
  );
}
