import { describe, expect, it } from 'vitest';
import { applyFilters, defaultConfig, parseDataset, recommendCharts } from '../src/lib/data';
import type { DataRow, FilterRule } from '../src/types';

describe('dataset import', () => {
  it('reads quoted delimiters, newlines, missing cells, and a byte order mark', () => {
    const result = parseDataset('\uFEFFname,revenue,notes\r\n"Acme, Inc.",0,"first line\nsecond line"\r\nBeta,-12.5,', 'sales.csv');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ name: 'Acme, Inc.', revenue: 0, notes: 'first line\nsecond line' });
    expect(result.rows[1].revenue).toBe(-12.5);
    expect(result.columns.find((column) => column.key === 'revenue')).toMatchObject({ type: 'number', unique: 2 });
    expect(result.rows[1].notes).toBeNull();
  });

  it('makes blank and repeated headers distinct without overwriting values', () => {
    const result = parseDataset('name,name,name_2,\nAda,Grace,Linus,4', 'people.csv');
    expect(result.columns.map((column) => column.key)).toEqual(['name', 'name_2', 'name_2_2', 'Column 4']);
    expect(Object.values(result.rows[0])).toEqual(['Ada', 'Grace', 'Linus', 4]);
  });

  it('supports tabs, semicolons, and single-column data', () => {
    expect(parseDataset('city\tamount\nPrague\t12', 'cities.tsv').rows[0]).toEqual({ city: 'Prague', amount: 12 });
    expect(parseDataset('city;amount\nPrague;12', 'cities.csv').rows[0]).toEqual({ city: 'Prague', amount: 12 });
    expect(parseDataset('city\nPrague\nBerlin', 'cities.csv').rows).toHaveLength(2);
  });

  it('infers numbers and real ISO dates while keeping mixed columns as text', () => {
    const result = parseDataset('day,amount,mixed,invalid_day\n2025-02-28,0,1,2025-02-30\n2025-03-01,-3e2,unknown,2025-03-01', 'data.csv');
    expect(result.columns.map((column) => column.type)).toEqual(['date', 'number', 'text', 'text']);
    expect(result.rows[1].amount).toBe(-300);
    expect(result.rows[0].mixed).toBe('1');
  });

  it('preserves padded and unsafe integer identifiers exactly as text', () => {
    const result = parseDataset('id,large_id,safe_number\n00123,9007199254740992,-12\n123,9007199254740993,0', 'identifiers.csv');
    expect(result.columns.map((column) => column.type)).toEqual(['text', 'text', 'number']);
    expect(result.rows[0]).toEqual({ id: '00123', large_id: '9007199254740992', safe_number: -12 });
    expect(result.rows[1].large_id).toBe('9007199254740993');
    expect(result.columns[1].unique).toBe(2);
    const json = parseDataset('[{"id":"00001","value":"9007199254740993"}]', 'identifiers.json');
    expect(json.rows[0]).toEqual({ id: '00001', value: '9007199254740993' });
    expect(parseDataset('value\n9007199254740991', 'safe.csv').rows[0].value).toBe(9007199254740991);
  });

  it('treats absent JSON properties as missing even when a key names a prototype field', () => {
    const result = parseDataset('[{"toString":"first"},{"other":1}]', 'reserved.json');
    expect(result.rows[0]).toEqual({ toString: 'first', other: null });
    expect(result.rows[1]).toEqual({ toString: null, other: 1 });
  });

  it('unifies JSON keys and handles missing fields and wrappers', () => {
    const result = parseDataset('{"data":[{"region":"Europe","orders":0},{"orders":12,"active":true}]}', 'data.json');
    expect(result.columns.map((column) => column.key)).toEqual(['region', 'orders', 'active']);
    expect(result.rows[0]).toEqual({ region: 'Europe', orders: 0, active: null });
    expect(result.rows[1]).toEqual({ region: null, orders: 12, active: 'true' });
    expect(result.rows[1].region).toBeNull();
    expect(parseDataset('{"rows":[{"value":1}]}', 'data.json').rows[0].value).toBe(1);
  });

  it.each([
    ['', 'empty.csv', /empty/i],
    ['name,value', 'empty.csv', /no data rows/i],
    ['{"data":', 'invalid.json', /invalid/i],
    ['[]', 'empty.json', /no data rows/i],
    ['[1,2]', 'invalid.json', /must be an object/i],
    ['[{"nested":{"value":2}}]', 'invalid.json', /flatten nested/i],
    ['name,value\n"unclosed,2', 'invalid.csv', /quoted/i],
    ['name,value\nA,2,3', 'invalid.csv', /row 2 has 3 values/i],
  ])('rejects an unusable file with a clear error', (text, filename, message) => {
    expect(() => parseDataset(text, filename)).toThrow(message);
  });

  it('caps pasted content by utf-8 byte size before parsing', () => {
    expect(() => parseDataset('a'.repeat(10 * 1024 * 1024 + 1), 'large.csv')).toThrow(/10 MB/);
    expect(() => parseDataset('é'.repeat(5 * 1024 * 1024 + 1), 'large.csv')).toThrow(/10 MB/);
  });

  it('rejects sparse JSON when its union of fields exceeds the column limit', () => {
    const sparse = Array.from({ length: 101 }, (_, index) => ({ [`field_${index}`]: index }));
    expect(() => parseDataset(JSON.stringify(sparse), 'sparse.json')).toThrow(/100 columns/);
  });

  it('enforces row and column limits before rendering a dataset', () => {
    expect(() => parseDataset(`value\n${Array(50_001).fill('1').join('\n')}`, 'large.csv')).toThrow(/50,000/);
    const headers = Array.from({ length: 101 }, (_, index) => `column_${index}`).join(',');
    expect(() => parseDataset(`${headers}\n${Array(101).fill('1').join(',')}`, 'wide.csv')).toThrow(/100 columns/);
  });
});

describe('filtering', () => {
  const rows: DataRow[] = [
    { region: 'Europe', revenue: 0, date: '2025-03-01T00:00:00Z' },
    { region: 'Europe', revenue: 25, date: '2025-03-01T23:59:59Z' },
    { region: 'Americas', revenue: -10, date: '2025-03-02T00:00:00Z' },
    { region: 'Europe', revenue: null, date: null },
  ];

  it('combines category selection and inclusive numeric bounds', () => {
    const rules: FilterRule[] = [
      { id: 'region', column: 'region', kind: 'text', values: ['Europe'] },
      { id: 'revenue', column: 'revenue', kind: 'number', min: '0', max: '25' },
    ];
    expect(applyFilters(rows, rules)).toEqual(rows.slice(0, 2));
    expect(rows).toHaveLength(4);
  });

  it('includes the entire upper-bound date, and excludes missing values', () => {
    expect(applyFilters(rows, [{ id: 'date', column: 'date', kind: 'date', min: '2025-03-01', max: '2025-03-01' }])).toEqual(rows.slice(0, 2));
  });

  it('leaves inactive rules unfiltered and supports a negative upper bound', () => {
    expect(applyFilters(rows, [{ id: 'revenue', column: 'revenue', kind: 'number', min: '', max: '' }])).toEqual(rows);
    expect(applyFilters(rows, [{ id: 'revenue', column: 'revenue', kind: 'number', max: '-1' }])).toEqual([rows[2]]);
    expect(applyFilters(rows, [{ id: 'region', column: 'region', kind: 'text', values: [] }])).toEqual(rows);
  });
});

describe('chart recommendations', () => {
  it('chooses date axes for trends and numeric axes for distributions and relationships', () => {
    const { columns } = parseDataset('date,region,revenue,orders\n2025-03-01,Europe,120,4\n2025-03-02,Americas,180,6', 'sales.csv');
    expect(defaultConfig('area', columns)).toEqual({ type: 'area', xKey: 'date', yKey: 'revenue', aggregation: 'sum' });
    expect(defaultConfig('scatter', columns)).toMatchObject({ xKey: 'revenue', yKey: 'orders' });
    expect(defaultConfig('histogram', columns).xKey).toBe('revenue');
    expect(recommendCharts(columns)).toEqual(['line', 'area', 'bar', 'scatter', 'pie', 'histogram']);
  });

  it('offers line charts and distinct axes for two numeric columns', () => {
    const { columns } = parseDataset('x,y\n1,3\n2,5\n3,7', 'data.csv');
    expect(recommendCharts(columns)).toEqual(['line', 'area', 'scatter', 'histogram']);
    expect(defaultConfig('line', columns)).toMatchObject({ xKey: 'x', yKey: 'y' });
  });

  it('uses counts when a dataset has only categories', () => {
    const { columns } = parseDataset('region\nEurope\nEurope\nAmericas', 'regions.csv');
    expect(recommendCharts(columns)).toEqual(['bar', 'pie']);
    expect(defaultConfig('bar', columns)).toMatchObject({ xKey: 'region', yKey: '', aggregation: 'count' });
  });
});
