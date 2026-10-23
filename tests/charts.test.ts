import { describe, expect, it } from 'vitest';
import { buildSeries, formatChartDate } from '../src/lib/charts';
import type { ChartConfig } from '../src/types';

const config: ChartConfig = { type: 'bar', xKey: 'group', yKey: 'amount', aggregation: 'sum' };

describe('chart aggregation', () => {
  it('sums finite metrics and groups missing categories', () => {
    const result = buildSeries([
      { group: 'A', amount: 10 },
      { group: 'A', amount: 20 },
      { group: null, amount: 4 },
      { group: '', amount: 1 },
      { group: 'B', amount: null },
      { group: 'B', amount: 'invalid' },
    ], config);
    expect(result.points.map(({ name, value }) => ({ name, value }))).toEqual([{ name: 'A', value: 30 }, { name: '(Missing)', value: 5 }]);
    expect(result.skippedRows).toBe(2);
    expect(result.validRows).toBe(4);
  });

  it('counts records even when the metric is missing', () => {
    const result = buildSeries([{ group: 'A', amount: null }, { group: 'A', amount: 0 }], { ...config, aggregation: 'count' });
    expect(result.points[0].value).toBe(2);
    expect(result.skippedRows).toBe(0);
  });

  it('keeps averages weighted when combining overflow groups', () => {
    const rows = Array.from({ length: 30 }, (_, group) => Array.from({ length: group + 1 }, () => ({ group: `Group ${group}`, amount: group }))).flat();
    const result = buildSeries(rows, { ...config, aggregation: 'average' });
    const other = result.points.find((point) => point.name.startsWith('Other'))!;
    expect(result.points).toHaveLength(24);
    expect(other.value).toBeCloseTo(other.sum / other.count);
    expect(result.points.reduce((total, point) => total + point.count, 0)).toBe(rows.length);
    expect(result.reductionNote).toContain('all valid rows included');
  });

  it('sorts dates and selects exact aggregate values while preserving endpoints', () => {
    const rows = Array.from({ length: 400 }, (_, day) => ({ group: new Date(Date.UTC(2024, 0, day + 1)).toISOString().slice(0, 10), amount: day })).reverse();
    const result = buildSeries(rows, { ...config, type: 'line' });
    expect(result.xIsDate).toBe(true);
    expect(result.points.length).toBeLessThanOrEqual(180);
    expect(result.points[0]).toMatchObject({ name: rows.at(-1)!.group, value: 0 });
    expect(result.points.at(-1)).toMatchObject({ name: rows[0].group, value: 399 });
    expect(result.points.every((point, index) => !index || point.x! > result.points[index - 1].x!)).toBe(true);
    expect(result.points.every((point) => rows.some((row) => row.group === point.name && row.amount === point.value))).toBe(true);
    expect(result.validRows).toBe(400);
    expect(result.totalGroups).toBe(400);
    expect(result.reductionNote).toContain('sampled points');
    expect(result.reductionNote).toContain('all 400 valid rows analyzed');
  });

  it('does not invent a final drop in a large constant sum series', () => {
    const rows = Array.from({ length: 2_500 }, (_, group) => Array.from({ length: 4 }, () => ({ group, amount: 12.5 }))).flat();
    const result = buildSeries(rows, { ...config, type: 'line' });
    expect(result.points.length).toBeLessThanOrEqual(180);
    expect(result.points.every((point) => point.value === 50 && point.sum === 50 && point.count === 4)).toBe(true);
    expect(result.points[0].x).toBe(0);
    expect(result.points.at(-1)?.x).toBe(2_499);
    expect(result.validRows).toBe(10_000);
    expect(result.totalGroups).toBe(2_500);
  });

  it('keeps a large monotonic sum series monotonic through its exact last value', () => {
    const rows = Array.from({ length: 2_500 }, (_, group) => [{ group, amount: group + 1 }, { group, amount: group + 1 }]).flat();
    const result = buildSeries(rows, { ...config, type: 'area' });
    expect(result.points[0].value).toBe(2);
    expect(result.points.at(-1)?.value).toBe(5_000);
    expect(result.points.every((point, index) => !index || point.value > result.points[index - 1].value)).toBe(true);
    expect(result.points.every((point) => point.value === 2 * (point.x! + 1))).toBe(true);
  });

  it('preserves short spikes and troughs during continuous sampling', () => {
    const rows = Array.from({ length: 2_500 }, (_, group) => ({ group, amount: group === 1_111 ? -50_000 : group === 1_112 ? 90_000 : 10 }));
    const result = buildSeries(rows, { ...config, type: 'line' });
    expect(result.points.some((point) => point.x === 1_111 && point.value === -50_000)).toBe(true);
    expect(result.points.some((point) => point.x === 1_112 && point.value === 90_000)).toBe(true);
  });

  it.each([0, 1, 2, 180, 181])('handles %i continuous groups without changing their values', (length) => {
    const rows = Array.from({ length }, (_, group) => ({ group, amount: group + 2 }));
    const result = buildSeries(rows, { ...config, type: 'line' });
    expect(result.points.length).toBeLessThanOrEqual(180);
    expect(result.points.every((point) => point.value === point.x! + 2)).toBe(true);
    if (length) {
      expect(result.points[0].x).toBe(0);
      expect(result.points.at(-1)?.x).toBe(length - 1);
    }
    if (length <= 180) expect(result.points).toHaveLength(length);
  });

  it.each(['sum', 'average', 'count'] as const)('returns all original %s aggregates when reduction is disabled', (aggregation) => {
    const rows = Array.from({ length: 400 }, (_, group) => [{ group, amount: group }, { group, amount: group + 2 }]).flat();
    const result = buildSeries(rows, { ...config, type: 'line', aggregation }, { reduce: false });
    expect(result.points).toHaveLength(400);
    expect(result.points.every((point) => point.count === 2 && point.sum === 2 * point.x! + 2)).toBe(true);
    expect(result.points.every((point) => point.value === (aggregation === 'sum' ? 2 * point.x! + 2 : aggregation === 'average' ? point.x! + 1 : 2))).toBe(true);
    expect(result.points.reduce((total, point) => total + point.sum, 0)).toBe(rows.reduce((total, row) => total + row.amount, 0));
    expect(result.points.reduce((total, point) => total + point.count, 0)).toBe(rows.length);
    expect(result.reductionNote).toBeNull();
  });

  it('returns every category when reduction is disabled', () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ group: `Group ${index}`, amount: index }));
    expect(buildSeries(rows, config, { reduce: false }).points).toHaveLength(30);
  });

  it('keeps padded and unsafe integer identifiers distinct and categorical', () => {
    const rows = [{ group: '00123', amount: 1 }, { group: '123', amount: 2 }, { group: '9007199254740992', amount: 3 }, { group: '9007199254740993', amount: 4 }];
    const result = buildSeries(rows, { ...config, type: 'line' });
    expect(result.xIsNumeric).toBe(false);
    expect(result.points.map((point) => point.name)).toEqual(rows.map((row) => row.group));
    expect(result.points.map((point) => point.value)).toEqual([1, 2, 3, 4]);
  });

  it('keeps valid numeric text sortable without treating hexadecimal text as numbers', () => {
    const result = buildSeries([{ group: '3.5', amount: 1 }, { group: '1.2', amount: 1 }], { ...config, type: 'line' });
    expect(result.xIsNumeric).toBe(true);
    expect(result.points.map((point) => point.x)).toEqual([1.2, 3.5]);
    expect(buildSeries([{ group: '0xFF', amount: 1 }], { ...config, type: 'line' }).xIsNumeric).toBe(false);
  });
});

describe('date labels', () => {
  it('includes years when requested for long time spans', () => {
    const date = Date.UTC(2024, 0, 5);
    expect(formatChartDate(date)).toBe('Jan 5');
    expect(formatChartDate(date, true)).toBe('Jan 5, 2024');
  });
});

describe('histograms', () => {
  it('includes both boundaries and conserves numeric observations', () => {
    const result = buildSeries([{ amount: 0 }, { amount: 1 }, { amount: 2 }, { amount: 3 }, { amount: 4 }, { amount: null }], { ...config, type: 'histogram', xKey: 'amount' });
    expect(result.points[0].low).toBe(0);
    expect(result.points.at(-1)?.high).toBe(4);
    expect(result.points.at(-1)?.count).toBeGreaterThan(0);
    expect(result.points.reduce((total, point) => total + point.count, 0)).toBe(5);
    expect(result.skippedRows).toBe(1);
  });

  it('uses one bin for constant data', () => {
    const result = buildSeries([{ amount: 7 }, { amount: 7 }], { ...config, type: 'histogram', xKey: 'amount' });
    expect(result.points).toHaveLength(1);
    expect(result.points[0].value).toBe(2);
  });
});

describe('scatter plots', () => {
  it('excludes missing and nonfinite coordinates', () => {
    const result = buildSeries([{ group: 1, amount: 2 }, { group: null, amount: 3 }, { group: 2, amount: Infinity }, { group: '', amount: 9 }], { ...config, type: 'scatter' });
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ x: 1, y: 2 });
    expect(result.skippedRows).toBe(3);
  });

  it('caps large plots while preserving extremes and disclosing sampling', () => {
    const rows = Array.from({ length: 5_000 }, (_, index) => ({ group: index, amount: index === 2_111 ? -100_000 : index % 15 }));
    const result = buildSeries(rows, { ...config, type: 'scatter' });
    expect(result.points.length).toBeLessThanOrEqual(1_200);
    expect(result.points.some((point) => point.y === -100_000)).toBe(true);
    expect(result.validRows).toBe(5_000);
    expect(result.reductionNote).toContain('sampled points');
  });

  it('returns every valid scatter point when reduction is disabled', () => {
    const rows = Array.from({ length: 1_500 }, (_, group) => ({ group, amount: group }));
    const result = buildSeries(rows, { ...config, type: 'scatter' }, { reduce: false });
    expect(result.points).toHaveLength(1_500);
    expect(result.reductionNote).toBeNull();
  });
});
