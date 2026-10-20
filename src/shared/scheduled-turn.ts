// A scheduled turn: run `prompt` in `threadId` (as its bound Dot) on a cron
// schedule. Evaluated in the server's local timezone, minute granularity.

export interface ScheduledTurn {
  id: string;
  dotId: string;
  threadId: string;
  prompt: string;
  cron: string;
  enabled: boolean;
  createdAt: number;
  lastRunAt: number | null;
  lastStatus: string | null;
}

// Minimal 5-field cron matcher: "minute hour day-of-month month day-of-week".
// Supports *, lists (1,2), ranges (1-5), and steps (*/5, 1-9/2). day-of-week
// 0-6 with 0 = Sunday (7 also accepted). Returns true if `date` matches.
export function cronMatches(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, mon, dow] = parts;
  const d = date;
  const dowVal = d.getDay(); // 0-6, Sun=0
  return (
    fieldMatches(min, d.getMinutes(), 0, 59) &&
    fieldMatches(hour, d.getHours(), 0, 23) &&
    fieldMatches(dom, d.getDate(), 1, 31) &&
    fieldMatches(mon, d.getMonth() + 1, 1, 12) &&
    (fieldMatches(dow, dowVal, 0, 6) || fieldMatches(dow, dowVal === 0 ? 7 : dowVal, 0, 7))
  );
}

function fieldMatches(field: string, value: number, lo: number, hi: number): boolean {
  for (const part of field.split(',')) {
    const [rangePart, stepPart] = part.split('/');
    const step = stepPart ? Number(stepPart) : 1;
    if (!Number.isInteger(step) || step < 1) return false;
    let start = lo;
    let end = hi;
    if (rangePart !== '*') {
      const bounds = rangePart.split('-');
      start = Number(bounds[0]);
      end = bounds.length > 1 ? Number(bounds[1]) : start;
      if (!Number.isInteger(start) || !Number.isInteger(end)) continue;
    }
    if (value < start || value > end) continue;
    if ((value - start) % step === 0) return true;
  }
  return false;
}

export function isValidCron(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 7],
  ];
  return parts.every((field, idx) => {
    const [lo, hi] = ranges[idx];
    return field.split(',').every((part) => {
      const [rangePart, stepPart] = part.split('/');
      if (stepPart !== undefined && (!/^\d+$/.test(stepPart) || Number(stepPart) < 1))
        return false;
      if (rangePart === '*') return true;
      return rangePart.split('-').every((n) => {
        if (!/^\d+$/.test(n)) return false;
        const v = Number(n);
        return v >= lo && v <= hi;
      });
    });
  });
}
