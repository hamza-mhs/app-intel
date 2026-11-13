// Sanity tests for the estimation engine: ordering, method selection, edge cases.
import assert from 'node:assert/strict';
import { estimate, DEFAULT_ASSUMPTIONS as A, pickPrice } from '../public/estimate.js';

const now = Date.parse('2026-11-01T00:00:00Z');
const daysAgo = (d) => new Date(now - d * 86_400_000).toISOString();
const ordered = (r, label) => assert.ok(r.low <= r.mid && r.mid <= r.high, `${label} not ordered: ${JSON.stringify(r)}`);
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

const ios = {
  store: 'ios', price: 0, offersIAP: true, iapPrices: [4.99, 9.99, 49.99], released: daysAgo(900),
  ratingsCount: 12000, ratingsCurrentVersion: 300, currentVersionReleased: daysAgo(30),
};
t('iOS uses current-version rating velocity', () => {
  const e = estimate(ios, A, [], now);
  assert.match(e.downloads.method, /since the current version/);
  // 300 ratings / 30 days = 10/day → ×30.44×80 ≈ 24,352/mo mid
  assert.ok(Math.abs(e.downloads.mid - 10 * 30.44 * 80) < 1);
  ordered(e.downloads, 'downloads'); ordered(e.revenue.mrr, 'mrr'); ordered(e.revenue.monthly, 'monthly');
});

t('iOS falls back to lifetime average when ratings were not reset', () => {
  const e = estimate({ ...ios, ratingsCurrentVersion: 12000 }, A, [], now);
  assert.match(e.downloads.method, /Lifetime ratings/);
  ordered(e.downloads, 'downloads');
});

t('Android uses review velocity with written-review ratio', () => {
  const a = { store: 'android', price: 0, offersIAP: true, iapPrices: [2.99, 49.99], iapRange: '$2.99 - $49.99',
    released: daysAgo(1200), installs: 5_000_000, ratingsCount: 80_000, reviewsCount: 20_000,
    reviewVelocity: { sampleSize: 150, spanDays: 10, perDay: 15 }, adSupported: true };
  const e = estimate(a, A, [], now);
  assert.match(e.downloads.method, /written review/);
  assert.ok(e.downloads.mid <= 5_000_000);
  assert.ok(e.revenue.ads && e.revenue.ads.mid > 0);
  ordered(e.downloads, 'downloads'); ordered(e.revenue.monthly, 'monthly');
});

t('History overrides models (Android install counter delta)', () => {
  const a = { store: 'android', installs: 1_100_000, released: daysAgo(400), offersIAP: false, price: 0 };
  const hist = [{ t: daysAgo(14), installs: 1_000_000 }, { t: daysAgo(0), installs: 1_100_000 }];
  const e = estimate(a, A, hist, now);
  assert.equal(e.downloads.confidence, 'high');
  assert.ok(Math.abs(e.downloads.mid - (100_000 / 14) * 30.44) < 1);
  assert.equal(e.revenue.mrr, null);
});

t('No IAP + free = zero revenue', () => {
  const e = estimate({ ...ios, offersIAP: false }, A, [], now);
  assert.equal(e.revenue.monthly.mid, 0);
});

t('Unknown IAP → low case zero', () => {
  const e = estimate({ ...ios, offersIAP: null, iapPrices: [] }, A, [], now);
  assert.equal(e.revenue.mrr.low, 0);
  assert.ok(e.revenue.mrr.mid > 0);
});

t('Yearly price detection', () => {
  const p = pickPrice({ store: 'ios', iapPrices: [29.99, 39.99, 59.99] }, A);
  assert.ok(p.yearly && Math.abs(p.monthly - 39.99 / 12) < 0.01);
});

t('No ratings, no release date → none, no crash', () => {
  const e = estimate({ store: 'ios', ratingsCount: 0, offersIAP: null }, A, [], now);
  assert.equal(e.downloads.confidence, 'none');
  assert.equal(e.revenue.monthly.mid, 0);
});

console.log(`\n${n} estimate tests passed`);
