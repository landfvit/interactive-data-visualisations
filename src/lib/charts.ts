import type { ChartConfig, DataRow } from '../types';

export interface ChartPoint {
  name: string;
  value: number;
  count: number;
  sum: number;
  x?: number;
  y?: number;
  low?: number;
  high?: number;
}

export interface ChartSeries {
  points: ChartPoint[];
  validRows: number;
  skippedRows: number;
  totalGroups: number;
  xIsDate: boolean;
  xIsNumeric: boolean;
  reductionNote: string | null;
}

const numberFormatter = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const compactFormatter = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const shortDateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fullDateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function formatChartNumber(value: number, compact = false): string {
  if (!Number.isFinite(value)) return '—';
  if (compact && Math.abs(value) >= 10_000) return compactFormatter.format(value);
  if (value !== 0 && Math.abs(value) < 0.01) return value.toPrecision(2);
  return numberFormatter.format(value);
}

export function formatChartDate(value: number, includeYear = false): string {
  return (includeYear ? fullDateFormatter : shortDateFormatter).format(new Date(value));
}

export function chartLabel(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

export function chartSummary(config: ChartConfig): string {
  if (config.type === 'histogram') return `Distribution of ${chartLabel(config.xKey)}`;
  if (config.type === 'scatter') return `${chartLabel(config.yKey)} against ${chartLabel(config.xKey)}`;
  const metric = config.aggregation === 'count' ? 'Number of records' : chartLabel(config.yKey);
  return `${metric} by ${chartLabel(config.xKey)}`;
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) || /^[+-]?0\d+$/.test(text)) return null;
  const number = Number(text);
  // keep identifiers precise instead of merging their numeric approximations.
  if (Number.isInteger(number) && !Number.isSafeInteger(number)) return null;
  return Number.isFinite(number) ? number : null;
}

function isMissing(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && !value.trim());
}

function dateValue(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pointValue(sum: number, count: number, config: ChartConfig): number {
  return config.aggregation === 'average' ? sum / count : config.aggregation === 'count' ? count : sum;
}

function mergePoints(points: ChartPoint[], name: string, config: ChartConfig): ChartPoint {
  const count = points.reduce((total, point) => total + point.count, 0);
  const sum = points.reduce((total, point) => total + point.sum, 0);
  const ordered = points.filter((point) => point.x !== undefined);
  return {
    name,
    count,
    sum,
    value: pointValue(sum, count, config),
    ...(ordered.length ? { x: (ordered[0].x! + ordered[ordered.length - 1].x!) / 2 } : {}),
  };
}

function sampleContinuous(points: ChartPoint[], limit: number): ChartPoint[] {
  if (points.length <= limit) return points;
  // select original extremes without changing values or either endpoint.
  const sampled = new Set<ChartPoint>([points[0], points[points.length - 1]]);
  const bucketCount = Math.floor((limit - 2) / 2);
  const width = (points.length - 2) / bucketCount;
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = 1 + Math.floor(bucket * width);
    const end = bucket === bucketCount - 1 ? points.length - 1 : 1 + Math.floor((bucket + 1) * width);
    let lowest = points[start];
    let highest = points[start];
    for (let index = start + 1; index < end; index += 1) {
      if (points[index].value < lowest.value) lowest = points[index];
      if (points[index].value > highest.value) highest = points[index];
    }
    sampled.add(lowest);
    sampled.add(highest);
  }
  return [...sampled].sort((a, b) => a.x! - b.x!);
}

function histogram(rows: DataRow[], config: ChartConfig): ChartSeries {
  const values = rows.map((row) => numeric(row[config.xKey])).filter((value): value is number => value !== null);
  const base = { validRows: values.length, skippedRows: rows.length - values.length, xIsDate: false, xIsNumeric: true };
  if (!values.length) return { ...base, points: [], totalGroups: 0, reductionNote: null };
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  const binCount = min === max ? 1 : Math.min(20, Math.max(2, Math.ceil(Math.log2(values.length) + 1)));
  const width = min === max ? 1 : (max - min) / binCount;
  const binFormatter = new Intl.NumberFormat('en', { maximumFractionDigits: Math.min(12, Math.max(2, Math.ceil(-Math.log10(width)) + 1)) });
  const points = Array.from({ length: binCount }, (_, index): ChartPoint => {
    const low = min + index * width;
    const high = min === max ? max : index === binCount - 1 ? max : min + (index + 1) * width;
    return { name: min === max ? formatChartNumber(min) : `${binFormatter.format(low)} – ${binFormatter.format(high)}`, value: 0, count: 0, sum: 0, x: (low + high) / 2, low, high };
  });
  // keep the maximum value inside the final bin.
  for (const value of values) {
    const index = Math.min(binCount - 1, Math.floor((value - min) / width));
    points[index].value += 1;
    points[index].count += 1;
    points[index].sum += value;
  }
  const note = base.skippedRows ? `${base.skippedRows.toLocaleString()} rows without a numeric ${chartLabel(config.xKey)} value excluded.` : null;
  return { ...base, points, totalGroups: binCount, reductionNote: note };
}

function scatter(rows: DataRow[], config: ChartConfig, reduce: boolean): ChartSeries {
  let points: ChartPoint[] = [];
  for (const row of rows) {
    const x = numeric(row[config.xKey]);
    const y = numeric(row[config.yKey]);
    if (x !== null && y !== null) points.push({ name: formatChartNumber(x), x, y, value: y, count: 1, sum: y });
  }
  const validRows = points.length;
  const skippedRows = rows.length - validRows;
  const notes: string[] = [];
  if (reduce && points.length > 1_200) {
    // preserve horizontal coverage and vertical extremes within each interval.
    points.sort((a, b) => a.x! - b.x!);
    const sampled = new Set<ChartPoint>([points[0], points[points.length - 1]]);
    const step = points.length / 599;
    for (let index = 0; index < 599; index += 1) {
      const start = Math.floor(index * step);
      const end = Math.floor((index + 1) * step);
      let lowest = points[start];
      let highest = points[start];
      for (let cursor = start + 1; cursor < end; cursor += 1) {
        if (points[cursor].y! < lowest.y!) lowest = points[cursor];
        if (points[cursor].y! > highest.y!) highest = points[cursor];
      }
      sampled.add(lowest);
      sampled.add(highest);
    }
    points = [...sampled].sort((a, b) => a.x! - b.x!);
    notes.push(`Showing ${points.length.toLocaleString()} sampled points from ${validRows.toLocaleString()} valid rows; interval extremes preserved.`);
  }
  if (skippedRows) notes.push(`${skippedRows.toLocaleString()} rows without two numeric values excluded.`);
  return { points, validRows, skippedRows, totalGroups: validRows, xIsDate: false, xIsNumeric: true, reductionNote: notes.join(' ') || null };
}

export function buildSeries(rows: DataRow[], config: ChartConfig, options: { reduce?: boolean } = {}): ChartSeries {
  // reduction affects display sampling and overflow groups, not histogram bins.
  const reduce = options.reduce !== false;
  if (config.type === 'histogram') return histogram(rows, config);
  if (config.type === 'scatter') return scatter(rows, config, reduce);
  const presentValues = rows.map((row) => row[config.xKey]).filter((value) => !isMissing(value));
  const xIsDate = presentValues.length > 0 && presentValues.every((value) => dateValue(value) !== null);
  const xIsNumeric = !xIsDate && presentValues.length > 0 && presentValues.every((value) => numeric(value) !== null);
  const isContinuous = (config.type === 'line' || config.type === 'area') && (xIsDate || xIsNumeric);
  const groups = new Map<string, ChartPoint>();
  let validRows = 0;
  for (const row of rows) {
    const rawX = row[config.xKey];
    if (isContinuous && isMissing(rawX)) continue;
    const y = numeric(row[config.yKey]);
    if (config.aggregation !== 'count' && y === null) continue;
    const name = isMissing(rawX) ? '(Missing)' : String(rawX);
    const x = xIsDate ? dateValue(rawX) : xIsNumeric ? numeric(rawX) : null;
    const key = isMissing(rawX) ? '__missing__' : x !== null ? `value:${x}` : `text:${name}`;
    const point = groups.get(key) ?? { name, value: 0, count: 0, sum: 0, ...(x === null ? {} : { x }) };
    point.count += 1;
    point.sum += y ?? 0;
    point.value = pointValue(point.sum, point.count, config);
    groups.set(key, point);
    validRows += 1;
  }
  let points = [...groups.values()];
  const totalGroups = points.length;
  const notes: string[] = [];
  if (xIsDate || xIsNumeric) points.sort((a, b) => (a.x ?? Infinity) - (b.x ?? Infinity));
  else if (config.type === 'bar' || config.type === 'pie') points.sort((a, b) => b.value - a.value);
  const limit = config.type === 'pie' ? 7 : config.type === 'bar' ? 24 : 180;
  if (reduce && points.length > limit && isContinuous) {
    points = sampleContinuous(points, limit);
    notes.push(`Showing ${points.length.toLocaleString()} sampled points from ${totalGroups.toLocaleString()} distinct values; original values and interval extremes preserved, all ${validRows.toLocaleString()} valid rows analyzed.`);
  } else if (reduce && points.length > limit) {
    const remainder = points.slice(limit - 1);
    points = [...points.slice(0, limit - 1), mergePoints(remainder, `Other (${remainder.length} groups)`, config)];
    notes.push(`${remainder.length.toLocaleString()} groups combined into “Other”; all valid rows included.`);
  }
  const skippedRows = rows.length - validRows;
  if (skippedRows) notes.push(`${skippedRows.toLocaleString()} rows with missing or nonnumeric chart values excluded.`);
  return { points, validRows, skippedRows, totalGroups, xIsDate, xIsNumeric, reductionNote: notes.join(' ') || null };
}
