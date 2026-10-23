import { describe, expect, it } from 'vitest';
import { resolveYAxis } from '../src/components/DataChart';
import type { ChartConfig } from '../src/types';

const config: ChartConfig = { type: 'line', xKey: 'x', yKey: 'y', aggregation: 'sum' };

describe('chart Y scale', () => {
  it('keeps a zero baseline and room above positive values by default', () => {
    expect(resolveYAxis([10, 20], config)).toEqual({ domain: [0, 21], scale: 'linear', error: null });
    expect(resolveYAxis([-20, -10], config).domain).toEqual([-21, 0]);
  });

  it('fits the current displayed values with 5% padding', () => {
    expect(resolveYAxis([100, 200], { ...config, yDomain: 'auto' }).domain).toEqual([95, 205]);
    expect(resolveYAxis([-100, -50], { ...config, yDomain: 'auto' }).domain).toEqual([-102.5, -47.5]);
  });

  it('includes all finite fit samples when calculating the visible domain', () => {
    const displayedValues = [10, 20];
    const fitValues = [15, -100, 200, Number.NaN, Number.POSITIVE_INFINITY];
    expect(resolveYAxis([...displayedValues, ...fitValues], { ...config, yDomain: 'auto' }).domain).toEqual([-115, 215]);
  });

  it('gives constant and zero series a nonzero range', () => {
    expect(resolveYAxis([50, 50], { ...config, yDomain: 'auto' }).domain).toEqual([47.5, 52.5]);
    expect(resolveYAxis([0, 0], config).domain).toEqual([0, 1]);
    expect(resolveYAxis([0, 0], { ...config, yDomain: 'auto' }).domain).toEqual([-0.05, 0.05]);
  });

  it('honors finite ordered manual bounds, including a single bound', () => {
    expect(resolveYAxis([10, 20], { ...config, yMin: 12, yMax: 18 }).domain).toEqual([12, 18]);
    expect(resolveYAxis([10, 20], { ...config, yMin: 5 }).domain).toEqual([5, 21]);
    expect(resolveYAxis([10, 20], { ...config, yMin: 30, yMax: 15 }).domain).toEqual([0, 21]);
    expect(resolveYAxis([10, 20], { ...config, yMin: 15, yMax: 15 }).domain).toEqual([0, 21]);
    expect(resolveYAxis([10, 20], { ...config, yMin: Number.NaN, yMax: Number.POSITIVE_INFINITY }).domain).toEqual([0, 21]);
  });

  it('uses positive multiplicative padding for logarithmic scales', () => {
    const axis = resolveYAxis([1, 100], { ...config, yScale: 'log' });
    expect(axis.scale).toBe('log');
    expect(axis.error).toBeNull();
    expect(axis.domain[0]).toBeCloseTo(1 / 100 ** 0.05);
    expect(axis.domain[1]).toBeCloseTo(100 * 100 ** 0.05);
    expect(resolveYAxis([5, 5], { ...config, yScale: 'log' }).domain[0]).toBeGreaterThan(0);
  });

  it('does not silently omit zero or negative data or fit values on log scales', () => {
    for (const values of [[0, 10], [-10, 20], [10, 20, -1]]) {
      expect(resolveYAxis(values, { ...config, yScale: 'log' }).error).toBe('Log scale requires positive values.');
    }
  });

  it('requires positive manual log bounds while preserving valid bounds', () => {
    const axis = resolveYAxis([1, 100], { ...config, yScale: 'log', yMin: 0, yMax: 200 });
    expect(axis.domain[0]).toBeGreaterThan(0);
    expect(axis.domain[1]).toBe(200);
    expect(resolveYAxis([1, 100], { ...config, yScale: 'log', yMin: 2, yMax: 80 }).domain).toEqual([2, 80]);
  });

  it('keeps extreme finite linear data within finite axis bounds', () => {
    const { domain } = resolveYAxis([-1e308, 1e308], { ...config, yDomain: 'auto' });
    expect(domain.every(Number.isFinite)).toBe(true);
    expect(domain[0]).toBeLessThanOrEqual(-1e308);
    expect(domain[1]).toBeGreaterThanOrEqual(1e308);
  });

  it('extends an automatic opposite bound when a manual limit excludes all data', () => {
    expect(resolveYAxis([10, 20], { ...config, yMin: 30 }).domain).toEqual([30, 31.5]);
    expect(resolveYAxis([10, 20], { ...config, yMax: -10 }).domain).toEqual([-10.5, -10]);
  });
});
