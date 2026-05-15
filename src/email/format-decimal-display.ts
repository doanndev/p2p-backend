/**
 * Human-readable amounts for email/HTML (avoids trailing zeros like 500.00000000).
 */
export function formatDecimalDisplay(value: number | string): string {
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 8,
  });
}
