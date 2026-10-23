import { describe, expect, it } from 'vitest';
import { lastDaysWindow, windowValue, xExtent, zoomWindow } from '../src/lib/window';

describe('chart windows', () => {
  it('ignores empty coordinates without replacing them with zero', () => {
    expect(xExtent([{ x: null }, { x: 4 }, { x: 9 }, { x: Infinity }], 'x', 'number')).toEqual({ min: 4, max: 9 });
    expect(xExtent([{ x: 'a' }], 'x', 'text')).toBeNull();
  });

  it('zooms around the selected numeric center and clamps to the dataset', () => {
    const extent = { min: -100, max: 100 };
    expect(zoomWindow(extent, { min: '', max: '' }, 'number', .5)).toEqual({ min: '-50', max: '50' });
    expect(zoomWindow(extent, { min: '50', max: '100' }, 'number', 4)).toEqual({ min: '-100', max: '100' });
  });

  it('retains constant numeric ranges', () => {
    expect(zoomWindow({ min: 7, max: 7 }, { min: '', max: '' }, 'number', .5)).toEqual({ min: '7', max: '7' });
  });

  it('anchors preset windows to the data rather than the current date', () => {
    const extent = { min: Date.parse('2020-01-01'), max: Date.parse('2020-03-01T23:30:00Z') };
    expect(lastDaysWindow(extent, 7)).toEqual({ min: '2020-02-24', max: '2020-03-01' });
    expect(lastDaysWindow(extent, 365)).toEqual({ min: '2020-01-01', max: '2020-03-01' });
  });

  it('keeps inclusive date ranges to at least one day', () => {
    const extent = { min: Date.parse('2026-01-01'), max: Date.parse('2026-01-10') };
    const zoomed = zoomWindow(extent, { min: '', max: '' }, 'date', .5);
    expect((Date.parse(zoomed.max) - Date.parse(zoomed.min)) / 86400000 + 1).toBe(5);
    expect(zoomWindow(extent, { min: '2026-01-04', max: '2026-01-04' }, 'date', .5)).toEqual({ min: '2026-01-04', max: '2026-01-04' });
  });

  it('normalizes timestamps without zones as utc', () => {
    expect(xExtent([{ x: '2026-01-01T12:00:00' }], 'x', 'date')).toEqual({ min: Date.parse('2026-01-01T12:00:00Z'), max: Date.parse('2026-01-01T12:00:00Z') });
    expect(windowValue(1e-20, 'number')).toBe('1e-20');
  });
});
