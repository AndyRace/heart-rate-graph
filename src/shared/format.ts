const instantFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "medium",
});

export const formatInstant = (instantMs: number): string => instantFormatter.format(instantMs);

export const formatBpm = (bpm: number): string =>
  `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(bpm)} bpm`;

export const formatCount = (count: number): string => new Intl.NumberFormat().format(count);

export function formatDuration(durationMs: number): string {
  const totalMinutes = Math.floor(durationMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  return [days && `${days}d`, hours && `${hours}h`, `${minutes}m`].filter(Boolean).join(" ");
}

export function formatTimezoneOffset(instantMs: number): string {
  const offset = -new Date(instantMs).getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

export function toLocalDateTimeInput(instantMs: number): string {
  const date = new Date(instantMs);
  const local = new Date(instantMs - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
