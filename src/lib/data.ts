import Papa from 'papaparse';
import type { Cell, ChartConfig, ChartType, Column, DataRow, Dataset, FilterRule } from '../types';

const MAX_ROWS = 50_000;
const MAX_COLUMNS = 100;
const MAX_BYTES = 10 * 1024 * 1024;
const NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function numberValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !NUMBER_PATTERN.test(value.trim())) return null;
  const text = value.trim();
  // keep padded identifiers and integers beyond safe precision as text
  if (/^[+-]?0\d+$/.test(text)) return null;
  const parsed = Number(text);
  if (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) return null;
  return Number.isFinite(parsed) ? parsed : null;
}

function dateValue(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = ISO_DATE_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day)) return null;
  // use utc for timestamps without an explicit timezone
  const normalized = value.trim().replace(' ', 'T');
  const timestamp = Date.parse(normalized.length > 10 && !/(?:Z|[+-]\d{2}:?\d{2})$/.test(normalized) ? `${normalized}Z` : normalized);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return String(value);
  if (typeof value !== 'string') throw new Error('JSON values must be text, numbers, booleans, or null. Flatten nested objects before importing.');
  return value.trim() === '' ? null : value.trim();
}

function uniqueHeaders(raw: string[]): string[] {
  const used = new Set<string>();
  return raw.map((header, index) => {
    const base = header.replace(/^\uFEFF/, '').trim() || `Column ${index + 1}`;
    let key = base;
    let suffix = 2;
    while (used.has(key)) key = `${base}_${suffix++}`;
    used.add(key);
    return key;
  });
}

function buildDataset(name: string, rawHeaders: string[], values: unknown[][]): Dataset {
  if (!values.length) throw new Error('This file has headers but no data rows. Add at least one row and try again.');
  if (values.length > MAX_ROWS) throw new Error('This dataset is too large. Import 50,000 rows or fewer.');
  if (rawHeaders.length > MAX_COLUMNS) throw new Error('This dataset has too many columns. Import 100 columns or fewer.');
  const headers = uniqueHeaders(rawHeaders);
  const rows: DataRow[] = values.map((values) => {
    const row: DataRow = Object.create(null);
    headers.forEach((key, index) => { row[key] = normalizeCell(values[index]); });
    return row;
  });
  const columns: Column[] = headers.map((key) => {
    const present = rows.map((row) => row[key]).filter((value) => value !== null);
    const type = present.length && present.every((value) => numberValue(value) !== null)
      ? 'number'
      : present.length && present.every((value) => dateValue(value) !== null) ? 'date' : 'text';
    if (type === 'number') rows.forEach((row) => { if (row[key] !== null) row[key] = numberValue(row[key]); });
    return { key, type, unique: new Set(present.map((value) => type === 'number' ? numberValue(value) : value)).size };
  });
  return { name, rows, columns };
}

export function parseDataset(text: string, filename: string): Dataset {
  if (text.length > MAX_BYTES || new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error('This dataset is too large. Import 10 MB of data or less.');
  const content = text.replace(/^\uFEFF/, '').trim();
  if (!content) throw new Error('This file is empty. Choose a CSV, TSV, or JSON file with data.');
  const name = filename.replace(/\.[^.]+$/, '') || 'Imported dataset';
  if (/\.json$/i.test(filename) || (!/\.(csv|tsv|tab)$/i.test(filename) && /^[\[{]/.test(content))) {
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { throw new Error('This JSON file is invalid. Check its commas, brackets, and quotes, then try again.'); }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const wrapper = parsed as Record<string, unknown>;
      parsed = wrapper.data ?? wrapper.rows;
    }
    if (!Array.isArray(parsed)) throw new Error('JSON must contain an array of objects, or an object with a data or rows array.');
    if (!parsed.length) throw new Error('This JSON file has no data rows. Add at least one object and try again.');
    if (parsed.length > MAX_ROWS) throw new Error('This dataset is too large. Import 50,000 rows or fewer.');
    if (parsed.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Each JSON data row must be an object with named columns.');
    const objects = parsed as Record<string, unknown>[];
    const keys = new Set<string>();
    // reject wide data before allocating the row-by-column matrix
    for (const row of objects) {
      for (const key of Object.keys(row)) {
        keys.add(key);
        if (keys.size > MAX_COLUMNS) throw new Error('This dataset has too many columns. Import 100 columns or fewer.');
      }
    }
    const headers = [...keys];
    if (!headers.length) throw new Error('This JSON file has no columns. Add named fields to its objects.');
    return buildDataset(name, headers, objects.map((row) => headers.map((key) => Object.hasOwn(row, key) ? row[key] : null)));
  }

  // parse arrays so duplicate headers can be repaired without losing data
  const result = Papa.parse<string[]>(content, { delimiter: /\.(tsv|tab)$/i.test(filename) ? '\t' : '', skipEmptyLines: 'greedy' });
  const failure = result.errors.find((error) => error.code !== 'UndetectableDelimiter');
  if (failure) throw new Error(`Could not read this delimited file: ${failure.message} Check that quoted values are closed correctly.`);
  const [headers, ...values] = result.data;
  if (!headers || !headers.length) throw new Error('This file has no column headers.');
  const mismatch = values.findIndex((row) => row.length !== headers.length);
  if (mismatch !== -1) throw new Error(`Row ${mismatch + 2} has ${values[mismatch].length} values; the header has ${headers.length}. Check delimiters and quoted values.`);
  return buildDataset(name, headers, values);
}

export function applyFilters(rows: DataRow[], rules: FilterRule[]): DataRow[] {
  return rows.filter((row) => rules.every((rule) => {
    const value = row[rule.column];
    if (rule.kind === 'text') return !rule.values?.length || rule.values.includes(value === null || value === undefined ? '' : String(value));
    const minText = rule.min?.trim() ?? '';
    const maxText = rule.max?.trim() ?? '';
    if (!minText && !maxText) return true;
    const numeric = rule.kind === 'date' ? dateValue(value) : numberValue(value);
    if (numeric === null) return false;
    const minimum = rule.kind === 'date' ? dateValue(minText) : numberValue(minText);
    let maximum = rule.kind === 'date' ? dateValue(maxText) : numberValue(maxText);
    // a date-only upper bound includes every timestamp on that day
    if (rule.kind === 'date' && maximum !== null && /^\d{4}-\d{2}-\d{2}$/.test(maxText)) maximum += 86_400_000 - 1;
    return (minimum === null || numeric >= minimum) && (maximum === null || numeric <= maximum);
  }));
}

export function recommendCharts(columns: Column[]): ChartType[] {
  const numbers = columns.filter((column) => column.type === 'number');
  const hasDate = columns.some((column) => column.type === 'date');
  const hasCategory = columns.some((column) => column.type === 'text');
  const charts: ChartType[] = [];
  if (hasDate || numbers.length >= 2) charts.push('line', 'area');
  if (hasCategory || hasDate) charts.push('bar');
  if (numbers.length >= 2) charts.push('scatter');
  if (hasCategory) charts.push('pie');
  if (numbers.length) charts.push('histogram');
  return charts.length ? charts : ['bar'];
}

export function defaultConfig(type: ChartType, columns: Column[]): ChartConfig {
  const numbers = columns.filter((column) => column.type === 'number');
  const category = columns.filter((column) => column.type === 'text').sort((a, b) => a.unique - b.unique)[0];
  const date = columns.find((column) => column.type === 'date');
  const first = columns[0]?.key ?? '';
  let xKey = (category ?? date ?? numbers[0])?.key ?? first;
  let yKey = numbers[0]?.key ?? '';
  if (type === 'line' || type === 'area') {
    xKey = (date ?? (numbers.length >= 2 ? numbers[0] : category) ?? numbers[0])?.key ?? first;
    if (!date && numbers.length >= 2) yKey = numbers[1].key;
  }
  if (type === 'scatter') {
    xKey = numbers[0]?.key ?? first;
    yKey = numbers[1]?.key ?? numbers[0]?.key ?? '';
  }
  if (type === 'histogram') xKey = numbers[0]?.key ?? first;
  return { type, xKey, yKey, aggregation: numbers.length ? 'sum' : 'count' };
}
