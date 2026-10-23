export type Cell = string | number | null;
export type DataRow = Record<string, Cell>;
export type ColumnType = 'number' | 'date' | 'text';

export interface Column {
  key: string;
  type: ColumnType;
  unique: number;
}

export interface Dataset {
  name: string;
  rows: DataRow[];
  columns: Column[];
}

export type ChartType = 'bar' | 'line' | 'area' | 'scatter' | 'pie' | 'histogram';
export type Aggregation = 'sum' | 'average' | 'count';
export type FitType = 'none' | 'linear' | 'quadratic' | 'cubic' | 'exponential' | 'logarithmic' | 'power';

export interface FilterRule {
  id: string;
  column: string;
  kind: ColumnType;
  values?: string[];
  min?: string;
  max?: string;
}

export interface ChartConfig {
  type: ChartType;
  xKey: string;
  yKey: string;
  aggregation: Aggregation;
  interpolation?: 'linear' | 'monotone';
  yScale?: 'linear' | 'log';
  yDomain?: 'zero' | 'auto';
  yMin?: number;
  yMax?: number;
}

export interface FitResult {
  equation: string;
  rSquared: number;
  sampleCount: number;
  points: { x: number; y: number }[];
}
