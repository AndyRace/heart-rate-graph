import type { RangeStatus, ReadingPage, ReadingRow } from "../../domain/readings";
import { formatBpm, formatInstant, formatTimezoneOffset } from "../../shared/format";

interface ReadingTableProps {
  readonly result?: ReadingPage;
  readonly selectedReading?: ReadingRow;
  readonly status?: RangeStatus;
  readonly stale?: boolean;
  readonly onPage: (page: number, pageSize: 25 | 50 | 100) => void;
  readonly onInspect: (direction: "previous" | "next") => void;
}

export function ReadingTable({
  result,
  selectedReading,
  status,
  stale = false,
  onPage,
  onInspect,
}: ReadingTableProps) {
  const page = result?.page ?? 1;
  const pageSize = result?.pageSize ?? 50;
  const totalPages = Math.max(1, Math.ceil((result?.totalRows ?? 0) / pageSize));
  return (
    <section className="readings" aria-labelledby="readings-title">
      <div className="section-heading">
        <h2 id="readings-title">Exact readings</h2>
        <span>
          {stale ? "Previous completed range · " : ""}Page {page} of {totalPages}
        </span>
      </div>
      {selectedReading && (
        <div className="point-details" aria-live="polite">
          <strong>{formatBpm(selectedReading.bpm)}</strong>
          <span>
            {formatInstant(selectedReading.instantMs)} ·{" "}
            {formatTimezoneOffset(selectedReading.instantMs)}
          </span>
          <span>{selectedReading.source || "Source not provided"}</span>
          <div className="button-row">
            <button type="button" className="secondary" onClick={() => onInspect("previous")}>
              Previous reading
            </button>
            <button type="button" className="secondary" onClick={() => onInspect("next")}>
              Next reading
            </button>
          </div>
        </div>
      )}
      <div
        className="table-scroll"
        role="region"
        aria-label="Exact heart-rate readings"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Local time</th>
              <th scope="col">Heart rate</th>
              <th scope="col">Source</th>
            </tr>
          </thead>
          <tbody>
            {result?.rows.map((row) => (
              <tr key={row.sourceIndex}>
                <td>
                  {formatInstant(row.instantMs)}{" "}
                  <span className="offset">{formatTimezoneOffset(row.instantMs)}</span>
                </td>
                <td>{formatBpm(row.bpm)}</td>
                <td>{row.source || "Not provided"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(status === "empty" || result?.rows.length === 0) && (
          <p className="empty-table">No exact readings in this range.</p>
        )}
      </div>
      <div className="pagination">
        <button
          type="button"
          className="secondary"
          disabled={page <= 1}
          onClick={() => onPage(page - 1, pageSize)}
        >
          Previous
        </button>
        <label>
          Rows{" "}
          <select
            value={pageSize}
            onChange={(event) => onPage(1, Number(event.target.value) as 25 | 50 | 100)}
          >
            <option>25</option>
            <option>50</option>
            <option>100</option>
          </select>
        </label>
        <button
          type="button"
          className="secondary"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1, pageSize)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
