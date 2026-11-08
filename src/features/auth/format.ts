/** Silo's wire form is `4821-7730`; screens show it as `4821 7730` (4+4, space-separated). */
export function formatUserCode(code: string): string {
  const digits = code.replace(/[\s-]+/g, '');
  if (digits.length === 8) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return code.replace(/-/g, ' ');
}
