// Apple App Store via free public endpoints (no key):
//  - iTunes Search / Lookup API      https://itunes.apple.com/search , /lookup
//  - Legacy RSS top charts (JSON)    https://itunes.apple.com/{cc}/rss/top{free|paid|grossing}applications/limit=N/json
//  - Marketing RSS v2 (fallback)     https://rss.marketingtools.apple.com/api/v2/{cc}/apps/top-{free|paid}/50/apps.json
//  - Customer reviews RSS (JSON)     https://itunes.apple.com/{cc}/rss/customerreviews/page=N/id={id}/sortby=mostrecent/json
//  - App page HTML (IAP prices, best effort, fragile)  https://apps.apple.com/{cc}/app/id{id}
import { getJSON, getText, HOUR, toArr, reviewVelocity, memo } from './http.js';

const CHART = { free: 'topfreeapplications', paid: 'toppaidapplications', grossing: 'topgrossingapplications' };

// Apple genre ids for the category filter.
export const IOS_GENRES = {
  '': 'All apps', 6000: 'Business', 6001: 'Weather', 6002: 'Utilities', 6003: 'Travel', 6004: 'Sports',
  6005: 'Social Networking', 6006: 'Reference', 6007: 'Productivity', 6008: 'Photo & Video', 6009: 'News',
  6010: 'Navigation', 6011: 'Music', 6012: 'Lifestyle', 6013: 'Health & Fitness', 6014: 'Games',
  6015: 'Finance', 6016: 'Entertainment', 6017: 'Education', 6018: 'Books', 6020: 'Medical',
  6023: 'Food & Drink', 6024: 'Shopping', 6026: 'Developer Tools', 6027: 'Graphics & Design',
};

export function normalizeLookup(r, extra = {}) {
  return {
    store: 'ios',
    id: String(r.trackId),
    bundleId: r.bundleId,
    name: r.trackName,
    developer: r.artistName || r.sellerName,
    developerId: r.artistId ? String(r.artistId) : null,
    icon: r.artworkUrl512 || r.artworkUrl100,
    url: r.trackViewUrl,
    genre: r.primaryGenreName,
    price: r.price ?? 0,
    currency: r.currency,
    free: !r.price,
    rating: r.averageUserRating ?? null,
    ratingsCount: r.userRatingCount ?? 0,
    ratingsCurrentVersion: r.userRatingCountForCurrentVersion ?? null,
    currentVersionReleased: r.currentVersionReleaseDate ?? null,
    installs: null, // Apple publishes no install counts
    released: r.releaseDate ?? null,
    updated: r.currentVersionReleaseDate ?? null,
    version: r.version,
    website: r.sellerUrl || null,
    description: r.description,
    screenshots: r.screenshotUrls || [],
    contentRating: r.contentAdvisoryRating,
    sizeMB: r.fileSizeBytes ? Math.round(r.fileSizeBytes / 1e6) : null,
    offersIAP: null, // unknown from lookup; filled from the app page when possible
    iapPrices: [],
    ...extra,
  };
}

export async function lookup(ids, country = 'us') {
  const out = [];
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const j = await getJSON(
      `https://itunes.apple.com/lookup?id=${chunk.join(',')}&country=${country}&entity=software`,
      { ttl: 6 * HOUR },
    );
    out.push(...toArr(j.results).filter((r) => r.wrapperType === 'software' || r.kind === 'software'));
  }
  return out;
}

export async function search(term, country = 'us', limit = 25) {
  const j = await getJSON(
    `https://itunes.apple.com/search?term=${encodeURIComponent(term)}&entity=software&country=${country}&limit=${limit}`,
    { ttl: 6 * HOUR },
  );
  return toArr(j.results).map((r) => normalizeLookup(r));
}

export async function byDeveloper(artistId, country = 'us', limit = 50) {
  const j = await getJSON(`https://itunes.apple.com/lookup?id=${artistId}&entity=software&country=${country}&limit=${limit}`, {
    ttl: 12 * HOUR,
  });
  return toArr(j.results).filter((r) => r.wrapperType === 'software').map((r) => normalizeLookup(r));
}

export async function chart({ chart = 'free', country = 'us', genre = '', limit = 100 }) {
  const notes = [];
  let rows = [];
  try {
    const url = `https://itunes.apple.com/${country}/rss/${CHART[chart]}/limit=${limit}${genre ? `/genre=${genre}` : ''}/json`;
    const j = await getJSON(url, { ttl: 3 * HOUR });
    rows = toArr(j?.feed?.entry).map((e, i) => ({ rank: i + 1, id: e?.id?.attributes?.['im:id'] }));
  } catch (e) {
    notes.push(`Legacy RSS chart failed (${e.message}).`);
  }
  if (!rows.length && chart !== 'grossing') {
    try {
      const j = await getJSON(`https://rss.marketingtools.apple.com/api/v2/${country}/apps/top-${chart}/50/apps.json`, {
        ttl: 3 * HOUR,
      });
      rows = toArr(j?.feed?.results).map((r, i) => ({ rank: i + 1, id: r.id }));
      notes.push('Used Apple marketing RSS fallback (max 50, no category filter).');
    } catch (e) {
      notes.push(`Marketing RSS fallback failed (${e.message}).`);
    }
  }
  if (!rows.length && chart === 'grossing') notes.push('Apple returned no top-grossing chart for this storefront.');
  const details = await lookup(rows.map((r) => r.id).filter(Boolean), country);
  const byId = new Map(details.map((d) => [String(d.trackId), d]));
  const apps = rows
    .filter((r) => byId.has(String(r.id)))
    .map((r) => normalizeLookup(byId.get(String(r.id)), { rank: r.rank, chart }));
  return { apps, notes };
}

export async function reviews(id, country = 'us', pages = 3) {
  const all = [];
  for (let p = 1; p <= pages; p++) {
    try {
      const j = await getJSON(
        `https://itunes.apple.com/${country}/rss/customerreviews/page=${p}/id=${id}/sortby=mostrecent/json`,
        { ttl: 6 * HOUR },
      );
      const entries = toArr(j?.feed?.entry).filter((e) => e['im:rating']);
      if (!entries.length) break;
      for (const e of entries) {
        all.push({
          author: e.author?.name?.label,
          score: Number(e['im:rating']?.label),
          title: e.title?.label,
          text: e.content?.label,
          date: e.updated?.label,
          version: e['im:version']?.label,
        });
      }
      if (entries.length < 50) break;
    } catch {
      break;
    }
  }
  return { reviews: all, velocity: reviewVelocity(all.map((r) => r.date), pages * 50) };
}

// Best effort: read In-App Purchase prices from the public App Store page.
// Apple changes this markup often; failure just means we fall back to default prices.
export async function iapPrices(id, country = 'us') {
  return memo(`iap:${country}:${id}`, 24 * HOUR, async () => {
    try {
      const html = await getText(`https://apps.apple.com/${country}/app/id${id}`, { ttl: 24 * HOUR });
      const idx = html.search(/In-App Purchase/i);
      if (idx < 0) return { offersIAP: false, prices: [] };
      const slice = html.slice(idx, idx + 30_000);
      const prices = [...slice.matchAll(/(?:US\$|\$|€|£)\s?(\d{1,4}(?:[.,]\d{2}))/g)]
        .map((m) => parseFloat(m[1].replace(',', '.')))
        .filter((n) => n > 0 && n < 1000);
      return { offersIAP: true, prices: [...new Set(prices)].slice(0, 15) };
    } catch (e) {
      return { offersIAP: null, prices: [], error: e.message };
    }
  });
}

export async function app(id, country = 'us') {
  const [r] = await lookup([id], country);
  if (!r) throw Object.assign(new Error('App not found in this storefront'), { status: 404 });
  const [rev, iap] = await Promise.all([reviews(id, country), iapPrices(id, country)]);
  return normalizeLookup(r, {
    offersIAP: iap.offersIAP,
    iapPrices: iap.prices,
    reviews: rev.reviews,
    reviewVelocity: rev.velocity,
  });
}
