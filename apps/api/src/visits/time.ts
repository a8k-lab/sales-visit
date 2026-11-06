// Operational input policy for this wizard only: actual visits from the last
// 366 days, never future instants. The general Visit business contract is unchanged.
export function parseJakartaVisitTime(
  value: string,
  now: number
): string | undefined {
  if (value.toLowerCase() === "sekarang") return new Date(now).toISOString();
  const match = /^(\d{2})-(\d{2})-(\d{4}) (\d{2}):(\d{2})$/.exec(value);
  if (!match) return undefined;
  const [, day, month, year, hour, minute] = match;
  const timestamp = `${year}-${month}-${day}T${hour}:${minute}:00+07:00`;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time) || time > now || time < now - 366 * 86400000)
    return undefined;
  // Date.parse may roll an invalid day into the next month.
  if (
    new Date(time + 7 * 3600000).toISOString().slice(0, 16) !==
    `${year}-${month}-${day}T${hour}:${minute}`
  )
    return undefined;
  return new Date(time).toISOString();
}
