// Google Play via the open-source google-play-scraper (MIT). It parses public Play pages,
// so it can break when Google changes markup. Install counts (maxInstalls) are Google's own number.
import gplayRaw from 'google-play-scraper';

// google-play-scraper uses got() with no timeout, so a stalled request can hang forever.
// Every call goes through this wrapper: 25s limit, then a normal error.
const TIMEOUT = +process.env.PLAY_TIMEOUT_MS || 25_000;
const withTimeout = (fn, name) => (...args) => {
  let t;
  return Promise.race([
    Promise.resolve().then(() => fn(...args)),
    new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`Google Play ${name} timed out after ${TIMEOUT / 1000}s`)), TIMEOUT); }),
  ]).finally(() => clearTimeout(t));
};
const gplay = { ...gplayRaw };
for (const k of ['app', 'list', 'search', 'developer', 'reviews', 'similar', 'suggest', 'permissions', 'datasafety', 'categories']) gplay[k] = withTimeout(gplayRaw[k], k);
import { memo, HOUR, pool, reviewVelocity } from './http.js';
import { catalogByIds } from './db.js';

export const PLAY_CATEGORIES = Object.keys(gplay.category);
const COLL = { free: gplay.collection.TOP_FREE, paid: gplay.collection.TOP_PAID, grossing: gplay.collection.GROSSING };

function iapBounds(range) {
  if (!range) return [];
  return [...String(range).matchAll(/(\d+(?:[.,]\d{1,2})?)/g)].map((m) => parseFloat(m[1].replace(',', '.')));
}

export function normalize(a, extra = {}) {
  return {
    store: 'android',
    id: a.appId,
    name: a.title,
    developer: a.developer,
    developerId: a.developerId || null,
    icon: a.icon,
    url: a.url,
    genre: a.genre,
    price: a.price ?? 0,
    currency: a.currency,
    free: a.free ?? !a.price,
    rating: a.score ?? null,
    ratingsCount: a.ratings ?? 0,
    reviewsCount: a.reviews ?? null,
    histogram: a.histogram || null,
    installs: a.maxInstalls ?? a.minInstalls ?? null,
    installsText: a.installs || null,
    released: a.released ? new Date(a.released).toISOString() : null,
    updated: a.updated ? new Date(a.updated).toISOString() : null,
    version: a.version,
    website: a.developerWebsite || null,
    developerEmail: a.developerEmail || null,
    description: a.description,
    screenshots: a.screenshots || [],
    contentRating: a.contentRating,
    offersIAP: a.offersIAP ?? null,
    iapRange: a.IAPRange || null,
    iapPrices: iapBounds(a.IAPRange),
    adSupported: a.adSupported ?? null,
    ...extra,
  };
}

const details = (appId, country) =>
  memo(`gp:app:${country}:${appId}`, 12 * HOUR, () => gplay.app({ appId, country, lang: 'en' }));

export async function chart({ chart = 'free', country = 'us', category = '', limit = 60 }) {
  const notes = [];
  const list = await memo(`gp:list:${chart}:${country}:${category}`, 3 * HOUR, () =>
    gplay.list({
      collection: COLL[chart],
      ...(category ? { category: gplay.category[category] } : {}),
      num: limit,
      country,
      lang: 'en',
    }),
  );
  if (!list.length) notes.push('Google Play returned an empty chart (the grossing chart is often unavailable on the web).');
  // Install counts: take them from the local catalog when known; fetch detail pages only for the rest (cached 12h).
  const known = catalogByIds('android', list.map((a) => a.appId));
  const need = list.filter((a) => known.get(a.appId)?.installs == null).slice(0, 30);
  const fetched = new Map((await pool(need, 6, (a) => details(a.appId, country))).filter(Boolean).map((d) => [d.appId, d]));
  const apps = list.map((a, i) => {
    const d = fetched.get(a.appId);
    if (d) return normalize(d, { rank: i + 1, chart });
    const k = known.get(a.appId);
    const n = normalize(a, { rank: i + 1, chart });
    if (k) Object.assign(n, { installs: k.installs, ratingsCount: k.ratings || n.ratingsCount, released: n.released || k.released, offersIAP: n.offersIAP ?? (k.iap == null ? null : !!k.iap), adSupported: n.adSupported ?? !!k.ad_supported, genre: n.genre || k.category });
    return n;
  });
  const missing = need.length - fetched.size;
  if (missing) notes.push(`${missing} app detail pages failed to load; their estimates are blank.`);
  return { apps, notes };
}

// Raw chart list without detail pages (used by the crawler, which fetches details only when stale).
export function listChart({ chart = 'free', country = 'us', category = '', num = 100 }) {
  return gplay.list({ collection: COLL[chart], ...(category ? { category: gplay.category[category] } : {}), num, country, lang: 'en' });
}
export const detailsFor = (appId, country = 'us') => details(appId, country);
// Light lists (no detail pages) for the expansion crawl.
export async function similarTo(appId, country = 'us') {
  return (await memo(`gp:sim:${country}:${appId}`, 24 * HOUR, () => gplay.similar({ appId, country, lang: 'en' }))).map((a) => normalize(a));
}
export async function devApps(devId, country = 'us') {
  return (await memo(`gp:devl:${country}:${devId}`, 24 * HOUR, () => gplay.developer({ devId, num: 60, country, lang: 'en' }))).map((a) => normalize(a));
}

// Fast search for the type-ahead: no detail pages, just title/icon/developer.
export async function quickSearch(term, country = 'us', num = 6) {
  const res = await memo(`gp:qs:${country}:${term}`, 6 * HOUR, () => gplay.search({ term, num, country, lang: 'en' }));
  return res.map((a) => normalize(a));
}

export async function search(term, country = 'us', limit = 25) {
  const res = await memo(`gp:search:${country}:${term}`, 6 * HOUR, () =>
    gplay.search({ term, num: limit, country, lang: 'en' }),
  );
  const full = await pool(res, 6, (a) => details(a.appId, country));
  return res.map((a, i) => normalize(full[i] || a));
}

export async function byDeveloper(devId, country = 'us') {
  const res = await memo(`gp:dev:${country}:${devId}`, 12 * HOUR, () =>
    gplay.developer({ devId, num: 30, country, lang: 'en' }),
  );
  const full = await pool(res, 6, (a) => details(a.appId, country));
  return res.map((a, i) => normalize(full[i] || a));
}

// Up to `num` reviews. sort: newest | rating | helpful (Play's own orderings).
export async function reviews(appId, country = 'us', sort = 'newest', num = 500) {
  const S = { newest: gplay.sort.NEWEST, rating: gplay.sort.RATING, helpful: gplay.sort.HELPFULNESS }[sort] || gplay.sort.NEWEST;
  const res = await memo(`gp:rev:${country}:${appId}:${sort}:${num}`, 6 * HOUR, () =>
    gplay.reviews({ appId, country, lang: 'en', sort: S, num }),
  );
  return (res.data || []).map((r) => ({
    id: r.id, author: r.userName, score: r.score, title: r.title || '', text: r.text, date: r.date,
    version: r.version, thumbsUp: r.thumbsUp, reply: r.replyText || null,
  }));
}

export async function app(appId, country = 'us') {
  const a = await details(appId, country).catch((e) => {
    throw Object.assign(new Error(`Google Play: ${e.message}`), { status: e.status || 404 });
  });
  const [rev, similar] = await Promise.all([
    memo(`gp:rev:${country}:${appId}`, 6 * HOUR, () =>
      gplay.reviews({ appId, country, lang: 'en', sort: gplay.sort.NEWEST, num: 150 }),
    ).catch(() => ({ data: [] })),
    memo(`gp:sim:${country}:${appId}`, 12 * HOUR, () => gplay.similar({ appId, country, lang: 'en' })).catch(() => []),
  ]);
  const reviews = (rev.data || []).map((r) => ({
    author: r.userName,
    score: r.score,
    text: r.text,
    date: r.date,
    version: r.version,
    thumbsUp: r.thumbsUp,
  }));
  return normalize(a, {
    reviews,
    reviewVelocity: reviewVelocity(reviews.map((r) => r.date), 150),
    similar: similar.slice(0, 12).map((s) => normalize(s)),
  });
}
