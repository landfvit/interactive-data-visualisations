import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, DragEvent, ReactNode } from 'react';
import {
  BarChart3, ChartArea, ChartColumn, ChartLine, ChartNoAxesCombined,
  ChartPie, CircleAlert, Database, Download, Play, RotateCcw, Search, SlidersHorizontal, Spline, Upload, X, ZoomIn, ZoomOut,
} from 'lucide-react';
import { renderToString } from 'katex';
import 'katex/dist/katex.min.css';
import DataChart from './components/DataChart';
import { applyFilters, defaultConfig, parseDataset, recommendCharts } from './lib/data';
import { fitFunction } from './lib/fit';
import { exportChart } from './lib/export';
import { lastDaysWindow, windowValue, xExtent, zoomWindow } from './lib/window';
import type { WindowInput } from './lib/window';
import type { ChartConfig, Dataset, FilterRule, FitType } from './types';

const chartTypes = [
  { type: 'line', label: 'Line chart', icon: ChartLine },
  { type: 'bar', label: 'Bar chart', icon: ChartColumn },
  { type: 'area', label: 'Area chart', icon: ChartArea },
  { type: 'scatter', label: 'Scatter plot', icon: ChartNoAxesCombined },
  { type: 'pie', label: 'Donut chart', icon: ChartPie },
  { type: 'histogram', label: 'Histogram', icon: BarChart3 },
] as const;

const emptyConfig: ChartConfig = { type: 'bar', xKey: '', yKey: '', aggregation: 'sum', interpolation: 'linear' };

function IconButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return <span className="tooltip" data-tooltip={label}><button type="button" aria-label={label} {...props}>{children}</button></span>;
}

function latexScore(value: number) {
  const [mantissa, exponent] = Number(value.toPrecision(6)).toString().split('e');
  return exponent ? `${mantissa}\\times 10^{${Number(exponent)}}` : mantissa;
}

export default function App() {
  const [input, setInput] = useState('');
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [config, setConfig] = useState<ChartConfig>(emptyConfig);
  const [rules, setRules] = useState<FilterRule[]>([]);
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [plotHeight, setPlotHeight] = useState(400);
  const [fitType, setFitType] = useState<FitType>('none');
  const [exporting, setExporting] = useState(false);
  const [xWindow, setXWindow] = useState<WindowInput>({ min: '', max: '' });
  const [timePreset, setTimePreset] = useState('all');
  const [showScales, setShowScales] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const equationRef = useRef<HTMLDivElement>(null);

  const columns = dataset?.columns ?? [];
  const numeric = columns.filter(column => column.type === 'number');
  const recommended = useMemo(() => dataset ? recommendCharts(dataset.columns) : [], [dataset]);
  const baseRows = useMemo(() => dataset ? applyFilters(dataset.rows, rules) : [], [dataset, rules]);
  const xType = columns.find(column => column.key === config.xKey)?.type ?? 'text';
  const hasWindow = Boolean(dataset && ['line', 'area', 'scatter', 'histogram'].includes(config.type) && xType !== 'text');
  const extent = useMemo(() => hasWindow ? xExtent(baseRows, config.xKey, xType) : null, [baseRows, config.xKey, xType, hasWindow]);
  // apply the visible window before plotting, fitting, and exporting
  const rows = useMemo(() => hasWindow ? applyFilters(baseRows, [{ id: 'window', column: config.xKey, kind: xType, ...xWindow }]) : baseRows, [baseRows, hasWindow, config.xKey, xType, xWindow]);
  const invalidY = config.yMin !== undefined && config.yMax !== undefined && config.yMin >= config.yMax;
  const invalidX = Boolean(hasWindow && xWindow.min && xWindow.max && (xType === 'date' ? xWindow.min > xWindow.max : Number(xWindow.min) > Number(xWindow.max)));
  const invalidLogBounds = config.yScale === 'log' && (config.yMin !== undefined && config.yMin <= 0 || config.yMax !== undefined && config.yMax <= 0);
  const canFit = Boolean(dataset && ['line', 'area', 'scatter'].includes(config.type)
    && columns.find(column => column.key === config.xKey)?.type !== 'text');
  const fit = useMemo(() => canFit ? fitFunction(rows, config, fitType) : { result: null, error: null }, [rows, config, fitType, canFit]);
  const equation = useMemo(() => fit.result ? renderToString(
    `${fit.result.equation} \\qquad R^{2} = ${latexScore(fit.result.rSquared)}`,
    { displayMode: true, throwOnError: false, trust: false },
  ) : '', [fit.result]);

  // cache category values instead of scanning rows for every option
  const categories = useMemo(() => {
    const result = new Map<string, string[]>();
    dataset?.columns.filter(column => column.type === 'text').forEach(column => {
      result.set(column.key, [...new Set(dataset.rows.map(row => String(row[column.key] ?? '')))].sort());
    });
    return result;
  }, [dataset]);

  useLayoutEffect(() => {
    const container = plot.current;
    if (!container) return;
    const measure = () => {
      const equationHeight = equationRef.current?.getBoundingClientRect().height ?? 0;
      const noteHeight = container.querySelector('figcaption')?.getBoundingClientRect().height ?? 0;
      const errorHeight = container.querySelector('.fit-error')?.getBoundingClientRect().height ?? 0;
      setPlotHeight(Math.max(180, container.clientHeight - equationHeight - noteHeight - errorHeight - 24));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    if (equationRef.current) observer.observe(equationRef.current);
    measure();
    return () => observer.disconnect();
  }, [equation, Boolean(dataset), showScales, hasWindow, rows.length]);

  function load(text: string, filename: string) {
    try {
      const next = parseDataset(text, filename);
      const types = recommendCharts(next.columns);
      setDataset(next);
      setConfig({ ...defaultConfig(types.includes('line') ? 'line' : types[0], next.columns), interpolation: 'linear' });
      setFitType('none');
      resetWindow();
      setRules([]);
      setQueries({});
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid data.');
    }
  }

  async function readFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (!/\.(csv|tsv|json)$/i.test(file.name)) throw new Error('CSV, TSV, or JSON required.');
      if (file.size > 10 * 1024 * 1024) throw new Error('Maximum file size: 10 MB.');
      // file contents stay in this browser
      const text = await file.text();
      setInput(text);
      load(text, file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Invalid file.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  function reset() {
    setInput('');
    setDataset(null);
    setConfig(emptyConfig);
    setFitType('none');
    resetWindow();
    setRules([]);
    setQueries({});
    setError('');
  }

  function addFilter(key: string) {
    const column = columns.find(column => column.key === key);
    if (column) setRules(current => [...current, {
      id: crypto.randomUUID(), column: key, kind: column.type, values: [],
    }]);
  }

  function updateFilter(id: string, changes: Partial<FilterRule>) {
    setRules(current => current.map(rule => rule.id === id ? { ...rule, ...changes } : rule));
  }

  function resetWindow() {
    setXWindow({ min: '', max: '' });
    setTimePreset('all');
  }

  function zoom(factor: number) {
    if (!extent) return;
    setXWindow(current => zoomWindow(extent, current, xType, factor));
    setTimePreset('custom');
  }

  function changePreset(value: string) {
    setTimePreset(value);
    if (value === 'all') setXWindow({ min: '', max: '' });
    else if (extent) setXWindow(lastDaysWindow(extent, Number(value)));
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    void readFile(event.dataTransfer.files[0]);
  }

  async function loadSample() {
    setBusy(true);
    try {
      const response = await fetch('/sample-large.csv');
      if (!response.ok) throw new Error('Could not load the sample.');
      const text = await response.text();
      setInput(text);
      load(text, 'sample-large.csv');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the sample.');
    } finally { setBusy(false); }
  }

  async function downloadChart(format: 'svg' | 'png') {
    if (!plot.current) return;
    setExporting(true);
    try {
      await exportChart(plot.current, format, `${dataset?.name ?? 'chart'}-${config.type}`);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not export the chart.');
    } finally { setExporting(false); }
  }

  return <main className="workbench" aria-label="Local data visualisation">
    <section
      className={`pane input-pane ${dragging ? 'dragging' : ''}`}
      aria-label="Data input"
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={drop}
    >
      <div className="toolbar">
        <IconButton label="Open CSV, TSV, or JSON" onClick={() => fileInput.current?.click()} disabled={busy}><Upload size={16} /></IconButton>
        <IconButton label="Apply data: Ctrl/⌘ + Enter" disabled={!input.trim() || busy} onClick={() => load(input, 'data')}><Play size={16} /></IconButton>
        <IconButton label="Load sample: 10,000 rows" onClick={() => void loadSample()} disabled={busy}><Database size={16} /></IconButton>
        <a className="tooltip icon-link" data-tooltip="Download sample CSV: 10,000 rows" aria-label="Download sample CSV" href="/sample-large.csv" download="sample-large.csv"><Download size={15} /></a>
        <IconButton label="Clear data" onClick={reset} disabled={!input && !dataset}><X size={16} /></IconButton>
        {error && <output className="error-indicator tooltip" data-tooltip={error} aria-label={error} role="alert"><CircleAlert size={17} /><span className="sr-only">{error}</span></output>}
      </div>
      <textarea
        aria-label="CSV, TSV, or JSON data"
        spellCheck={false}
        value={input}
        onChange={event => { setInput(event.target.value); setError(''); }}
        onKeyDown={event => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && input.trim()) {
            event.preventDefault();
            load(input, 'data');
          }
        }}
      />
      <input ref={fileInput} type="file" accept=".csv,.tsv,.json" className="sr-only" tabIndex={-1} aria-label="Dataset file" onChange={event => void readFile(event.target.files?.[0])} />
    </section>

    <section className="pane filter-pane" aria-label="Filters">
      <div className="toolbar">
        <label className="tooltip select-tooltip" data-tooltip="Add filter"><select aria-label="Add filter" value="" disabled={!dataset || rules.length === columns.length} onChange={event => addFilter(event.target.value)}>
          <option value="" disabled>＋</option>
          {columns.filter(column => !rules.some(rule => rule.column === column.key)).map(column => <option key={column.key} value={column.key}>{column.key}</option>)}
        </select></label>
        <IconButton label="Reset filters" onClick={() => { setRules([]); setQueries({}); }} disabled={!rules.length}><RotateCcw size={15} /></IconButton>
      </div>
      <div className="filter-list">
        {rules.map(rule => {
          const values = categories.get(rule.column) ?? [];
          const query = (queries[rule.id] ?? '').toLocaleLowerCase();
          const shown = [...new Set([
            ...(rule.values ?? []),
            ...values.filter(value => value.toLocaleLowerCase().includes(query)).slice(0, 100),
          ])];
          return <div className="filter" key={rule.id}>
            <div className="filter-heading"><span>{rule.column}</span><IconButton label={`Remove ${rule.column} filter`} onClick={() => setRules(current => current.filter(item => item.id !== rule.id))}><X size={13} /></IconButton></div>
            {rule.kind === 'text' ? <>
              <div className="value-search"><Search size={13} /><input aria-label={`Search ${rule.column} values`} value={queries[rule.id] ?? ''} onChange={event => setQueries(current => ({ ...current, [rule.id]: event.target.value }))} /></div>
              <div className="category-values">
                {shown.map(value => <label key={value}><input type="checkbox" checked={rule.values?.includes(value) ?? false} onChange={event => updateFilter(rule.id, {
                  values: event.target.checked ? [...(rule.values ?? []), value] : rule.values?.filter(item => item !== value),
                })} /><span>{value || '∅'}</span></label>)}
              </div>
            </> : <div className="bounds">
              <label><span aria-hidden="true">≥</span><input aria-label={`${rule.column} minimum`} type={rule.kind === 'date' ? 'date' : 'number'} step="any" value={rule.min ?? ''} onChange={event => updateFilter(rule.id, { min: event.target.value })} /></label>
              <label><span aria-hidden="true">≤</span><input aria-label={`${rule.column} maximum`} type={rule.kind === 'date' ? 'date' : 'number'} step="any" value={rule.max ?? ''} onChange={event => updateFilter(rule.id, { max: event.target.value })} /></label>
            </div>}
          </div>;
        })}
      </div>
    </section>

    <section className="pane plot-pane" aria-label="Chart">
      <div className="toolbar chart-types">
        {chartTypes.map(chart => <IconButton key={chart.type} label={chart.label} aria-pressed={Boolean(dataset) && config.type === chart.type} disabled={!recommended.includes(chart.type)} onClick={() => { setConfig({ ...defaultConfig(chart.type, columns), interpolation: config.interpolation ?? 'linear', yScale: config.yScale, yDomain: config.yDomain }); setFitType('none'); resetWindow(); }}><chart.icon size={17} /></IconButton>)}
        <span className="toolbar-divider" />
        <IconButton label={config.interpolation === 'monotone' ? 'Smooth curves: click for straight segments' : 'Straight segments: click for smooth curves'} aria-pressed={config.interpolation === 'monotone'} disabled={!dataset || !['line', 'area'].includes(config.type)} onClick={() => setConfig({ ...config, interpolation: config.interpolation === 'monotone' ? 'linear' : 'monotone' })}><Spline size={17} /></IconButton>
        <label className="tooltip select-tooltip fit-control" data-tooltip="Fit a function"><select aria-label="Function fit" value={fitType} disabled={!canFit} onChange={event => setFitType(event.target.value as FitType)}>
          <option value="none">f(x)</option><option value="linear">ax+b</option><option value="quadratic">ax²+bx+c</option><option value="cubic">ax³+bx²+cx+d</option><option value="exponential">aeᵇˣ</option><option value="logarithmic">a ln(x)+b</option><option value="power">axᵇ</option>
        </select></label>
        <IconButton label="Y axis scale and bounds" aria-pressed={showScales} disabled={!dataset || config.type === 'pie'} onClick={() => setShowScales(value => !value)}><SlidersHorizontal size={16} /></IconButton>
        <span className="toolbar-spacer" />
        <IconButton label="Download chart: SVG" disabled={!rows.length || exporting} onClick={() => void downloadChart('svg')}><Download size={16} /></IconButton>
        <IconButton label="Download chart: PNG" disabled={!rows.length || exporting} onClick={() => void downloadChart('png')}><Download size={16} /><span className="format-dot">P</span></IconButton>
      </div>
      {dataset && <div className="axis-controls">
        <label className="tooltip axis-tooltip" data-tooltip="X axis"><select aria-label="X axis" value={config.xKey} onChange={event => { setConfig({ ...config, xKey: event.target.value }); resetWindow(); if (columns.find(column => column.key === event.target.value)?.type === 'text') setFitType('none'); }}>
          {columns.filter(column => config.type === 'scatter' || config.type === 'histogram' ? column.type === 'number' : true).map(column => <option value={column.key} key={column.key}>{column.key}</option>)}
        </select></label>
        {config.type !== 'histogram' && <>
          <label className="tooltip axis-tooltip" data-tooltip="Y axis"><select aria-label="Y axis" value={config.yKey} disabled={!numeric.length || config.aggregation === 'count' && config.type !== 'scatter'} onChange={event => setConfig({ ...config, yKey: event.target.value })}>
            {numeric.length ? numeric.map(column => <option value={column.key} key={column.key}>{column.key}</option>) : <option value="">∑</option>}
          </select></label>
          {config.type !== 'scatter' && <label className="tooltip aggregation-tooltip" data-tooltip="Aggregation: sum / average / count"><select aria-label="Aggregation" value={config.aggregation} onChange={event => setConfig({ ...config, aggregation: event.target.value as ChartConfig['aggregation'] })}>
            <option value="sum" disabled={!numeric.length}>∑</option>
            <option value="average" disabled={!numeric.length}>x̄</option>
            <option value="count">#</option>
          </select></label>}
        </>}
      </div>}
      {hasWindow && <div className="window-controls" aria-label={xType === 'date' ? 'Date window' : 'X axis window'}>
        <IconButton label="Zoom in: X axis" onClick={() => zoom(.5)} disabled={!extent}><ZoomIn size={16} /></IconButton>
        <IconButton label="Zoom out: X axis" onClick={() => zoom(2)} disabled={!extent}><ZoomOut size={16} /></IconButton>
        <label className="tooltip window-bound" data-tooltip={xType === 'date' ? 'From date: inclusive' : 'X minimum'}><input aria-label="Window start" type={xType === 'date' ? 'date' : 'number'} step="any" value={xWindow.min || (extent ? windowValue(extent.min, xType) : '')} onChange={event => { setXWindow(current => ({ ...current, min: event.target.value })); setTimePreset('custom'); }} /></label>
        <span aria-hidden="true">—</span>
        <label className="tooltip window-bound" data-tooltip={xType === 'date' ? 'To date: inclusive' : 'X maximum'}><input aria-label="Window end" type={xType === 'date' ? 'date' : 'number'} step="any" value={xWindow.max || (extent ? windowValue(extent.max, xType) : '')} onChange={event => { setXWindow(current => ({ ...current, max: event.target.value })); setTimePreset('custom'); }} /></label>
        {xType === 'date' && <label className="tooltip window-preset" data-tooltip="Time window: ending at the last date in your data"><select aria-label="Time window" value={timePreset} onChange={event => changePreset(event.target.value)}><option value="all">∞</option><option value="7">7d</option><option value="30">30d</option><option value="90">90d</option><option value="365">1y</option><option value="custom" disabled>…</option></select></label>}
        <IconButton label="Reset X window" onClick={resetWindow} disabled={!xWindow.min && !xWindow.max}><RotateCcw size={14} /></IconButton>
      </div>}
      {dataset && showScales && config.type !== 'pie' && <div className="scale-controls" aria-label="Y axis scale controls">
        <label className="tooltip" data-tooltip="Y scale: linear or logarithmic"><select aria-label="Y scale" value={config.yScale ?? 'linear'} onChange={event => setConfig({ ...config, yScale: event.target.value as 'linear' | 'log' })}><option value="linear">lin</option><option value="log">log</option></select></label>
        <label className="tooltip" data-tooltip="Y range: start at zero or fit to visible data"><select aria-label="Y range mode" value={config.yDomain ?? 'zero'} onChange={event => setConfig({ ...config, yDomain: event.target.value as 'zero' | 'auto', yMin: undefined, yMax: undefined })}><option value="zero">0</option><option value="auto">↕</option></select></label>
        <label className="tooltip scale-bound" data-tooltip="Y minimum: empty for automatic"><span aria-hidden="true">≥</span><input aria-label="Y minimum" type="number" step="any" value={config.yMin ?? ''} onChange={event => setConfig({ ...config, yMin: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
        <label className="tooltip scale-bound" data-tooltip="Y maximum: empty for automatic"><span aria-hidden="true">≤</span><input aria-label="Y maximum" type="number" step="any" value={config.yMax ?? ''} onChange={event => setConfig({ ...config, yMax: event.target.value === '' ? undefined : Number(event.target.value) })} /></label>
        <IconButton label="Reset Y scale" onClick={() => setConfig({ ...config, yScale: 'linear', yDomain: 'zero', yMin: undefined, yMax: undefined })}><RotateCcw size={14} /></IconButton>
      </div>}
      {invalidY && <div className="range-error" role="status">Y minimum must be less than Y maximum.</div>}
      {invalidX && <div className="range-error" role="status">Window start must not be after its end.</div>}
      {invalidLogBounds && <div className="range-error" role="status">Logarithmic bounds must be positive.</div>}
      <div ref={plot} className="plot-display">
        {dataset && <DataChart rows={rows} config={config} height={plotHeight} fit={fit.result} />}
        {fit.result && <div className="fit-equation" ref={equationRef} aria-label="Fitted function and coefficient of determination" title={`${fit.result.sampleCount.toLocaleString()} fitted observations`} dangerouslySetInnerHTML={{ __html: equation }} />}
        {fit.error && <div className="fit-error" role="status"><CircleAlert size={13} />{fit.error}</div>}
      </div>
    </section>
  </main>;
}
