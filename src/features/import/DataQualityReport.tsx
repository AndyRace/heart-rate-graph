import type { ValidationCounts } from "../../domain/readings";
import { formatCount } from "../../shared/format";

export function DataQualityReport({ counts }: { readonly counts: ValidationCounts }) {
  const excluded = counts.duplicate + counts.missing + counts.malformed + counts.outOfRange;
  return (
    <section className="quality" aria-labelledby="quality-title">
      <div className="section-heading">
        <h2 id="quality-title">Data quality</h2>
        <span>{formatCount(counts.accepted)} accepted</span>
      </div>
      {excluded === 0 ? (
        <p>All parsed records were accepted.</p>
      ) : (
        <>
          <p>{formatCount(excluded)} records were excluded. Valid readings remain available.</p>
          <dl className="quality-grid">
            <div>
              <dt>Duplicates</dt>
              <dd>{formatCount(counts.duplicate)}</dd>
            </div>
            <div>
              <dt>Missing fields</dt>
              <dd>{formatCount(counts.missing)}</dd>
            </div>
            <div>
              <dt>Malformed</dt>
              <dd>{formatCount(counts.malformed)}</dd>
            </div>
            <div>
              <dt>Out of range</dt>
              <dd>{formatCount(counts.outOfRange)}</dd>
            </div>
          </dl>
        </>
      )}
    </section>
  );
}
