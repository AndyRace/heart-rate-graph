export type LocalDateTimeResult =
  | { readonly status: "valid"; readonly instantMs: number; readonly offsetMinutes: number }
  | {
      readonly status: "ambiguous";
      readonly choices: readonly { instantMs: number; offsetMinutes: number }[];
    }
  | { readonly status: "invalid" }
  | { readonly status: "out-of-range" };

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

export function parseLocalDateTime(
  value: string,
  range: { readonly startMs: number; readonly endMs: number },
): LocalDateTimeResult {
  const match = LOCAL_DATE_TIME.exec(value);
  if (!match) return { status: "invalid" };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? 0);
  const local = new Date(year!, month! - 1, day!, hour!, minute!, second, 0);
  if (
    local.getFullYear() !== year ||
    local.getMonth() !== month! - 1 ||
    local.getDate() !== day ||
    local.getHours() !== hour ||
    local.getMinutes() !== minute ||
    local.getSeconds() !== second
  )
    return { status: "invalid" };

  const wallUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, second);
  const offsets = new Set<number>();
  for (const delta of [-86_400_000, 0, 86_400_000])
    offsets.add(new Date(local.getTime() + delta).getTimezoneOffset());
  const choices = [...offsets]
    .map((offsetMinutes) => ({
      instantMs: wallUtc + offsetMinutes * 60_000,
      offsetMinutes: -offsetMinutes,
    }))
    .filter(({ instantMs }) => {
      const candidate = new Date(instantMs);
      return (
        candidate.getFullYear() === year &&
        candidate.getMonth() === month! - 1 &&
        candidate.getDate() === day &&
        candidate.getHours() === hour &&
        candidate.getMinutes() === minute &&
        candidate.getSeconds() === second
      );
    })
    .sort((left, right) => left.instantMs - right.instantMs);
  if (choices.length === 0) return { status: "invalid" };
  if (choices.length > 1) return { status: "ambiguous", choices };
  const choice = choices[0]!;
  if (choice.instantMs < range.startMs || choice.instantMs > range.endMs)
    return { status: "out-of-range" };
  return { status: "valid", ...choice };
}
