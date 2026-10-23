import { useId, useMemo, type CSSProperties } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import type { ChartConfig, DataRow, FitResult } from '../types';
import { buildSeries, chartLabel, chartSummary, formatChartDate, formatChartNumber, type ChartPoint } from '../lib/charts';

interface DataChartProps {
  rows: DataRow[];
  config: ChartConfig;
  height?: number;
  fit?: FitResult | null;
}

interface TooltipEntry {
  payload?: ChartPoint;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: readonly TooltipEntry[];
  config: ChartConfig;
}

const colors = ['#5265f5', '#a69af4', '#54b9ac', '#f4b76b', '#90a4ee', '#e7a6cd', '#c4cbd7'];
const tickStyle = { fill: '#8b95a5', fontSize: 11, fontFamily: 'inherit' };

export interface ResolvedYAxis {
  domain: [number, number];
  scale: 'linear' | 'log';
  error: string | null;
}

export function resolveYAxis(values: readonly number[], config: ChartConfig): ResolvedYAxis {
  const finiteValues = values.filter(Number.isFinite);
  const scale = config.yScale ?? 'linear';
  const fallback: ResolvedYAxis = { domain: [0, 1], scale, error: null };
  if (!finiteValues.length) return fallback;
  let min = Infinity;
  let max = -Infinity;
  for (const value of finiteValues) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (scale === 'log' && min <= 0) {
    return { ...fallback, error: 'Log scale requires positive values.' };
  }

  let domain: [number, number];
  if (scale === 'log') {
    const padding = min === max ? Math.log(1.1) : (Math.log(max) - Math.log(min)) * 0.05;
    domain = [Math.max(Number.MIN_VALUE, Math.exp(Math.log(min) - padding)), Math.min(Number.MAX_VALUE, Math.exp(Math.log(max) + padding))];
  } else {
    const includeZero = config.yDomain !== 'auto';
    const low = includeZero ? Math.min(0, min) : min;
    const high = includeZero ? Math.max(0, max) : max;
    const padding = high === low ? (Math.abs(min) || 1) * 0.05 : high * 0.05 - low * 0.05;
    domain = [includeZero && low === 0 ? 0 : Math.max(-Number.MAX_VALUE, low - padding), includeZero && high === 0 ? 0 : Math.min(Number.MAX_VALUE, high + padding)];
    if (domain[0] === domain[1]) domain = [0, 1];
  }
  const validBound = (value: number | undefined) => typeof value === 'number' && Number.isFinite(value) && (scale !== 'log' || value > 0);
  const manual: [number, number] = [validBound(config.yMin) ? config.yMin! : domain[0], validBound(config.yMax) ? config.yMax! : domain[1]];
  // extend an unspecified boundary when a manual limit goes beyond the data
  if (validBound(config.yMin) && !validBound(config.yMax) && manual[0] >= manual[1]) {
    manual[1] = scale === 'log' ? Math.min(Number.MAX_VALUE, manual[0] * 1.1) : Math.min(Number.MAX_VALUE, manual[0] + (Math.abs(manual[0]) || 1) * .05);
  }
  if (!validBound(config.yMin) && validBound(config.yMax) && manual[0] >= manual[1]) {
    manual[0] = scale === 'log' ? Math.max(Number.MIN_VALUE, manual[1] / 1.1) : Math.max(-Number.MAX_VALUE, manual[1] - (Math.abs(manual[1]) || 1) * .05);
  }
  // reject inverted bounds without producing a reversed axis
  if (manual[0] < manual[1]) domain = manual;
  return { domain, scale, error: null };
}

function ChartTooltip({ active, payload, config }: ChartTooltipProps) {
  const point = payload?.find((entry) => entry.payload && Number.isFinite(entry.payload.count))?.payload;
  if (!active || !point) return null;
  const metric = config.type === 'histogram' || config.aggregation === 'count' ? 'Records' : chartLabel(config.yKey);
  return (
    <div style={tooltipStyle}>
      <div style={{ color: '#6f7b8e', fontSize: 11, marginBottom: 9, maxWidth: 230, overflowWrap: 'anywhere' }}>
        {chartLabel(config.xKey)}: {config.type === 'scatter' ? formatChartNumber(point.x!) : point.name}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 22 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ width: 7, height: 7, borderRadius: 2, background: colors[0] }} />{config.type === 'scatter' ? chartLabel(config.yKey) : metric}</span>
        <strong style={{ fontSize: 14 }}>{formatChartNumber(point.y ?? point.value)}</strong>
      </div>
      {config.type !== 'scatter' && config.aggregation !== 'count' && config.type !== 'histogram' && (
        <div style={{ borderTop: '1px solid #edf0f4', marginTop: 10, paddingTop: 8, color: '#8b95a5', fontSize: 10 }}>{point.count.toLocaleString()} {point.count === 1 ? 'record' : 'records'}: {config.aggregation === 'average' ? 'average' : 'sum'}</div>
      )}
    </div>
  );
}

const tooltipStyle: CSSProperties = {
  background: '#fff',
  border: '1px solid #e9edf3',
  borderRadius: 2,
  boxShadow: 'none',
  padding: '9px 11px',
  color: '#293346',
  fontSize: 12,
  lineHeight: 1.4,
};

function EmptyChart({ message, height, visible = false }: { message: string; height: number; visible?: boolean }) {
  if (!visible) return <div role="status" aria-label={message} style={{ height }} />;
  return (
    <div role="status" style={{ height, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 13, color: '#8b95a5', textAlign: 'center', padding: 30 }}>
      <p style={{ margin: 0, maxWidth: 300, fontSize: 13, lineHeight: 1.6 }}>{message}</p>
    </div>
  );
}

export default function DataChart({ rows, config, height = 320, fit = null }: DataChartProps) {
  const gradientId = `chart-fill-${useId().replace(/:/g, '')}`;
  const series = useMemo(() => buildSeries(rows, config), [rows, config]);
  const { points } = series;
  const plotHeight = Math.max(160, height);
  const isDonut = config.type === 'pie';
  const donutTotal = points.reduce((sum, point) => sum + point.value, 0);
  const unusableDonut = isDonut && (points.some((point) => point.value < 0) || donutTotal <= 0);
  if (!points.length || unusableDonut) {
    return <EmptyChart height={plotHeight} message={unusableDonut ? 'Donut charts need positive totals. Try a bar chart for this selection.' : rows.length ? 'No valid values for these axes. Choose another column or change your filters.' : 'No records match your filters. Adjust a filter to bring your data back.'} />;
  }

  const continuous = (config.type === 'line' || config.type === 'area') && (series.xIsDate || series.xIsNumeric);
  // keep fit samples on the same numeric axes as the data.
  const fitPoints = fit && (continuous || config.type === 'scatter')
    ? fit.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)).map((point) => ({ x: point.x, y: point.y, fitValue: point.y }))
    : [];
  const yAxis = resolveYAxis([...points.map((point) => point.y ?? point.value), ...fitPoints.map((point) => point.y)], config);
  if (!isDonut && yAxis.error) return <EmptyChart message={yAxis.error} height={plotHeight} visible />;
  const xValues = continuous ? points.flatMap((point) => Number.isFinite(point.x) ? [point.x!] : []) : [];
  const xMin = xValues.length ? xValues[0] : 0;
  const xMax = xValues.length ? xValues[xValues.length - 1] : 0;
  const includeYear = series.xIsDate && new Date(xMin).getUTCFullYear() !== new Date(xMax).getUTCFullYear();
  const dateTicks = continuous && series.xIsDate && xMin !== xMax
    ? Array.from({ length: 5 }, (_, index) => xMin + (xMax - xMin) * index / 4)
    : undefined;
  const fitLine = fitPoints.length > 1 ? <Line data={fitPoints} dataKey="fitValue" name="Function fit" type="linear" stroke="#ce6c24" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={false} tooltipType="none" legendType="none" isAnimationActive={false} /> : null;
  const formatX = (value: unknown) => {
    if (continuous && typeof value === 'number') return series.xIsDate ? formatChartDate(value, includeYear) : formatChartNumber(value, true);
    const label = String(value);
    return label.length > 16 ? `${label.slice(0, 14)}…` : label;
  };
  const margin = { top: 16, right: 12, left: -13, bottom: 0 };
  const axes = (
    <>
      <CartesianGrid stroke="#edf0f4" strokeDasharray="3 5" vertical={false} />
      <XAxis
        dataKey={continuous ? 'x' : 'name'}
        type={continuous ? 'number' : 'category'}
        domain={continuous ? [xMin, xMax] : undefined}
        scale={continuous && series.xIsDate ? 'time' : 'auto'}
        ticks={dateTicks}
        interval="preserveStartEnd"
        axisLine={false}
        tickLine={false}
        tick={tickStyle}
        tickFormatter={formatX}
        tickMargin={13}
        minTickGap={35}
        height={39}
        padding={continuous ? { left: 8, right: 8 } : undefined}
      />
      <YAxis scale={yAxis.scale} domain={yAxis.domain} allowDataOverflow axisLine={false} tickLine={false} tick={tickStyle} tickFormatter={(value: number) => formatChartNumber(value, true)} tickMargin={10} width={64} />
    </>
  );
  const tooltip = <Tooltip content={<ChartTooltip config={config} />} cursor={{ stroke: '#b6bfd9', strokeDasharray: '4 4' }} />;
  const shared = { data: points, margin, accessibilityLayer: true };

  const renderPlot = () => {
    if (config.type === 'line') return (
      <ComposedChart {...shared}>
        {axes}{tooltip}
        {yAxis.scale !== 'log' && points.some((point) => point.value < 0) && <ReferenceLine y={0} stroke="#cbd2df" />}
        <Line type={config.interpolation ?? 'linear'} dataKey="value" name={config.aggregation === 'count' ? 'Records' : chartLabel(config.yKey)} stroke={colors[0]} strokeWidth={3} dot={points.length < 35 ? { r: 3.5, fill: '#fff', strokeWidth: 2 } : false} activeDot={{ r: 5.5, stroke: '#fff', strokeWidth: 3 }} isAnimationActive={false} />
        {fitLine}
      </ComposedChart>
    );
    if (config.type === 'area') return (
      <ComposedChart {...shared}>
        <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colors[0]} stopOpacity={0.2} /><stop offset="100%" stopColor={colors[0]} stopOpacity={0.015} /></linearGradient></defs>
        {axes}{tooltip}
        <Area type={config.interpolation ?? 'linear'} dataKey="value" name={config.aggregation === 'count' ? 'Records' : chartLabel(config.yKey)} stroke={colors[0]} strokeWidth={2.8} fill={`url(#${gradientId})`} activeDot={{ r: 5.5, stroke: '#fff', strokeWidth: 3 }} isAnimationActive={false} />
        {fitLine}
      </ComposedChart>
    );
    if (config.type === 'bar' || config.type === 'histogram') return (
      <BarChart {...shared} barCategoryGap={config.type === 'histogram' ? '7%' : '28%'}>
        {axes}
        <Tooltip content={<ChartTooltip config={config} />} cursor={{ fill: '#f5f6fc' }} />
        {yAxis.scale !== 'log' && points.some((point) => point.value < 0) && <ReferenceLine y={0} stroke="#cbd2df" />}
        <Bar dataKey="value" fill={colors[0]} radius={[5, 5, 0, 0]} maxBarSize={config.type === 'histogram' ? undefined : 62} activeBar={{ fill: '#7584ff' }} isAnimationActive={false} />
      </BarChart>
    );
    if (config.type === 'scatter') return (
      <ScatterChart margin={margin} accessibilityLayer>
        <CartesianGrid stroke="#edf0f4" strokeDasharray="3 5" vertical={false} />
        <XAxis type="number" dataKey="x" name={chartLabel(config.xKey)} axisLine={false} tickLine={false} tick={tickStyle} tickFormatter={(value: number) => formatChartNumber(value, true)} tickMargin={12} domain={['auto', 'auto']} height={39} />
        <YAxis type="number" dataKey="y" name={chartLabel(config.yKey)} scale={yAxis.scale} domain={yAxis.domain} allowDataOverflow axisLine={false} tickLine={false} tick={tickStyle} tickFormatter={(value: number) => formatChartNumber(value, true)} tickMargin={10} width={64} />
        <ZAxis range={[48, 48]} />
        <Tooltip content={<ChartTooltip config={config} />} cursor={{ strokeDasharray: '3 4', stroke: '#b6bfd9' }} />
        <Scatter data={points} fill={colors[0]} fillOpacity={0.65} isAnimationActive={false} />
        {fitPoints.length > 1 && <Scatter data={fitPoints} name="Function fit" shape={() => null} line={{ stroke: '#ce6c24', strokeWidth: 2, strokeDasharray: '6 4' }} lineType="joint" lineJointType="linear" tooltipType="none" legendType="none" isAnimationActive={false} />}
      </ScatterChart>
    );
    return (
      <PieChart accessibilityLayer>
        <Pie data={points} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius="65%" outerRadius="85%" paddingAngle={points.length > 1 ? 3 : 0} cornerRadius={3} stroke="none" isAnimationActive={false}>
          {points.map((point, index) => <Cell key={`${point.name}-${index}`} fill={colors[index % colors.length]} />)}
        </Pie>
        <text x="50%" y="50%" textAnchor="middle" dominantBaseline="central" fill="#263247" fontSize={26} fontWeight={650} fontFamily="inherit">{formatChartNumber(donutTotal, true)}</text>
        <Tooltip content={<ChartTooltip config={config} />} />
      </PieChart>
    );
  };

  return (
    <figure className="data-chart" style={{ margin: 0, width: '100%', minWidth: 0, containerType: 'inline-size' }} aria-label={`${chartSummary(config)}. ${series.validRows.toLocaleString()} valid records.${continuous ? ` X range ${series.xIsDate ? new Date(xMin).toISOString() : xMin} to ${series.xIsDate ? new Date(xMax).toISOString() : xMax}.` : ''}${!isDonut ? ` Y range ${yAxis.domain[0]} to ${yAxis.domain[1]}, ${yAxis.scale} scale.` : ''}`}>
      <div className={`data-chart-layout${isDonut ? ' data-chart-layout--donut' : ''}`} style={{ width: '100%', minWidth: 0, display: 'flex', alignItems: 'center', gap: isDonut ? 16 : 0 }}>
        <div className="data-chart-plot" style={{ height: plotHeight, flex: 1, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>{renderPlot()}</ResponsiveContainer>
        </div>
        {isDonut && (
          <div className="data-chart-legend" aria-label="chart legend">
            {points.map((point, index) => (
              <div key={`${point.name}-${index}`} style={{ fontSize: 11 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: '#68758a' }}><span style={{ width: 7, height: 7, flexShrink: 0, borderRadius: 2, background: colors[index % colors.length] }} /><span title={point.name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{point.name}</span></div>
                <div style={{ marginLeft: 14, marginTop: 4, color: '#2d374b', fontWeight: 600 }}>{formatChartNumber(point.value, true)} <span style={{ marginLeft: 5, color: '#9aa4b3', fontWeight: 400 }}>{formatChartNumber(point.value / donutTotal * 100)}%</span></div>
              </div>
            ))}
          </div>
        )}
      </div>
      {series.reductionNote && <figcaption style={{ margin: '4px 0 0 4px', color: '#8994a5', fontSize: 10, lineHeight: 1.6 }}><span tabIndex={0} role="note" title={series.reductionNote} aria-label={series.reductionNote} style={{ display: 'inline-flex', width: 15, height: 15, border: '1px solid #c6cdd8', borderRadius: '50%', alignItems: 'center', justifyContent: 'center', cursor: 'help' }}>i</span></figcaption>}
    </figure>
  );
}
