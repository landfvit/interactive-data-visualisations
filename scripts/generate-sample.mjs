import { mkdir, writeFile } from 'node:fs/promises';

const products = [
  { name: 'Coffee beans', demand: 80, price: 29, growth: 0.42, phase: 0.1 },
  { name: 'Electric kettle', demand: 42, price: 78, growth: 0.18, phase: 0.8 },
  { name: 'Travel mug', demand: 110, price: 18, growth: -0.16, phase: 1.7 },
  { name: 'French press', demand: 55, price: 46, growth: 0.65, phase: 2.4 },
  { name: 'Coffee grinder', demand: 25, price: 135, growth: 0.27, phase: 3.2 },
  { name: 'Tea', demand: 145, price: 12, growth: 0.08, phase: 4.1 },
  { name: 'Water bottle', demand: 65, price: 38, growth: -0.08, phase: 4.9 },
  { name: 'Pour-over set', demand: 34, price: 92, growth: 0.5, phase: 5.6 },
];
const regions = [
  { name: 'Europe', demand: 1.12, phase: 0 },
  { name: 'North America', demand: 1.25, phase: 0 },
  { name: 'Asia Pacific', demand: 1.08, phase: 0.5 },
  { name: 'South America', demand: 0.82, phase: Math.PI },
  { name: 'Africa', demand: 0.72, phase: 0.25 },
  { name: 'Middle East', demand: 0.91, phase: 0.1 },
];
const channels = [
  { name: 'Direct', demand: 1.05, conversion: 0.059, acquisition: 1.1 },
  { name: 'Organic Search', demand: 0.94, conversion: 0.043, acquisition: 0.6 },
  { name: 'Paid Search', demand: 1.18, conversion: 0.028, acquisition: 10.2 },
  { name: 'Email', demand: 0.77, conversion: 0.086, acquisition: 0.3 },
  { name: 'Retail', demand: 1.28, conversion: 0.145, acquisition: 3.8 },
];
const columns = [
  'date', 'product', 'region', 'channel', 'revenue', 'orders', 'cost', 'profit',
  'conversion_rate_pct', 'refunded_orders', 'customer_rating',
];
const rows = [columns.join(',')];
const dayCount = 1000;
const endDate = Date.UTC(2026, 9, 22);
const millisecondsPerDay = 86400000;
const startDate = endDate - (dayCount - 1) * millisecondsPerDay;
let seed = 20261023;
const random = () => {
  // fixed seeds make sample data reproducible
  seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const hash = (value) => {
  // independent hashes avoid linking region and channel
  let result = value >>> 0;
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  result = Math.imul(result ^ (result >>> 16), 0x45d9f3b);
  return (result ^ (result >>> 16)) >>> 0;
};
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const pulse = (day, center, width) => Math.exp(-0.5 * ((day - center) / width) ** 2);

for (let day = 0; day < dayCount; day++) {
  const timestamp = startDate + day * millisecondsPerDay;
  const date = new Date(timestamp);
  const dateLabel = date.toISOString().slice(0, 10);
  const annualPhase = (timestamp / millisecondsPerDay / 365.2425) * 2 * Math.PI;
  const weekday = date.getUTCDay();
  // five daily counts average ten across complete cycles
  const observationCount = 8 + (day % 5);
  const promotion = 1 + 0.95 * pulse(day, 150, 3) + 1.3 * pulse(day, 425, 2) + 0.8 * pulse(day, 775, 4);
  const disruption = 1 - 0.75 * pulse(day, 260, 3) - 0.62 * pulse(day, 610, 5) - 0.8 * pulse(day, 900, 2);
  const regime = day < 360 ? 1 : day < 640 ? 0.86 : day < 820 ? 1.13 : 1.02;

  for (let observation = 0; observation < observationCount; observation++) {
    const productIndex = (observation + day * 3) % products.length;
    const product = products[productIndex];
    const region = regions[hash(day * 31 + observation * 67 + 17) % regions.length];
    const channel = channels[hash(day * 53 + observation * 97 + 701) % channels.length];
    const seasonal = 1 + 0.24 * Math.sin(annualPhase + product.phase + region.phase);
    const weekly = 1 + (weekday === 0 || weekday === 6 ? 0.19 : -0.06) * (productIndex % 2 ? -1 : 1);
    const trend = 1 + product.growth * day / (dayCount - 1);
    const noise = 0.68 + random() * 0.64;
    const demand = product.demand * region.demand * channel.demand * seasonal * weekly * trend * promotion * disruption * regime * noise;
    // real zero activity and refund costs test edge cases
    const orders = random() < 0.006 ? 0 : Math.max(0, Math.round(demand));
    const refundRate = 0.01 + random() * 0.045 + (channel.name === 'Paid Search' ? 0.025 : 0);
    const refunds = orders === 0 ? (random() < 0.4 ? 1 : 0) : Math.min(orders, Math.round(orders * refundRate));
    const discount = promotion > 1.1 ? 0.82 : 0.94 + random() * 0.1;
    const unitPrice = product.price * (1 + 0.09 * day / (dayCount - 1)) * discount;
    const revenue = Number((orders * unitPrice).toFixed(2));
    const cost = Number((orders * (unitPrice * (0.55 + random() * 0.16) + channel.acquisition) + refunds * product.price + 18 + random() * 80).toFixed(2));
    const profit = Number((revenue - cost).toFixed(2));
    const conversionRate = orders === 0 ? 0 : clamp(channel.conversion * (0.7 + random() * 0.6) * (promotion > 1.1 ? 1.2 : 1), 0.002, 0.3);
    const satisfaction = clamp(4.15 + productIndex * 0.04 - refundRate * 8 + (random() - 0.5) * 1.2, 1, 5);
    const satisfactionValue = orders === 0 || random() < 0.03 ? '' : satisfaction.toFixed(2);

    rows.push([
      dateLabel, product.name, region.name, channel.name, revenue.toFixed(2), orders,
      cost.toFixed(2), profit.toFixed(2), (conversionRate * 100).toFixed(2), refunds,
      satisfactionValue,
    ].join(','));
  }
}

const destination = new URL('../public/sample-large.csv', import.meta.url);
await mkdir(new URL('../public/', import.meta.url), { recursive: true });
await writeFile(destination, `${rows.join('\n')}\n`);
console.log(`wrote ${rows.length - 1} sample rows across ${dayCount} days`);
