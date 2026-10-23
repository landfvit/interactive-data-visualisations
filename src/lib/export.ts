const SVG_NS = 'http://www.w3.org/2000/svg';
const fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const styleProperties = [
  'color', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-opacity', 'stroke-dasharray', 'stroke-dashoffset', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'opacity', 'font-family', 'font-size',
  'font-style', 'font-weight', 'letter-spacing', 'text-anchor', 'dominant-baseline',
  'text-decoration', 'paint-order', 'vector-effect', 'visibility', 'display',
];

function svgNode<K extends keyof SVGElementTagNameMap>(tag: K, attributes: Record<string, string | number>) {
  const element = document.createElementNS(SVG_NS, tag);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function inlineStyles(source: SVGSVGElement, clone: SVGSVGElement) {
  const originals = [source, ...source.querySelectorAll<SVGElement>('*')];
  const copies = [clone, ...clone.querySelectorAll<SVGElement>('*')];
  originals.forEach((element, index) => {
    const computed = getComputedStyle(element);
    styleProperties.forEach((property) => {
      let value = computed.getPropertyValue(property);
      // local references keep gradients and clip paths portable
      value = value.replace(/url\(["']?[^)"']*#([^)'"\s]+)["']?\)/g, 'url(#$1)');
      if (value) copies[index].style.setProperty(property, value);
    });
    copies[index].style.setProperty('font-family', fontFamily);
  });
  clone.querySelectorAll('.recharts-tooltip-cursor, .recharts-active-dot').forEach((element) => element.remove());
}

function appendLegend(target: SVGSVGElement, legend: HTMLElement, x: number, y: number): { width: number; height: number } {
  const context = document.createElement('canvas').getContext('2d');
  if (context) context.font = `11px ${fontFamily}`;
  let width = 132;
  Array.from(legend.children).forEach((row, index) => {
    const label = row.querySelector<HTMLElement>('[title]');
    const swatch = row.querySelector<HTMLElement>('span');
    const value = row.children[1];
    const name = label?.title || label?.textContent || '';
    const number = value?.textContent?.trim() || '';
    width = Math.max(width, 18 + (context?.measureText(name).width ?? name.length * 7), 18 + (context?.measureText(number).width ?? number.length * 7));
    const rowY = y + index * 46;
    target.append(svgNode('rect', { x, y: rowY + 3, width: 7, height: 7, rx: 2, fill: swatch ? getComputedStyle(swatch).backgroundColor : '#5265f5' }));
    const labelNode = svgNode('text', { x: x + 14, y: rowY + 10, fill: '#68758a', 'font-size': 11, 'font-family': fontFamily });
    labelNode.textContent = name;
    const valueNode = svgNode('text', { x: x + 14, y: rowY + 29, fill: '#2d374b', 'font-size': 11, 'font-weight': 600, 'font-family': fontFamily });
    valueNode.textContent = number;
    target.append(labelNode, valueNode);
  });
  return { width, height: legend.children.length * 46 };
}

function chartSvg(element: HTMLElement): { markup: string; width: number; height: number } {
  const source = element.querySelector<SVGSVGElement>('svg.recharts-surface');
  if (!source) throw new Error('Add data before downloading a chart.');
  const bounds = source.getBoundingClientRect();
  if (!bounds.width || !bounds.height) throw new Error('The chart must be visible before downloading.');
  const padding = 24;
  const plotWidth = Math.ceil(bounds.width);
  const plotHeight = Math.ceil(bounds.height);
  const target = svgNode('svg', { xmlns: SVG_NS, role: 'img' });
  const chart = source.cloneNode(true) as SVGSVGElement;
  inlineStyles(source, chart);
  chart.setAttribute('x', String(padding));
  chart.setAttribute('y', String(padding));
  chart.setAttribute('width', String(plotWidth));
  chart.setAttribute('height', String(plotHeight));
  if (!chart.hasAttribute('viewBox')) chart.setAttribute('viewBox', `0 0 ${plotWidth} ${plotHeight}`);
  target.append(chart);
  let width = plotWidth + padding * 2;
  let height = plotHeight + padding * 2;
  const legend = element.querySelector<HTMLElement>('.data-chart-legend');
  if (legend?.children.length) {
    // use full labels even when the live legend truncates them
    const size = appendLegend(target, legend, padding + plotWidth + 24, padding);
    width += 24 + Math.ceil(size.width);
    height = Math.max(height, size.height + padding * 2);
  }
  target.setAttribute('width', String(width));
  target.setAttribute('height', String(height));
  target.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const title = svgNode('title', {});
  title.textContent = element.querySelector('figure')?.getAttribute('aria-label') || element.getAttribute('aria-label') || 'Chart';
  target.prepend(svgNode('rect', { width, height, fill: '#fff' }));
  target.prepend(title);
  return { markup: new XMLSerializer().serializeToString(target), width, height };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export async function exportChart(element: HTMLElement, format: 'svg' | 'png', filename: string): Promise<void> {
  const { markup, width, height } = chartSvg(element);
  const svg = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const name = filename.replace(/\.(svg|png)$/i, '').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim() || 'chart';
  if (format === 'svg') {
    download(svg, `${name}.svg`);
    return;
  }
  const url = URL.createObjectURL(svg);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    // cap large exports while retaining sharp pixels on typical screens
    const scale = Math.min(2, 8192 / width, 8192 / height);
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('This browser could not create a chart image.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('This browser could not create a PNG image.');
    download(blob, `${name}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
