// Pure fixed-window counter logic (kept separate from the Convex mutation so it can be unit tested).
export type Counter = { windowStart: number; count: number } | null;

export function nextCounter(row: Counter, now: number, limit: number, windowMs: number): { allowed: boolean; next: { windowStart: number; count: number } } {
  if (!row || now - row.windowStart >= windowMs) return { allowed: true, next: { windowStart: now, count: 1 } };
  if (row.count >= limit) return { allowed: false, next: row };
  return { allowed: true, next: { windowStart: row.windowStart, count: row.count + 1 } };
}
