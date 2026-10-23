import { describe, expect, it } from 'vitest';
import { renderToString } from 'katex';
import { buildSeries } from '../src/lib/charts';
import { fitFunction } from '../src/lib/fit';
import type { ChartConfig, DataRow, FitType } from '../src/types';

const config: ChartConfig = { type: 'scatter', xKey: 'x', yKey: 'y', aggregation: 'sum' };
const rowsFor = (xs: number[], fn: (x: number) => number): DataRow[] => xs.map((x) => ({ x, y: fn(x) }));

describe('function fitting', () => {
  const models: { type: FitType; xs: number[]; fn: (x: number) => number; latex: string }[] = [
    { type: 'linear', xs: [-3, -1, 0, 2, 5], fn: (x) => 2 * x + 3, latex: 'x' },
    { type: 'quadratic', xs: [-3, -1, 0, 2, 5], fn: (x) => 2 * x * x - 3 * x + 4, latex: 'x^{2}' },
    { type: 'cubic', xs: [-3, -1, 0, 2, 5], fn: (x) => -0.5 * x ** 3 + 2 * x * x - x + 4, latex: 'x^{3}' },
    { type: 'exponential', xs: [-3, -1, 0, 2, 5], fn: (x) => 3 * Math.exp(0.4 * x), latex: 'e^{' },
    { type: 'logarithmic', xs: [0.2, 0.5, 1, 3, 8], fn: (x) => 5 - 2 * Math.log(x), latex: '\\ln(x)' },
    { type: 'power', xs: [0.2, 0.5, 1, 3, 8], fn: (x) => 4 * x ** 1.5, latex: 'x^{' },
  ];

  it.each(models)('recovers a known $type function across the full interval', ({ type, xs, fn, latex }) => {
    const { result, error } = fitFunction(rowsFor(xs, fn), config, type);
    expect(error).toBeNull();
    expect(result).not.toBeNull();
    expect(result!.points).toHaveLength(160);
    expect(result!.points[0].x).toBe(xs[0]);
    expect(result!.points.at(-1)!.x).toBe(xs.at(-1));
    for (const point of result!.points) expect(point.y).toBeCloseTo(fn(point.x), 9);
    expect(result!.rSquared).toBeCloseTo(1, 12);
    expect(result!.sampleCount).toBe(xs.length);
    expect(result!.equation).toContain(latex);
    expect(() => renderToString(result!.equation, { throwOnError: true })).not.toThrow();
  });

  it('formats coefficient signs without invalid doubled signs', () => {
    const { result } = fitFunction(rowsFor([-3, -1, 0, 2, 4], (x) => -2 * x * x - 3 * x + 4), config, 'quadratic');
    expect(result!.equation).toBe('\\hat{y} = -2\\,x^{2} - 3\\,x + 4');
    expect(result!.equation).not.toContain('+ -');
  });

  it('formats scientific notation as latex', () => {
    const { result } = fitFunction(rowsFor([0, 1, 2, 3], (x) => 2e-9 * x + 3e-9), config, 'linear');
    expect(result!.equation).toContain('2\\times 10^{-9}');
    expect(result!.equation).toContain('3\\times 10^{-9}');
    expect(() => renderToString(result!.equation, { throwOnError: true })).not.toThrow();
  });

  it('preserves small coefficients with a meaningful contribution on a large axis', () => {
    const { result, error } = fitFunction(rowsFor([0, 2e5, 4e5, 6e5, 8e5, 1e6], (x) => 1 + 1e-16 * x ** 3), config, 'cubic');
    expect(error).toBeNull();
    expect(result!.equation).toContain('1\\times 10^{-16}\\,x^{3}');
    expect(result!.equation).toContain(' + 1');
    expect(() => renderToString(result!.equation, { throwOnError: true })).not.toThrow();
  });

  it('centers large numeric axes and explains the normalized variable', () => {
    const start = 1e12;
    const { result, error } = fitFunction(rowsFor([0, 1, 2, 3, 4, 5].map((offset) => start + offset), (x) => 3 * (x - start) ** 3 - 2 * (x - start) + 7), config, 'cubic');
    expect(error).toBeNull();
    expect(result!.equation).toContain('z = \\frac{');
    expect(result!.equation).toContain('z^{3}');
    expect(() => renderToString(result!.equation, { throwOnError: true })).not.toThrow();
    for (const point of result!.points) expect(point.y).toBeCloseTo(3 * (point.x - start) ** 3 - 2 * (point.x - start) + 7, 8);
  });

  it('handles very small coordinate scales without solving normal equations', () => {
    const { result, error } = fitFunction(rowsFor([-2e-100, -1e-100, 0, 1e-100, 2e-100], (x) => (x / 1e-100) ** 2 + 2), config, 'quadratic');
    expect(error).toBeNull();
    for (const point of result!.points) expect(point.y).toBeCloseTo((point.x / 1e-100) ** 2 + 2, 10);
  });

  it('fits all original scatter pairs before display sampling', () => {
    const rows = Array.from({ length: 5_000 }, (_, index) => ({ x: index, y: 3 * index + (index % 3 ? 4 : -5) }));
    const displayed = buildSeries(rows, config);
    expect(displayed.points.length).toBeLessThan(1_200);
    const { result, error } = fitFunction(rows, config, 'linear');
    expect(error).toBeNull();
    expect(result!.sampleCount).toBe(5_000);
    const meanX = rows.reduce((total, row) => total + row.x, 0) / rows.length;
    const meanY = rows.reduce((total, row) => total + row.y, 0) / rows.length;
    const slope = rows.reduce((total, row) => total + (row.x - meanX) * (row.y - meanY), 0) / rows.reduce((total, row) => total + (row.x - meanX) ** 2, 0);
    const intercept = meanY - slope * meanX;
    expect(result!.points[0].y).toBeCloseTo(intercept, 9);
    expect(result!.points.at(-1)!.y).toBeCloseTo(intercept + slope * 4_999, 8);
  });

  it('uses per-x aggregates for line fitting', () => {
    const rows = [{ x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 3 }, { x: 2, y: 3 }, { x: 2, y: 4 }];
    const { result } = fitFunction(rows, { ...config, type: 'line' }, 'linear');
    expect(result!.sampleCount).toBe(3);
    expect(result!.points[0].y).toBeCloseTo(3, 12);
    expect(result!.points.at(-1)!.y).toBeCloseTo(7, 12);
    expect(result!.equation).toBe('\\hat{y} = 2\\,x + 3');
  });

  it('fits every per-x aggregate of a large area chart before display sampling', () => {
    const rows = rowsFor(Array.from({ length: 400 }, (_, index) => index), (x) => 2 * x + 1);
    const areaConfig: ChartConfig = { ...config, type: 'area', aggregation: 'average' };
    const series = buildSeries(rows, areaConfig);
    const { result } = fitFunction(rows, areaConfig, 'linear');
    expect(series.points.length).toBeLessThan(rows.length);
    expect(result!.sampleCount).toBe(rows.length);
    expect(result!.points[0].x).toBe(0);
    expect(result!.points.at(-1)!.x).toBe(399);
    for (const point of result!.points) expect(point.y).toBeCloseTo(2 * point.x + 1, 9);
  });

  it.each([
    { type: 'line', aggregation: 'sum' },
    { type: 'area', aggregation: 'average' },
  ] as const)('keeps $type regression independent of display sampling', ({ type, aggregation }) => {
    const aggregates = Array.from({ length: 725 }, (_, x) => ({ x, y: 3 * x + 10 + (x % 17 === 0 ? 2_000 : 0) }));
    const rows = aggregates.flatMap(({ x, y }) => [{ x, y: y - 2 }, { x, y: y + 2 }]);
    const chartConfig: ChartConfig = { ...config, type, aggregation };
    const displayed = buildSeries(rows, chartConfig);
    expect(displayed.points.length).toBeLessThan(aggregates.length);
    const expected = aggregates.map(({ x, y }) => ({ x, y: aggregation === 'sum' ? 2 * y : y }));
    const meanX = expected.reduce((total, point) => total + point.x, 0) / expected.length;
    const meanY = expected.reduce((total, point) => total + point.y, 0) / expected.length;
    const slope = expected.reduce((total, point) => total + (point.x - meanX) * (point.y - meanY), 0) / expected.reduce((total, point) => total + (point.x - meanX) ** 2, 0);
    const intercept = meanY - slope * meanX;
    const { result, error } = fitFunction(rows, chartConfig, 'linear');
    expect(error).toBeNull();
    expect(result!.sampleCount).toBe(expected.length);
    for (const point of result!.points) expect(point.y).toBeCloseTo(intercept + slope * point.x, 9);
  });

  it('uses aggregated counts when that metric is displayed', () => {
    const rows = Array.from({ length: 4 }, (_, x) => Array.from({ length: 2 * x + 1 }, () => ({ x, y: null }))).flat();
    const { result } = fitFunction(rows, { ...config, type: 'line', aggregation: 'count' }, 'linear');
    expect(result!.sampleCount).toBe(4);
    expect(result!.points[0].y).toBeCloseTo(1, 12);
    expect(result!.points.at(-1)!.y).toBeCloseTo(7, 12);
  });

  it('fits date coordinates in days and returns raw millisecond coordinates', () => {
    const origin = Date.UTC(2026, 0, 1);
    const rows = Array.from({ length: 8 }, (_, day) => ({ x: new Date(origin + day * 86_400_000).toISOString().slice(0, 10), y: 2 * day * day + 3 * day + 4 }));
    const { result, error } = fitFunction(rows, { ...config, type: 'line' }, 'quadratic');
    expect(error).toBeNull();
    expect(result!.equation).toContain('2\\,x^{2} + 3\\,x + 4');
    expect(result!.equation).toContain('x = \\frac{t - \\text{2026-01-01}}{1\\,\\mathrm{day}}');
    expect(() => renderToString(result!.equation, { throwOnError: true })).not.toThrow();
    expect(result!.points[0].x).toBe(origin);
    expect(result!.points.at(-1)!.x).toBe(origin + 7 * 86_400_000);
    for (const point of result!.points) {
      const day = (point.x - origin) / 86_400_000;
      expect(point.y).toBeCloseTo(2 * day * day + 3 * day + 4, 9);
    }
  });

  it('updates the date origin when the filtered rows change', () => {
    const rows = [1, 2, 3, 4].map((day) => ({ x: `2026-01-0${day}`, y: 2 * day + 1 }));
    const { result } = fitFunction(rows.slice(1), { ...config, type: 'line' }, 'linear');
    expect(result!.equation).toContain('2\\,x + 5');
    expect(result!.equation).toContain('\\text{2026-01-02}');
  });

  it('measures exponential fit quality on the original y scale', () => {
    const rows = [{ x: 0, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 8 }];
    const { result } = fitFunction(rows, config, 'exponential');
    const intercept = Math.log(1) + (Math.log(2) - Math.log(8) / 2) / 3;
    const slope = Math.log(8) / 2;
    const mean = 11 / 3;
    const sse = rows.reduce((total, row) => total + (row.y - Math.exp(intercept + slope * row.x)) ** 2, 0);
    const sst = rows.reduce((total, row) => total + (row.y - mean) ** 2, 0);
    expect(result!.rSquared).toBeCloseTo(1 - sse / sst, 12);
  });

  it.each(['linear', 'quadratic', 'cubic', 'exponential', 'logarithmic', 'power'] as const)('gives a perfect constant-y $type fit an R squared of one', (type) => {
    const { result, error } = fitFunction(rowsFor([1, 2, 3, 4, 5], () => 7), config, type);
    expect(error).toBeNull();
    expect(result!.rSquared).toBe(1);
    for (const point of result!.points) expect(point.y).toBeCloseTo(7, 11);
  });

  it('keeps duplicate x scatter observations and excludes only nonnumeric pairs', () => {
    const { result } = fitFunction([{ x: '1', y: '3' }, { x: 1, y: 5 }, { x: 2, y: 6 }, { x: null, y: 1 }, { x: 4, y: Infinity }, { x: '001', y: 5 }], config, 'linear');
    expect(result!.sampleCount).toBe(3);
    expect(result!.points[0].y).toBeCloseTo(4, 12);
    expect(result!.points.at(-1)!.y).toBeCloseTo(6, 12);
  });
});

describe('invalid fitting inputs', () => {
  it('disables fitting without an error', () => {
    expect(fitFunction([], config, 'none')).toEqual({ result: null, error: null });
  });

  it.each(['bar', 'pie', 'histogram'] as const)('rejects a $type chart without misleading regression', (type) => {
    expect(fitFunction(rowsFor([1, 2, 3], (x) => x), { ...config, type }, 'linear').error).toContain('line, area, and scatter');
  });

  it('rejects a categorical line axis', () => {
    expect(fitFunction([{ x: 'A', y: 1 }, { x: 'B', y: 2 }], { ...config, type: 'line' }, 'linear').error).toContain('numeric or date');
  });

  it.each([{ type: 'linear', needed: 2 }, { type: 'quadratic', needed: 3 }, { type: 'cubic', needed: 4 }] as const)('requires sufficient distinct coordinates for $type', ({ type, needed }) => {
    const rows = rowsFor(Array.from({ length: needed - 1 }, (_, index) => index), (x) => x).flatMap((row) => [row, row]);
    expect(fitFunction(rows, config, type).error).toContain(`at least ${needed} distinct x values`);
  });

  it('rejects a numerically rank deficient polynomial', () => {
    const { result, error } = fitFunction(rowsFor([0, 1, 1 + Number.EPSILON], (x) => x), config, 'quadratic');
    expect(result).toBeNull();
    expect(error).toContain('too close together');
  });

  it.each(['exponential', 'power'] as const)('rejects every nonpositive y in a $type fit', (type) => {
    for (const y of [0, -1]) {
      const { result, error } = fitFunction([{ x: 1, y: 1 }, { x: 2, y }, { x: 3, y: 9 }], config, type);
      expect(result).toBeNull();
      expect(error).toContain('every y value to be greater than zero');
    }
  });

  it.each(['logarithmic', 'power'] as const)('rejects every nonpositive x in a $type fit', (type) => {
    for (const x of [0, -1]) {
      const { result, error } = fitFunction([{ x, y: 1 }, { x: 2, y: 3 }, { x: 3, y: 9 }], config, type);
      expect(result).toBeNull();
      expect(error).toContain('every x value to be greater than zero');
    }
  });

  it('explains why a logarithmic date fit starts outside its domain', () => {
    const { result, error } = fitFunction([{ x: '2026-01-01', y: 1 }, { x: '2026-01-02', y: 2 }], { ...config, type: 'line' }, 'logarithmic');
    expect(result).toBeNull();
    expect(error).toContain('days since the first date and starts at zero');
  });

  it('rejects aggregate overflow without silently omitting the affected point', () => {
    const { result, error } = fitFunction([{ x: 0, y: 1e308 }, { x: 0, y: 1e308 }, { x: 1, y: 1 }], { ...config, type: 'line' }, 'linear');
    expect(result).toBeNull();
    expect(error).toContain('too large');
  });

  it('rejects exponential predictions that overflow the numeric range', () => {
    const { result, error } = fitFunction([{ x: 0, y: 1e-300 }, { x: 1, y: 1e300 }, { x: 2, y: 1e300 }], config, 'exponential');
    expect(result).toBeNull();
    expect(error).toContain('finite numeric range');
  });
});
