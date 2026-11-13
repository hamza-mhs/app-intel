// TrustMRR: payment-provider-verified revenue.
//  - Without a key: public discovery feed (2 lists × 25 startups).
//  - With TRUSTMRR_API_KEY (create one in their developer dashboard): the official API, which lists
//    ALL startups. Synced into SQLite in the background, respecting their 10 req/min limit.
// Their terms ask users not to scrape the website, so this uses only the feed and the official API.
import { getJSON, HOUR } from './http.js';
import { db, kvGet, kvSet } from './db.js';

const appIds = (website) => ({
  iosId: website?.match(/apps\.apple\.com\/.*?id(\d{6,})/)?.[1] || null,
  playId: website?.match(/play\.google\.com\/store\/apps\/details\?id=([\w.]+)/)?.[1] || null,
});

export async function discovery() {
  const j = await getJSON('https://trustmrr.com/api/ai/discovery', { ttl: 6 * HOUR });
  const tag = (list, src) => (list || []).map((s) => ({ ...s, list: src, ...appIds(s.website) }));
  const all = [...tag(j.fastestGrowingStartups, 'Fastest growing'), ...tag(j.recentlyAddedStartups, 'Recently added')];
  const seen = new Set();
  return all.filter((s) => (seen.has(s.slug) ? false : seen.add(s.slug)));
}

export const apiConfigured = () => Boolean(process.env.TRUSTMRR_API_KEY);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let syncing = null;

export function syncStatus() {
  const count = db.prepare('SELECT count(*) n FROM trustmrr').get().n;
  return { configured: apiConfigured(), count, lastSync: kvGet('trustmrr_last_sync'), running: Boolean(syncing), progress: kvGet('trustmrr_progress') };
}

// Full sync of every startup via GET /api/v1/startups (10 per page). ~6.5s between calls = under 10/min.
export function syncAll() {
  if (!apiConfigured() || syncing) return syncing;
  syncing = (async () => {
    const ins = db.prepare(`INSERT INTO trustmrr (slug,category,mrr,data,synced_at) VALUES (?,?,?,?,?)
      ON CONFLICT(slug) DO UPDATE SET category=excluded.category, mrr=excluded.mrr, data=excluded.data, synced_at=excluded.synced_at`);
    let page = 1;
    try {
      for (;;) {
        const res = await fetch(`https://trustmrr.com/api/v1/startups?page=${page}&limit=10&sort=revenue-desc`, {
          headers: { Authorization: `Bearer ${process.env.TRUSTMRR_API_KEY}` },
          signal: AbortSignal.timeout(20_000),
        });
        if (res.status === 429) {
          const reset = +res.headers.get('x-ratelimit-reset');
          await sleep(Math.max(5_000, reset ? reset * 1000 - Date.now() + 1000 : 60_000));
          continue;
        }
        if (!res.ok) throw new Error(`TrustMRR API ${res.status}: ${(await res.text()).slice(0, 200)}`);
        const j = await res.json();
        const now = new Date().toISOString();
        for (const s of j.data || []) {
          // API amounts are in USD cents; convert to dollars to match the discovery feed.
          const rev = s.revenue || {};
          const row = {
            ...s, ...appIds(s.website),
            revenue: { mrr: (rev.mrr ?? 0) / 100, last30Days: (rev.last30Days ?? 0) / 100, total: (rev.total ?? 0) / 100 },
            askingPrice: s.askingPrice != null ? s.askingPrice / 100 : null,
          };
          ins.run(s.slug, s.category || null, row.revenue.mrr, JSON.stringify(row), now);
        }
        kvSet('trustmrr_progress', `page ${page} of ~${Math.ceil((j.meta?.total || 0) / 10)}`);
        if (!j.meta?.hasMore) break;
        page++;
        await sleep(6_500);
      }
      kvSet('trustmrr_last_sync', new Date().toISOString());
      kvSet('trustmrr_progress', 'done');
    } catch (e) {
      kvSet('trustmrr_progress', `error on page ${page}: ${e.message}`);
      console.error('TrustMRR sync:', e.message);
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

export function listSynced({ category = '', q = '', appsOnly = false, limit = 300 } = {}) {
  const where = [];
  const p = [];
  if (category) { where.push('category = ?'); p.push(category); }
  if (q) { where.push('data LIKE ?'); p.push(`%${q}%`); }
  if (appsOnly) where.push(`(data LIKE '%apps.apple.com%' OR data LIKE '%play.google.com%')`);
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return db.prepare(`SELECT data FROM trustmrr ${W} ORDER BY mrr DESC LIMIT ${Math.min(1000, +limit || 300)}`).all(...p)
    .map((r) => ({ ...JSON.parse(r.data), list: 'API' }));
}

export function syncedCategories() {
  return db.prepare('SELECT category, count(*) n FROM trustmrr WHERE category IS NOT NULL GROUP BY category ORDER BY n DESC').all();
}
