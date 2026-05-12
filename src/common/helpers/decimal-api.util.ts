/**
 * PostgreSQL `decimal` → JSON **string** for APIs (frontend expects strings),
 * without useless trailing fractional zeros (`"500"` not `"500.00000000"`).
 */
function trimDecimalDisplayString(input: string): string {
  let s = input.trim();
  if (s === '') return '0';
  const neg = s.startsWith('-');
  if (neg) {
    s = s.slice(1);
  }
  if (!s.includes('.')) {
    return (neg ? '-' : '') + s;
  }
  s = s.replace(/0+$/, '');
  s = s.replace(/\.$/, '');
  if (s === '') {
    s = '0';
  }
  return (neg ? '-' : '') + s;
}

export function apiDecimal(value: string | number): string {
  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  if (raw === '' || !Number.isFinite(Number(raw))) {
    return '0';
  }
  return trimDecimalDisplayString(raw);
}

/** Nullable bounds (e.g. orderbook national min/max). */
export function apiDecimalOrNull(
  value: string | number | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  if (raw === '') return null;
  if (!Number.isFinite(Number(raw))) return null;
  return trimDecimalDisplayString(raw);
}
