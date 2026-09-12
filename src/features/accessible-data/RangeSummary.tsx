import type { DisplaySeries, RangeStatus, VisibleSummary } from "../../domain/readings";
import { formatBpm, formatCount, formatDuration, formatInstant } from "../../shared/format";

export function RangeSummary({
  summary,
  series,
  status,
  stale = false,
}: {
  readonly summary?: VisibleSummary;
  readonly series?: DisplaySeries;
  readonly status?: RangeStatus;
  readonly stale?: boolean;
}) {
  if (status === "empty")
    return (
      <section className="summary" aria-label="Visible range summary">
        <p>No readings in this range.</p>
      </section>
    );
  if (!summary)
    return (
      <section className="summary" aria-label="Visible range summary">
        <p>Summary is loading.</p>
      </section>
    );
  return (
    <section className="summary" aria-label="Visible range summary">
      <div className="section-heading">
        <h2 id="summary-title">Visible range</h2>
        {stale ? (
          <span className="mode-label">Previous completed range</span>
        ) : series?.mode === "aggregated" ? (
          <span className="mode-label">Display aggregated · exact summary</span>
        ) : null}
      </div>
      {summary.count === 0 ? (
        <p>No readings in this range.</p>
      ) : (
        <dl className="summary-grid">
          <div>
            <dt>Readings</dt>
            <dd>{formatCount(summary.count)}</dd>
          </div>
          <div>
            <dt>Minimum</dt>
            <dd>{formatBpm(summary.minimumBpm!)}</dd>
          </div>
          <div>
            <dt>Maximum</dt>
            <dd>{formatBpm(summary.maximumBpm!)}</dd>
          </div>
          <div>
            <dt>Mean</dt>
            <dd>{formatBpm(summary.meanBpm!)}</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(summary.durationMs)}</dd>
          </div>
          <div>
            <dt>First / last</dt>
            <dd>
              {formatInstant(summary.firstInstantMs!)}
              <br />
              {formatInstant(summary.lastInstantMs!)}
            </dd>
          </div>
        </dl>
      )}
    </section>
  );
}
