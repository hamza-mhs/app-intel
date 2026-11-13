// Local SQLite (Node's built-in node:sqlite, Node ≥ 22.5) for the app catalog and TrustMRR sync.
// Catalog rows come from: the AppGoblin bulk import (~5M apps), plus every app this tool sees
// in a chart, search or detail page.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(DIR, { recursive: true });
export const db = new DatabaseSync(path.join(DIR, 'intel.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 15000;
CREATE TABLE IF NOT EXISTS catalog (
  store TEXT NOT NULL, id TEXT NOT NULL, name TEXT, developer TEXT, developer_id TEXT, category TEXT,
  price REAL, ad_supported INTEGER, iap INTEGER, installs INTEGER, ratings INTEGER, rating REAL,
  released TEXT, updated TEXT, icon TEXT, source TEXT, seen_at TEXT,
  PRIMARY KEY (store, id)
);
CREATE INDEX IF NOT EXISTS cat_category ON catalog(store, category);
CREATE INDEX IF NOT EXISTS cat_installs ON catalog(installs DESC);
CREATE INDEX IF NOT EXISTS cat_ratings ON catalog(ratings DESC);
CREATE INDEX IF NOT EXISTS cat_name ON catalog(name COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS cat_store_name ON catalog(store, name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS trustmrr (slug TEXT PRIMARY KEY, category TEXT, mrr REAL, data TEXT, synced_at TEXT);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS expand_done (key TEXT PRIMARY KEY, at TEXT);
CREATE TABLE IF NOT EXISTS chart_ranks (
  day TEXT NOT NULL, store TEXT NOT NULL, country TEXT NOT NULL, chart TEXT NOT NULL, category TEXT NOT NULL,
  rank INTEGER NOT NULL, id TEXT NOT NULL,
  PRIMARY KEY (day, store, country, chart, category, rank)
);
CREATE INDEX IF NOT EXISTS cr_app ON chart_ranks(store, id);
CREATE INDEX IF NOT EXISTS cr_combo ON chart_ranks(store, country, chart, category, day);
`);

// Migration: live_at marks rows whose update date came from the live store (not the bulk snapshot).
if (!db.prepare("SELECT 1 FROM pragma_table_info('catalog') WHERE name='live_at'").get()) db.exec('ALTER TABLE catalog ADD COLUMN live_at TEXT');

const upsertStmt = db.prepare(`
INSERT INTO catalog (store,id,name,developer,developer_id,category,price,ad_supported,iap,installs,ratings,rating,released,updated,icon,source,seen_at,live_at)
VALUES ($store,$id,$name,$developer,$developer_id,$category,$price,$ad_supported,$iap,$installs,$ratings,$rating,$released,$updated,$icon,$source,$seen_at,$live_at)
ON CONFLICT(store,id) DO UPDATE SET
  name=coalesce(excluded.name,name), developer=coalesce(excluded.developer,developer),
  developer_id=coalesce(excluded.developer_id,developer_id), category=coalesce(excluded.category,category),
  price=coalesce(excluded.price,price), ad_supported=coalesce(excluded.ad_supported,ad_supported),
  iap=coalesce(excluded.iap,iap), installs=coalesce(excluded.installs,installs),
  ratings=coalesce(excluded.ratings,ratings), rating=coalesce(excluded.rating,rating),
  released=coalesce(excluded.released,released), updated=coalesce(excluded.updated,updated),
  icon=coalesce(excluded.icon,icon), seen_at=excluded.seen_at, live_at=coalesce(excluded.live_at,live_at)`);

const b = (x) => (x == null ? null : x ? 1 : 0);

// All multi-row writes go through tx(): synchronous only (never await inside), and safe if a
// transaction is somehow already open (joins it instead of failing or ending someone else's).
export function tx(fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw e;
  }
}

export function upsertRow(r) {
  upsertStmt.run({
    $store: r.store, $id: String(r.id), $name: r.name ?? null, $developer: r.developer ?? null,
    $developer_id: r.developer_id ?? null, $category: r.category ?? null, $price: r.price ?? null,
    $ad_supported: r.ad_supported ?? null, $iap: r.iap ?? null, $installs: r.installs ?? null,
    $ratings: r.ratings ?? null, $rating: r.rating ?? null, $released: r.released ?? null,
    $updated: r.updated ?? null, $icon: r.icon ?? null, $source: r.source ?? 'seen',
    $seen_at: new Date().toISOString(),
    $live_at: r.live ? new Date().toISOString() : null,
  });
}

// Normalized app (from lib/ios.js or lib/android.js) → catalog row.
export function upsertApps(apps) {
  if (!apps?.length) return;
  try {
    tx(() => {
      for (const a of apps) {
        if (!a?.id || a.demo) continue;
        upsertRow({
          store: a.store, id: a.id, name: a.name, developer: a.developer, developer_id: a.developerId,
          category: a.genre, price: a.price, ad_supported: b(a.adSupported), iap: b(a.offersIAP),
          installs: a.installs, ratings: a.ratingsCount || null, rating: a.rating, released: a.released,
          updated: a.updated, icon: a.icon, source: 'seen', live: Boolean(a.updated),
        });
      }
    });
  } catch (e) {
    console.error('catalog upsert failed:', e.message);
  }
}

const SORTS = {
  installs: 'coalesce(installs, ratings * 60) DESC', ratings: 'ratings DESC', rating: 'rating DESC',
  newest: 'released DESC', updated: 'updated DESC', name: 'name COLLATE NOCASE ASC',
};

export function queryCatalog(q) {
  const where = [];
  const p = {};
  if (q.store === 'ios' || q.store === 'android') { where.push('store = $store'); p.$store = q.store; }
  if (q.category) { where.push('category = $category'); p.$category = q.category; }
  if (q.q) { where.push('(name LIKE $q OR developer LIKE $q)'); p.$q = `%${q.q}%`; }
  if (q.developer) { where.push('developer LIKE $dev'); p.$dev = `%${q.developer}%`; }
  if (+q.minInstalls) { where.push('installs >= $mi'); p.$mi = +q.minInstalls; }
  if (+q.maxInstalls) { where.push('installs <= $xi'); p.$xi = +q.maxInstalls; }
  if (+q.minRatings) { where.push('ratings >= $mr'); p.$mr = +q.minRatings; }
  if (+q.maxRatings) { where.push('ratings <= $xr'); p.$xr = +q.maxRatings; }
  if (+q.minRating) { where.push('rating >= $rt'); p.$rt = +q.minRating; }
  if (q.iap === '1' || q.iap === '0') { where.push('iap = $iap'); p.$iap = +q.iap; }
  if (q.ads === '1' || q.ads === '0') { where.push('ad_supported = $ads'); p.$ads = +q.ads; }
  if (q.paid === '1') where.push('price > 0');
  if (q.paid === '0') where.push('(price = 0 OR price IS NULL)');
  if (q.releasedAfter) { where.push('released >= $ra'); p.$ra = q.releasedAfter; }
  if (q.updatedAfter) { where.push('updated >= $ua'); p.$ua = q.updatedAfter; }
  const W = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(200, Math.max(1, +q.limit || 50));
  const page = Math.max(1, +q.page || 1);
  const order = SORTS[q.sort] || SORTS.ratings;
  const rows = db.prepare(`SELECT * FROM catalog ${W} ORDER BY ${order} NULLS LAST, ratings DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`).all(p);
  // Exact counts over millions of rows are slow; cap the count scan.
  const total = db.prepare(`SELECT count(*) n FROM (SELECT 1 FROM catalog ${W} LIMIT 100001)`).get(p).n;
  return { rows, total, capped: total > 100000, page, limit };
}

export function catalogStats() {
  const byStore = db.prepare('SELECT store, count(*) n FROM catalog GROUP BY store').all();
  const cats = db.prepare('SELECT store, category, count(*) n FROM catalog WHERE category IS NOT NULL GROUP BY store, category ORDER BY n DESC').all();
  const bySource = db.prepare('SELECT source, count(*) n FROM catalog GROUP BY source').all();
  return { byStore, categories: cats, bySource };
}

export const kvGet = (k) => db.prepare('SELECT v FROM kv WHERE k = ?').get(k)?.v ?? null;
export const kvSet = (k, v) => db.prepare('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, String(v));

// ---------- Search suggestions (prefix match on the NOCASE index) ----------
export function suggestLocal(q, limit = 6) {
  const a = q.trim();
  if (!a) return [];
  return db.prepare(`SELECT store,id,name,developer,icon,ratings,installs,category FROM catalog
    WHERE name COLLATE NOCASE >= $a AND name COLLATE NOCASE < $b
    ORDER BY coalesce(ratings,0) DESC LIMIT ${limit}`).all({ $a: a, $b: a + '￿' });
}

// ---------- Chart rank history ----------
const rankStmt = db.prepare(`INSERT OR REPLACE INTO chart_ranks (day,store,country,chart,category,rank,id) VALUES (?,?,?,?,?,?,?)`);
export function recordRanks({ day, store, country, chart, category, ids }) {
  tx(() => {
    db.prepare('DELETE FROM chart_ranks WHERE day=? AND store=? AND country=? AND chart=? AND category=?').run(day, store, country, chart, category);
    ids.forEach((id, i) => rankStmt.run(day, store, country, chart, category, i + 1, String(id)));
  });
}

export function crawledDays(store, country) {
  return db.prepare('SELECT DISTINCT day FROM chart_ranks WHERE store=? AND country=? ORDER BY day DESC').all(store, country).map((r) => r.day);
}

// Latest chart for a combo, with rank change vs ~7 days earlier and first-seen date in this chart.
export function chartWithHistory({ store, country, chart, category }) {
  const days = db.prepare('SELECT DISTINCT day FROM chart_ranks WHERE store=? AND country=? AND chart=? AND category=? ORDER BY day DESC')
    .all(store, country, chart, category).map((r) => r.day);
  if (!days.length) return { day: null, rows: [], days: 0 };
  const latest = days[0];
  const target = new Date(Date.parse(latest) - 7 * 864e5).toISOString().slice(0, 10);
  const prev = days.find((d) => d <= target) || (days.length > 1 ? days[days.length - 1] : null);
  const rows = db.prepare(`
    SELECT r.rank, r.id, c.*,
      (SELECT p.rank FROM chart_ranks p WHERE p.day=$prev AND p.store=r.store AND p.country=r.country AND p.chart=r.chart AND p.category=r.category AND p.id=r.id) AS prev_rank,
      (SELECT min(f.day) FROM chart_ranks f WHERE f.store=r.store AND f.country=r.country AND f.chart=r.chart AND f.category=r.category AND f.id=r.id) AS first_day
    FROM chart_ranks r LEFT JOIN catalog c ON c.store=r.store AND c.id=r.id
    WHERE r.day=$day AND r.store=$store AND r.country=$country AND r.chart=$chart AND r.category=$category
    ORDER BY r.rank`).all({ $day: latest, $prev: prev, $store: store, $country: country, $chart: chart, $category: category });
  return { day: latest, prevDay: prev, firstDay: days[days.length - 1], days: days.length, rows };
}

// Every category's latest grossing chart for one store/country (for the category overview).
// Each chart's own latest crawled day, so a crawl in progress today doesn't hide yesterday's complete data.
export const LATEST = `latest AS (SELECT store, country, chart, category, max(day) AS day FROM chart_ranks WHERE store=$store AND country=$country GROUP BY store, country, chart, category)`;

export function grossingByCategory({ store, country, top = 50 }) {
  const rows = db.prepare(`WITH ${LATEST}
    SELECT r.category AS chart_category, r.rank, r.day AS chart_day, c.* FROM chart_ranks r
    JOIN latest l ON l.store=r.store AND l.country=r.country AND l.chart=r.chart AND l.category=r.category AND l.day=r.day
    LEFT JOIN catalog c ON c.store=r.store AND c.id=r.id
    WHERE r.chart='grossing' AND r.rank <= $top ORDER BY r.category, r.rank`).all({ $store: store, $country: country, $top: top });
  const day = rows.reduce((m, r) => (r.chart_day > m ? r.chart_day : m), '') || null;
  return { day, rows };
}

export function chartDoneOn(day, j) {
  return Boolean(db.prepare('SELECT 1 FROM chart_ranks WHERE day=? AND store=? AND country=? AND chart=? AND category=? LIMIT 1').get(day, j.store, j.country, j.chart, j.category));
}

export function staleOrMissing(store, ids, days = 7) {
  const cutoff = new Date(Date.now() - days * 864e5).toISOString();
  const q = db.prepare('SELECT seen_at, installs FROM catalog WHERE store=? AND id=?');
  return ids.filter((id) => {
    const r = q.get(store, String(id));
    return !r || r.installs == null || !r.seen_at || r.seen_at < cutoff;
  });
}

// ---------- Expansion crawl bookkeeping ----------
export function expandDue(key, days = 30) {
  const r = db.prepare('SELECT at FROM expand_done WHERE key=?').get(key);
  return !r || Date.now() - Date.parse(r.at) > days * 864e5;
}
export const expandMark = (key) => db.prepare('INSERT OR REPLACE INTO expand_done (key, at) VALUES (?, ?)').run(key, new Date().toISOString());
export function latestChartLeads(store, country, maxRank = 50) {
  const day = db.prepare('SELECT max(day) d FROM chart_ranks WHERE store=? AND country=?').get(store, country).d;
  if (!day) return { apps: [], devs: [] };
  const apps = db.prepare(`SELECT id, min(rank) best FROM chart_ranks WHERE day=? AND store=? AND country=? AND rank<=? GROUP BY id ORDER BY best`).all(day, store, country, maxRank).map((r) => r.id);
  const devs = db.prepare(`SELECT c.developer_id dev, min(r.rank) best FROM chart_ranks r JOIN catalog c ON c.store=r.store AND c.id=r.id
    WHERE r.day=? AND r.store=? AND r.country=? AND c.developer_id IS NOT NULL GROUP BY c.developer_id ORDER BY best`).all(day, store, country).map((r) => r.dev);
  return { apps, devs };
}
export function missingDetails(store, limit) {
  return db.prepare(`SELECT id FROM catalog WHERE store=? AND installs IS NULL AND (source IS NULL OR source != 'appgoblin') ORDER BY coalesce(rating,0) DESC LIMIT ${limit}`).all(store).map((r) => r.id);
}

export function catalogByIds(store, ids) {
  if (!ids.length) return new Map();
  const q = db.prepare('SELECT * FROM catalog WHERE store=? AND id=?');
  return new Map(ids.map((id) => [String(id), q.get(store, String(id))]).filter(([, r]) => r));
}
