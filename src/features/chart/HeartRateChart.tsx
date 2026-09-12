import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import type { DisplaySeries, RangeOrigin, TimeBand } from "../../domain/readings";

interface HeartRateChartProps {
  readonly series?: DisplaySeries;
  readonly range: TimeBand;
  readonly stale?: boolean;
  readonly onRange: (startMs: number, endMs: number, origin: RangeOrigin) => void;
  readonly onInspect: (instantMs: number) => void;
  readonly onResize: (width: number) => void;
}

export function HeartRateChart({
  series,
  range,
  stale = false,
  onRange,
  onInspect,
  onResize,
}: HeartRateChartProps) {
  const host = useRef<HTMLDivElement>(null);
  const plot = useRef<uPlot | null>(null);
  const plotMode = useRef<DisplaySeries["mode"] | null>(null);
  const dragStart = useRef<number | undefined>(undefined);
  const [preview, setPreview] = useState<{ start: number; end: number }>();
  useEffect(() => {
    if (!host.current || !series || series.timestamps.length === 0) return;
    const width = Math.max(280, host.current.clientWidth);
    const values = Array.from(series.bpmValues, (value, index) =>
      series.gapBefore[index] ? null : value,
    );
    const data: uPlot.AlignedData = [
      Array.from(series.timestamps, (value) => value / 1000),
      values,
    ];
    if (plot.current && plotMode.current === series.mode) {
      plot.current.setData(data);
      if (plot.current.width !== width) plot.current.setSize({ width, height: 360 });
      return;
    }
    plot.current?.destroy();
    plot.current = new uPlot(
      {
        width,
        height: 360,
        scales: { x: { time: true } },
        axes: [{ label: "Local date and time" }, { label: "Beats per minute" }],
        series: [
          {},
          {
            label: "Heart rate",
            stroke: "#b73e2d",
            width: 2,
            points: { show: series.mode === "exact", size: 6 },
          },
        ],
      },
      data,
      host.current,
    );
    plotMode.current = series.mode;
  }, [series]);
  useEffect(
    () => () => {
      plot.current?.destroy();
      plot.current = null;
    },
    [],
  );
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width ?? 0;
      onResize(width);
      if (plot.current && width > 0) {
        plot.current.setSize({ width: Math.max(280, width), height: 360 });
      }
    });
    observer.observe(host.current);
    return () => observer.disconnect();
  }, [onResize]);
  const instantAt = (clientX: number) => {
    const rect = host.current!.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(range.startMs + ratio * (range.endMs - range.startMs));
  };
  return (
    <section
      className={`chart-section${stale ? " stale-result" : ""}`}
      aria-labelledby="chart-title"
    >
      <div className="section-heading">
        <h2 id="chart-title">Heart rate graph</h2>
        <span>
          {stale
            ? "Previous range"
            : series?.mode === "aggregated"
              ? "Aggregated display"
              : "Exact readings"}
        </span>
      </div>
      <div
        className="chart"
        ref={host}
        role="img"
        tabIndex={0}
        aria-label={`Heart rate from ${new Date(range.startMs).toLocaleString()} to ${new Date(range.endMs).toLocaleString()}`}
        onPointerDown={(event) => {
          const start = instantAt(event.clientX);
          dragStart.current = start;
          setPreview({ start, end: start });
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (dragStart.current !== undefined)
            setPreview({ start: dragStart.current, end: instantAt(event.clientX) });
        }}
        onPointerUp={(event) => {
          if (dragStart.current === undefined) return;
          const start = dragStart.current;
          const end = instantAt(event.clientX);
          if (
            Math.abs(
              event.clientX -
                event.currentTarget.getBoundingClientRect().left -
                ((start - range.startMs) / Math.max(1, range.endMs - range.startMs)) *
                  event.currentTarget.clientWidth,
            ) < 4
          )
            onInspect(end);
          else
            onRange(
              Math.min(start, end),
              Math.max(start, end),
              event.pointerType === "touch" ? "touch" : "brush",
            );
          dragStart.current = undefined;
          setPreview(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key !== "+" && event.key !== "=" && event.key !== "-") return;
          const duration = range.endMs - range.startMs;
          const nextDuration = event.key === "-" ? duration * 2 : Math.floor(duration / 2);
          const midpoint = range.startMs + Math.floor(duration / 2);
          onRange(
            midpoint - Math.floor(nextDuration / 2),
            midpoint + Math.ceil(nextDuration / 2),
            "nested",
          );
          event.preventDefault();
        }}
      >
        {preview && (
          <div
            className="selection-preview"
            style={{
              left: `${((Math.min(preview.start, preview.end) - range.startMs) / Math.max(1, range.endMs - range.startMs)) * 100}%`,
              width: `${(Math.abs(preview.end - preview.start) / Math.max(1, range.endMs - range.startMs)) * 100}%`,
            }}
          />
        )}
      </div>
    </section>
  );
}
