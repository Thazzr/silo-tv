/** Silo's wire form is `4821-7730`; screens show it as `4821 7730` (4+4, space-separated). */
export function formatUserCode(code: string): string {
  const digits = code.replace(/[\s-]+/g, '');
  if (digits.length === 8) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return code.replace(/-/g, ' ');
}

/** "5 min" or "30 s": the wait Silo reports in Retry-After. */
export function formatWait(seconds: number): string {
  return seconds < 60 ? `${Math.max(1, seconds)} s` : `${Math.ceil(seconds / 60)} min`;
}
