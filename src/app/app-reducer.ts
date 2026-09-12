import type {
  CoveredInterval,
  DisplaySeries,
  ImportSession,
  ReadingPage,
  ReadingRow,
  RangeCorrelation,
  RangeProgress,
  RangeSnapshot,
  RangeStatus,
  Retention,
  TimeBand,
  VisibleSummary,
} from "../domain/readings";

type ClearStatus = "idle" | "confirming" | "deleting" | "failed";

export interface AppState {
  readonly status: ImportSession["status"];
  readonly session?: ImportSession;
  readonly pendingSession?: ImportSession;
  readonly replacementFailure?: string;
  readonly datasetId?: string;
  readonly generationId?: string;
  readonly retention?: Retention;
  readonly indexingPhase?: "reading" | "sorting" | "merging" | "publishing" | "cleaning";
  readonly rangeStatus?: RangeStatus;
  readonly rangeCorrelation?: RangeCorrelation;
  readonly rangeProgress?: RangeProgress;
  readonly coveredIntervals?: readonly CoveredInterval[];
  readonly rangeResultIsStale?: boolean;
  readonly fullRange?: TimeBand;
  readonly range?: TimeBand;
  readonly series?: DisplaySeries;
  readonly summary?: VisibleSummary;
  readonly readingPage?: ReadingPage;
  readonly selectedReading?: ReadingRow;
  readonly clearStatus: ClearStatus;
  readonly clearFailure?: string;
  readonly startupError?: string;
  readonly announcement: string;
}

export type AppAction =
  | { type: "capability.check" }
  | { type: "capability.failed"; message: string }
  | { type: "import.started"; session: ImportSession; replacement: boolean }
  | { type: "import.progress"; session: ImportSession }
  | { type: "import.ready"; session: ImportSession; fullRange: TimeBand }
  | { type: "import.failed"; session: ImportSession; replacement: boolean }
  | { type: "import.cancelled"; session: ImportSession; replacement: boolean }
  | { type: "index.started"; session: ImportSession; replacement: boolean; retention: Retention }
  | {
      type: "index.progress";
      phase: "reading" | "sorting" | "merging" | "publishing" | "cleaning";
      processedRecords: number;
    }
  | {
      type: "index.ready";
      session: ImportSession;
      datasetId: string;
      generationId: string;
      retention: Retention;
      fullRange: TimeBand;
      initialRange: TimeBand;
    }
  | { type: "index.failed"; message: string; replacement: boolean }
  | { type: "index.cancelled"; replacement: boolean }
  | { type: "index.unavailable"; message?: string }
  | { type: "index.clear.requested" }
  | { type: "index.clear.dismissed" }
  | { type: "index.clear.started" }
  | { type: "index.clear.failed"; message: string }
  | { type: "index.cleared" }
  | {
      type: "range.queued";
      range: TimeBand;
      correlation: RangeCorrelation;
      announcement: string;
    }
  | { type: "range.started"; correlation: RangeCorrelation }
  | {
      type: "range.progress";
      correlation: RangeCorrelation;
      progress: RangeProgress;
      coveredIntervals: readonly CoveredInterval[];
    }
  | {
      type: "range.cancelled";
      correlation: RangeCorrelation;
      reason: "superseded" | "unmounted" | "user";
    }
  | { type: "range.loading"; range: TimeBand; announcement: string }
  | { type: "range.snapshot"; snapshot: RangeSnapshot }
  | { type: "range.failed"; message: string; correlation?: RangeCorrelation }
  | { type: "range.committed"; range: TimeBand; announcement: string }
  | { type: "range.result"; revision: number; series: DisplaySeries; summary: VisibleSummary }
  | { type: "reading.page.result"; page: ReadingPage }
  | { type: "reading.selected"; revision: number; reading?: ReadingRow };

export const initialAppState: AppState = {
  status: "empty",
  clearStatus: "idle",
  announcement: "",
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "capability.check":
      return state.status === "empty" ? { ...state, status: "capability-check" } : state;
    case "capability.failed":
      return {
        ...state,
        status: "failed",
        clearStatus: "idle",
        announcement: action.message,
      };
    case "import.started":
      return {
        ...state,
        status: action.replacement ? "replacement-importing" : "importing",
        session: action.replacement ? state.session : action.session,
        pendingSession: action.replacement ? action.session : undefined,
        replacementFailure: undefined,
        clearStatus: "idle",
        clearFailure: undefined,
        startupError: undefined,
        announcement: "Import started",
      };
    case "index.started":
      return {
        ...state,
        status: action.replacement ? "replacement-importing" : "indexing",
        session: action.replacement ? state.session : action.session,
        pendingSession: action.replacement ? action.session : undefined,
        retention: action.retention,
        indexingPhase: "reading",
        replacementFailure: undefined,
        clearStatus: "idle",
        clearFailure: undefined,
        startupError: undefined,
        announcement: action.replacement ? "Replacement indexing started" : "Indexing started",
      };
    case "index.progress": {
      const activeSession = state.pendingSession ?? state.session;
      return activeSession
        ? {
            ...state,
            indexingPhase: action.phase,
            session:
              state.pendingSession === undefined
                ? { ...activeSession, processedRecords: action.processedRecords }
                : state.session,
            pendingSession: state.pendingSession
              ? { ...state.pendingSession, processedRecords: action.processedRecords }
              : undefined,
            announcement: `${action.phase} local index`,
          }
        : state;
    }
    case "index.ready":
      return {
        status: "ready",
        session: action.session,
        pendingSession: undefined,
        replacementFailure: undefined,
        datasetId: action.datasetId,
        generationId: action.generationId,
        retention: action.retention,
        indexingPhase: undefined,
        clearStatus: "idle",
        clearFailure: undefined,
        startupError: undefined,
        fullRange: action.fullRange,
        range: action.initialRange,
        rangeStatus: "queued",
        rangeResultIsStale: false,
        announcement: "Heart-rate data is ready; today's readings are loading",
      };
    case "index.failed":
      return action.replacement
        ? {
            ...state,
            status: "replacement-failed",
            pendingSession: undefined,
            indexingPhase: undefined,
            replacementFailure: action.message,
            clearStatus: state.clearStatus,
            clearFailure: state.clearFailure,
            startupError: state.startupError,
            announcement: action.message,
          }
        : {
            ...state,
            status: "failed",
            indexingPhase: undefined,
            announcement: action.message,
          };
    case "index.cancelled":
      return action.replacement
        ? {
            ...state,
            status: "ready",
            pendingSession: undefined,
            indexingPhase: undefined,
            announcement: "Replacement cancelled",
          }
        : {
            ...state,
            status: "cancelled",
            indexingPhase: undefined,
            announcement: "Import cancelled",
          };
    case "index.unavailable":
      return action.message
        ? {
            ...initialAppState,
            startupError: action.message,
            announcement: action.message,
          }
        : initialAppState;
    case "index.clear.requested":
      return {
        ...state,
        clearStatus: "confirming",
        clearFailure: undefined,
        announcement: state.announcement,
      };
    case "index.clear.dismissed":
      return {
        ...state,
        clearStatus: "idle",
        clearFailure: undefined,
      };
    case "index.clear.started":
      return {
        ...state,
        clearStatus: "deleting",
        clearFailure: undefined,
        announcement: "Clearing retained heart-rate data",
      };
    case "index.clear.failed":
      return {
        ...state,
        clearStatus: "failed",
        clearFailure: action.message,
        announcement: action.message,
      };
    case "index.cleared":
      return {
        ...initialAppState,
        announcement: "Retained heart-rate data was cleared",
      };
    case "range.queued":
      return {
        ...state,
        range: action.range,
        rangeStatus: "queued",
        rangeCorrelation: action.correlation,
        rangeProgress: { loadedChunkCount: 0, totalChunkCount: 0 },
        coveredIntervals: [],
        rangeResultIsStale: Boolean(state.series || state.summary || state.readingPage),
        announcement: action.announcement,
      };
    case "range.started":
      return isCurrentRange(state, action.correlation)
        ? { ...state, rangeStatus: "loading", announcement: "Visible range is loading" }
        : state;
    case "range.progress":
      return isCurrentRange(state, action.correlation)
        ? {
            ...state,
            rangeProgress: action.progress,
            coveredIntervals: action.coveredIntervals,
          }
        : state;
    case "range.cancelled":
      return isCurrentRange(state, action.correlation)
        ? {
            ...state,
            rangeStatus: "cancelled",
            announcement: action.reason === "user" ? "Range loading cancelled" : state.announcement,
          }
        : state;
    case "range.loading":
      return {
        ...state,
        range: action.range,
        rangeStatus: "loading",
        rangeResultIsStale: Boolean(state.series || state.summary || state.readingPage),
        announcement: action.announcement,
      };
    case "range.snapshot":
      return isCurrentRange(state, action.snapshot)
        ? {
            ...state,
            rangeStatus: action.snapshot.status,
            rangeProgress: action.snapshot.progress,
            coveredIntervals: action.snapshot.coveredIntervals,
            rangeResultIsStale: false,
            series: action.snapshot.displaySeries,
            summary: action.snapshot.summary ?? undefined,
            readingPage: action.snapshot.readingPage,
            selectedReading: undefined,
            announcement:
              action.snapshot.status === "empty"
                ? "No readings in the selected range"
                : action.snapshot.status === "partial"
                  ? `${action.snapshot.readingCount} readings available; loading continues`
                  : `${action.snapshot.readingCount} readings loaded`,
          }
        : state;
    case "range.failed":
      return action.correlation && !isCurrentRange(state, action.correlation)
        ? state
        : {
            ...state,
            rangeStatus: "failed",
            rangeResultIsStale: Boolean(state.series || state.summary || state.readingPage),
            announcement: action.message,
          };
    case "import.progress":
      if (state.pendingSession?.sessionId === action.session.sessionId) {
        if (action.session.processedRecords < state.pendingSession.processedRecords) return state;
        return { ...state, pendingSession: action.session };
      }
      if (
        !state.session ||
        state.session.sessionId !== action.session.sessionId ||
        action.session.processedRecords < state.session.processedRecords
      )
        return state;
      return { ...state, session: action.session };
    case "import.ready":
      return {
        status: "ready",
        session: action.session,
        pendingSession: undefined,
        replacementFailure: undefined,
        datasetId: action.session.datasetId,
        fullRange: action.fullRange,
        range: action.fullRange,
        clearStatus: "idle",
        clearFailure: undefined,
        startupError: undefined,
        announcement: "Heart-rate data is ready",
      };
    case "import.failed":
      return action.replacement
        ? {
            ...state,
            status: "replacement-failed",
            pendingSession: undefined,
            replacementFailure: action.session.failure?.message,
            announcement: action.session.failure?.message ?? "Replacement failed",
          }
        : {
            status: "failed",
            session: action.session,
            clearStatus: state.clearStatus,
            clearFailure: state.clearFailure,
            startupError: state.startupError,
            announcement: action.session.failure?.message ?? "Import failed",
          };
    case "import.cancelled":
      return action.replacement
        ? {
            ...state,
            status: "ready",
            pendingSession: undefined,
            announcement: "Replacement cancelled",
          }
        : {
            status: "cancelled",
            session: action.session,
            clearStatus: state.clearStatus,
            clearFailure: state.clearFailure,
            startupError: state.startupError,
            announcement: "Import cancelled",
          };
    case "range.committed":
      return state.status === "ready"
        ? { ...state, range: action.range, announcement: action.announcement }
        : state;
    case "range.result":
      return state.range?.revision === action.revision
        ? { ...state, series: action.series, summary: action.summary }
        : state;
    case "reading.page.result":
      return state.range?.revision === action.page.rangeRevision
        ? { ...state, readingPage: action.page }
        : state;
    case "reading.selected":
      return state.range?.revision === action.revision
        ? { ...state, selectedReading: action.reading }
        : state;
  }
}

function isCurrentRange(state: AppState, correlation: RangeCorrelation): boolean {
  const current = state.rangeCorrelation;
  return Boolean(
    current &&
    current.datasetId === correlation.datasetId &&
    current.generationId === correlation.generationId &&
    current.viewId === correlation.viewId &&
    current.requestId === correlation.requestId &&
    current.rangeRevision === correlation.rangeRevision,
  );
}
