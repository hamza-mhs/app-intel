// Small fetch helpers: timeout, browser-like UA, in-memory TTL cache, concurrency limit.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const cache = new Map(); // key -> { exp, value }

export const HOUR = 3600_000;

function cached(key) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  if (hit) cache.delete(key);
  return undefined;
}

export async function memo(key, ttl, fn) {
  const hit = cached(key);
  if (hit !== undefined) return hit;
  const value = await fn();
  cache.set(key, { exp: Date.now() + ttl, value });
  if (cache.size > 5000) cache.delete(cache.keys().next().value);
  return value;
}

async function raw(url, { timeout = 12_000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
    signal: AbortSignal.timeout(timeout),
    redirect: 'follow',
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`${res.status} ${res.statusText} for ${new URL(url).host}`);
    err.status = res.status;
    err.body = body.slice(0, 500);
    throw err;
  }
  return res;
}

export function getJSON(url, { ttl = HOUR, ...opts } = {}) {
  return memo(`json:${url}`, ttl, async () => (await raw(url, opts)).json());
}

export function getText(url, { ttl = HOUR, ...opts } = {}) {
  return memo(`text:${url}`, ttl, async () => (await raw(url, opts)).text());
}

// Run async fn over items with at most `n` in flight. Failed items resolve to null.
export async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch {
        out[idx] = null;
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export const toArr = (x) => (Array.isArray(x) ? x : x == null ? [] : [x]);

// Reviews sample -> velocity. dates: array of ISO strings (newest first not required).
export function reviewVelocity(dates, pageCap) {
  const ts = dates.map((d) => Date.parse(d)).filter(Number.isFinite).sort((a, b) => b - a);
  if (ts.length < 2) return { sampleSize: ts.length, spanDays: null, perDay: null };
  // If we got fewer than the page cap, the sample is the full recent history: measure to now.
  const newest = ts.length < pageCap ? Date.now() : ts[0];
  const spanDays = Math.max(1, (newest - ts[ts.length - 1]) / 86_400_000);
  return { sampleSize: ts.length, spanDays: +spanDays.toFixed(1), perDay: +(ts.length / spanDays).toFixed(3) };
}
