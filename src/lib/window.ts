import type { ColumnType, DataRow } from '../types';

export interface Extent { min: number; max: number }
export interface WindowInput { min: string; max: string }
const DAY = 86_400_000;

function coordinate(value: unknown, type: ColumnType): number {
  if (value === null || value === undefined || value === '') return NaN;
  if (type === 'number') return typeof value === 'number' ? value : Number(value);
  const text = String(value).replace(' ', 'T');
  return Date.parse(text.length > 10 && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? `${text}Z` : text);
}

export function xExtent(rows: DataRow[], key: string, type: ColumnType): Extent | null {
  if (type === 'text') return null;
  let min = Infinity;
  let max = -Infinity;
  for (const row of rows) {
    const value = coordinate(row[key], type);
    if (Number.isFinite(value)) { min = Math.min(min, value); max = Math.max(max, value); }
  }
  return min <= max ? { min, max } : null;
}

export function windowValue(value: number, type: ColumnType): string {
  return type === 'date' ? new Date(value).toISOString().slice(0, 10) : String(value);
}

export function zoomWindow(extent: Extent, current: WindowInput, type: ColumnType, factor: number): WindowInput {
  if (!(factor > 0 && Number.isFinite(factor))) return current;
  const a = coordinate(current.min, type);
  const b = coordinate(current.max, type);
  const low = Number.isFinite(a) ? Math.max(extent.min, a) : extent.min;
  const high = Number.isFinite(b) ? Math.min(extent.max, b) : extent.max;
  if (low > high) return { min: windowValue(extent.min, type), max: windowValue(extent.max, type) };
  if (type === 'date') {
    // date windows include both calendar-day boundaries
    const first = Math.floor(extent.min / DAY);
    const last = Math.floor(extent.max / DAY);
    const start = Math.floor(low / DAY);
    const end = Math.floor(high / DAY);
    const length = Math.max(1, Math.min(last - first + 1, Math.round((end - start + 1) * factor)));
    const next = Math.max(first, Math.min(last - length + 1, Math.round((start + end - length + 1) / 2)));
    return { min: windowValue(next * DAY, type), max: windowValue((next + length - 1) * DAY, type) };
  }
  const full = extent.max - extent.min;
  const width = Math.min(full, Math.max(full * 1e-9, (high - low) * factor));
  const start = Math.max(extent.min, Math.min(extent.max - width, low / 2 + high / 2 - width / 2));
  return { min: windowValue(start, type), max: windowValue(start + width, type) };
}

export function lastDaysWindow(extent: Extent, days: number): WindowInput {
  const last = Math.floor(extent.max / DAY) * DAY;
  const first = Math.floor(extent.min / DAY) * DAY;
  const start = Math.max(first, last - (Math.max(1, Math.floor(days)) - 1) * DAY);
  return { min: windowValue(start, 'date'), max: windowValue(last, 'date') };
}
