import type { ChartConfig, DataRow, FitResult, FitType } from '../types';
import { buildSeries } from './charts';

interface Pair { x: number; y: number }
interface Solution { coefficients: number[]; center: number; scale: number; targetScale: number }

const DAY = 86_400_000;
const MODEL_NAMES: Record<Exclude<FitType, 'none'>, string> = {
  linear: 'Linear', quadratic: 'Quadratic', cubic: 'Cubic',
  exponential: 'Exponential', logarithmic: 'Logarithmic', power: 'Power',
};

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(text) || /^[+-]?0\d+$/.test(text)) return null;
  const number = Number(text);
  if (Number.isInteger(number) && !Number.isSafeInteger(number)) return null;
  return Number.isFinite(number) ? number : null;
}

function sum(values: ArrayLike<number>, other?: ArrayLike<number>): number {
  let total = 0;
  let correction = 0;
  for (let index = 0; index < values.length; index += 1) {
    const value = (other ? values[index] * other[index] : values[index]) - correction;
    const next = total + value;
    correction = (next - total) - value;
    total = next;
  }
  return total;
}

function bounds(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return { min, max };
}

function evaluate(coefficients: number[], x: number): number {
  let value = 0;
  for (let index = coefficients.length - 1; index >= 0; index -= 1) value = value * x + coefficients[index];
  return value;
}

function leastSquares(inputs: number[], targets: number[], degree: number): Solution | null {
  const { min, max } = bounds(inputs);
  const center = min / 2 + max / 2;
  const scale = Math.max(Math.abs(min - center), Math.abs(max - center));
  if (!Number.isFinite(scale) || scale === 0) return null;
  let targetScale = 0;
  for (const value of targets) targetScale = Math.max(targetScale, Math.abs(value));
  if (targetScale === 0) targetScale = 1;
  const target = Float64Array.from(targets, (value) => value / targetScale);
  const normalized = Float64Array.from(inputs, (value) => (value - center) / scale);
  const columns: Float64Array[] = [];
  const upper = Array.from({ length: degree + 1 }, () => Array<number>(degree + 1).fill(0));
  const rhs: number[] = [];

  // normalize x and reorthogonalize qr columns to avoid normal-equation instability.
  for (let column = 0; column <= degree; column += 1) {
    const vector = Float64Array.from(normalized, (value) => value ** column);
    for (let pass = 0; pass < 2; pass += 1) {
      for (let previous = 0; previous < column; previous += 1) {
        const projection = sum(columns[previous], vector);
        upper[previous][column] += projection;
        for (let row = 0; row < vector.length; row += 1) vector[row] -= projection * columns[previous][row];
      }
    }
    const length = Math.sqrt(sum(vector, vector));
    if (!Number.isFinite(length) || length <= 64 * Number.EPSILON * Math.sqrt(inputs.length)) return null;
    upper[column][column] = length;
    for (let row = 0; row < vector.length; row += 1) vector[row] /= length;
    columns.push(vector);
    rhs.push(sum(vector, target));
  }

  const coefficients = Array<number>(degree + 1).fill(0);
  for (let row = degree; row >= 0; row -= 1) {
    let value = rhs[row];
    for (let column = row + 1; column <= degree; column += 1) value -= upper[row][column] * coefficients[column];
    coefficients[row] = value / upper[row][row];
  }
  return coefficients.every(Number.isFinite) ? { coefficients, center, scale, targetScale } : null;
}

function latexNumber(value: number): string {
  if (value === 0) return '0';
  const rounded = Number(value.toPrecision(8)).toString();
  const [mantissa, exponent] = rounded.split('e');
  return exponent ? `${mantissa}\\times 10^{${Number(exponent)}}` : rounded;
}

function polynomial(coefficients: number[], variable: string): string {
  const terms: string[] = [];
  for (let power = coefficients.length - 1; power >= 0; power -= 1) {
    const coefficient = coefficients[power];
    if (coefficient === 0) continue;
    const absolute = Math.abs(coefficient);
    const factor = power ? `${variable}${power > 1 ? `^{${power}}` : ''}` : '';
    const magnitude = power && absolute === 1 ? '' : latexNumber(absolute);
    terms.push(`${terms.length ? coefficient < 0 ? ' - ' : ' + ' : coefficient < 0 ? '-' : ''}${magnitude}${magnitude && factor ? '\\,' : ''}${factor}`);
  }
  return terms.join('') || '0';
}

function rawCoefficients(solution: Solution): number[] {
  const binomial = [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1]];
  const result = solution.coefficients.map(() => 0);
  const shift = -solution.center / solution.scale;
  for (let power = 0; power < result.length; power += 1) {
    for (let source = power; source < result.length; source += 1) {
      result[power] += solution.coefficients[source] * binomial[source][power] * shift ** (source - power) / solution.scale ** power;
    }
    result[power] *= solution.targetScale;
  }
  return result;
}

function cleaned(coefficients: number[], maxInput = 1): number[] {
  const contributions = coefficients.map((value, power) => Math.abs(value) * maxInput ** power);
  let magnitude = 0;
  for (const value of contributions) magnitude = Math.max(magnitude, value);
  return coefficients.map((value, power) => contributions[power] <= magnitude * Number.EPSILON * 16 ? 0 : value);
}

function equationFor(solution: Solution, inputs: number[], type: Exclude<FitType, 'none'>, dateOrigin: number | null): string {
  const raw = rawCoefficients(solution);
  const { min, max } = bounds(inputs);
  const maxInput = Math.max(Math.abs(min), Math.abs(max));
  const cancellation = raw.reduce((total, value, power) => total + Math.abs(value) * maxInput ** power, 0) / solution.targetScale;
  const logInput = type === 'logarithmic' || type === 'power';
  const logarithmicTarget = type === 'exponential' || type === 'power';
  const rawSafe = raw.every(Number.isFinite) && Number.isFinite(cancellation) && cancellation < 1e6;
  let body: string;
  let definition = '';
  if (rawSafe && logarithmicTarget && Math.exp(raw[0]) > 0 && Number.isFinite(Math.exp(raw[0]))) {
    const factor = latexNumber(Math.exp(raw[0]));
    body = type === 'power' ? `${factor}\\,x^{${latexNumber(raw[1])}}` : `${factor}\\,e^{${polynomial(cleaned([0, raw[1]]), 'x')}}`;
  } else if (rawSafe && !logarithmicTarget) {
    body = polynomial(cleaned(raw, maxInput), logInput ? '\\ln(x)' : 'x');
  } else {
    const normalized = cleaned(solution.coefficients.map((value) => value * solution.targetScale));
    const finiteCoefficients = normalized.every(Number.isFinite);
    const expression = polynomial(finiteCoefficients ? normalized : cleaned(solution.coefficients), 'z');
    const scaled = finiteCoefficients ? expression : `${latexNumber(solution.targetScale)}\\left(${expression}\\right)`;
    body = logarithmicTarget ? `e^{${scaled}}` : scaled;
    const center = solution.center;
    const shifted = `${logInput ? '\\ln(x)' : 'x'}${center < 0 ? ' + ' : ' - '}${latexNumber(Math.abs(center))}`;
    definition = `\\quad z = \\frac{${shifted}}{${latexNumber(solution.scale)}}`;
  }
  if (dateOrigin !== null) {
    const timestamp = new Date(dateOrigin).toISOString();
    const label = timestamp.endsWith('T00:00:00.000Z') ? timestamp.slice(0, 10) : timestamp;
    definition += `\\quad x = \\frac{t - \\text{${label}}}{1\\,\\mathrm{day}}`;
  }
  return `\\hat{y} = ${body}${definition}`;
}

function rSquared(pairs: Pair[], predictions: number[]): number {
  let scale = 0;
  for (let index = 0; index < pairs.length; index += 1) scale = Math.max(scale, Math.abs(pairs[index].y), Math.abs(predictions[index]));
  if (scale === 0) return 1;
  const actual = pairs.map((pair) => pair.y / scale);
  const mean = sum(actual) / actual.length;
  const squaredResiduals = actual.map((value, index) => (value - predictions[index] / scale) ** 2);
  const residual = sum(squaredResiduals);
  if (pairs.every((pair) => pair.y === pairs[0].y)) return residual <= pairs.length * (64 * Number.EPSILON) ** 2 ? 1 : 0;
  const total = sum(actual.map((value) => (value - mean) ** 2));
  return 1 - residual / total;
}

export function fitFunction(rows: DataRow[], config: ChartConfig, type: FitType): { result: FitResult | null; error: string | null } {
  const failure = (error: string) => ({ result: null, error });
  if (type === 'none') return { result: null, error: null };
  if (config.type !== 'line' && config.type !== 'area' && config.type !== 'scatter') return failure('Function fitting is available for line, area, and scatter charts.');
  // fit every per-x aggregate before display sampling.
  const series = buildSeries(rows, config, { reduce: false });
  if (!series.xIsDate && !series.xIsNumeric) return failure('Choose a numeric or date x axis to fit a function.');

  // scatter fitting uses all valid pairs before the chart samples its markers.
  const pairs: Pair[] = config.type === 'scatter'
    ? rows.flatMap((row) => {
      const x = numeric(row[config.xKey]);
      const y = numeric(row[config.yKey]);
      return x === null || y === null ? [] : [{ x, y }];
    })
    : series.points.map((point) => ({ x: point.x!, y: point.value }));
  if (pairs.some((pair) => !Number.isFinite(pair.x) || !Number.isFinite(pair.y))) return failure('Chart values are too large to fit a finite function.');
  const degree = type === 'quadratic' ? 2 : type === 'cubic' ? 3 : 1;
  const required = degree + 1;
  if (pairs.length < required || new Set(pairs.map((pair) => pair.x)).size < required) return failure(`${MODEL_NAMES[type]} fit needs at least ${required} distinct x values.`);
  const rawRange = bounds(pairs.map((pair) => pair.x));
  const dateOrigin = series.xIsDate ? rawRange.min : null;
  const xValue = (raw: number) => dateOrigin === null ? raw : (raw - dateOrigin) / DAY;
  const logInput = type === 'logarithmic' || type === 'power';
  const logTarget = type === 'exponential' || type === 'power';
  if (logInput && pairs.some((pair) => xValue(pair.x) <= 0)) return failure(`${MODEL_NAMES[type]} fit requires every x value to be greater than zero.${dateOrigin === null ? '' : ' Date x is measured in days since the first date and starts at zero.'}`);
  if (logTarget && pairs.some((pair) => pair.y <= 0)) return failure(`${MODEL_NAMES[type]} fit requires every y value to be greater than zero.`);
  const inputs = pairs.map((pair) => logInput ? Math.log(xValue(pair.x)) : xValue(pair.x));
  const targets = pairs.map((pair) => logTarget ? Math.log(pair.y) : pair.y);
  const solution = leastSquares(inputs, targets, degree);
  if (!solution) return failure('These x values are too close together to fit this function reliably.');
  const predict = (raw: number) => {
    const input = logInput ? Math.log(xValue(raw)) : xValue(raw);
    const target = evaluate(solution.coefficients, (input - solution.center) / solution.scale) * solution.targetScale;
    return logTarget ? Math.exp(target) : target;
  };
  const predictions = pairs.map((pair) => predict(pair.x));
  const points = Array.from({ length: 160 }, (_, index) => {
    const fraction = index / 159;
    const interpolated = rawRange.min * (1 - fraction) + rawRange.max * fraction;
    const x = index === 0 ? rawRange.min : index === 159 ? rawRange.max : Math.max(rawRange.min, Math.min(rawRange.max, interpolated));
    return { x, y: predict(x) };
  });
  if (predictions.some((value) => !Number.isFinite(value)) || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return failure('This fit produces values outside the finite numeric range.');
  const score = rSquared(pairs, predictions);
  if (!Number.isFinite(score)) return failure('The data range is too large to calculate a reliable fit score.');
  return { result: { equation: equationFor(solution, inputs, type, dateOrigin), rSquared: score, sampleCount: pairs.length, points }, error: null };
}
