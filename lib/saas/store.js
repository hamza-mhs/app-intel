// Unified SaaS catalog: every product from every source in one table, plus its reviews.
// key = "<source>:<id>", e.g. research:12, zap:tidio, yc:240, trustmrr:<slug>, hn:<objectID>, atl:<addonKey>.
// The same company found by several sources (same website domain) is merged: one canonical row is shown
// (research > TrustMRR > Zapier > YC > Product Hunt > Show HN > the rest) and the others feed it data.
import { db, tx } from '../db.js';
import { scoreProduct } from './score.js';

db.exec(`
CREATE TABLE IF NOT EXISTS saas_products (
  key TEXT PRIMARY KEY, source TEXT NOT NULL, name TEXT, url TEXT, website TEXT, developer TEXT,
  category TEXT, description TEXT, icon TEXT,
  rating REAL, reviews INTEGER, installs INTEGER, stars TEXT,
  price_min REAL, pricing TEXT, free_plan INTEGER, model TEXT,
  mrr REAL, revenue_text TEXT, launched TEXT, updated TEXT, extra TEXT,
  listed_at TEXT, detail_at TEXT, reviews_at TEXT,
  score INTEGER, verdict TEXT, pillars TEXT, angles TEXT, themes TEXT, confidence TEXT
);
CREATE INDEX IF NOT EXISTS sp_source ON saas_products(source, detail_at);
CREATE INDEX IF NOT EXISTS sp_score ON saas_products(score DESC);
CREATE INDEX IF NOT EXISTS sp_cat ON saas_products(category);
CREATE INDEX IF NOT EXISTS sp_name ON saas_products(name COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS saas_reviews (
  key TEXT NOT NULL, rid TEXT NOT NULL, stars INTEGER, date TEXT, author TEXT, text TEXT, url TEXT,
  PRIMARY KEY (key, rid)
);
CREATE TABLE IF NOT EXISTS saas_sources (
  source TEXT PRIMARY KEY, status TEXT, progress TEXT, last_ok TEXT, last_error TEXT, last_error_at TEXT, runs INTEGER DEFAULT 0
);
`);
// Migrations (safe to re-run).
const cols = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
const pc = cols('saas_products');
for (const [c, type] of [['domain', 'TEXT'], ['dup_of', 'TEXT'], ['listings_at', 'TEXT'], ['neg', 'INTEGER']]) if (!pc.has(c)) db.exec(`ALTER TABLE saas_products ADD COLUMN ${c} ${type}`);
if (!cols('saas_reviews').has('origin')) db.exec('ALTER TABLE saas_reviews ADD COLUMN origin TEXT');
db.exec('CREATE INDEX IF NOT EXISTS sp_domain ON saas_products(domain); CREATE INDEX IF NOT EXISTS sp_dup ON saas_products(dup_of, score DESC)');

// Which sources count as SaaS. Default: general software businesses. Platform add-on stores
// (Shopify apps, WordPress plugins) are off as listings; set SAAS_SOURCES in .env to change it.
export const DEFAULT_SOURCES = 'research,zap,yc,trustmrr,hn,ph,atl';
export const ENABLED = new Set((process.env.SAAS_SOURCES || DEFAULT_SOURCES).split(',').map((x) => x.trim()).filter(Boolean));
const ON = () => `source IN (${[...ENABLED].map((x) => `'${x.replace(/'/g, '')}'`).join(',')})`;
const PRIORITY = ['research', 'trustmrr', 'zap', 'yc', 'ph', 'hn', 'atl', 'shopify', 'wp'];
const prio = (s) => { const i = PRIORITY.indexOf(s); return i < 0 ? 99 : i; };

// Hosts that are listings/directories, not the product's own site.
const NOT_OWN = /(^|\.)(github\.com|gitlab\.com|ycombinator\.com|producthunt\.com|apps\.shopify\.com|wordpress\.org|zapier\.com|trustmrr\.com|marketplace\.atlassian\.com|apps\.apple\.com|play\.google\.com|linkedin\.com|twitter\.com|x\.com|facebook\.com|medium\.com|substack\.com|notion\.site|google\.com|youtube\.com|bit\.ly|linktr\.ee)$/i;
// "https://www.zoho.com/crm/?x" → "zoho.com/crm"; "https://tidio.com/" → "tidio.com". The first path segment is kept
// so different products of one company (Zoho CRM vs Zoho Books) are not merged.
const LANG_SEG = /^([a-z]{2}(-[a-z]{2})?|home|index\.html?|products?|apps?)$/i;
export function domainOf(u) {
  if (!u) return null;
  let url;
  try { url = new URL(/^https?:/i.test(u) ? u : `https://${u}`); } catch { return null; }
  const h = url.hostname.toLowerCase().replace(/^(www\d?|app|get|try|my|go|home|web)\./, '');
  if (!h.includes('.') || NOT_OWN.test(h)) return null;
  const seg = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
  return seg && !LANG_SEG.test(seg) ? `${h}/${seg}` : h;
}
// Same product site? Exact match, or same host when one side has no path (then the caller also checks the name).
export const sameSite = (a, b) => Boolean(a && b) && (a === b || (a.split('/')[0] === b.split('/')[0] && (!a.includes('/') || !b.includes('/'))));

export const LISTING_SOURCES = new Set(['ios', 'gp', 'wp', 'shopify', 'atl']);

const COLS = ['source', 'name', 'url', 'website', 'developer', 'category', 'description', 'icon', 'rating', 'reviews', 'installs', 'stars',
  'price_min', 'pricing', 'free_plan', 'model', 'mrr', 'revenue_text', 'launched', 'updated', 'extra', 'listed_at', 'detail_at', 'reviews_at', 'domain'];
const upsert = db.prepare(`INSERT INTO saas_products (key, ${COLS.join(',')}) VALUES ($key, ${COLS.map((c) => '$' + c).join(',')})
  ON CONFLICT(key) DO UPDATE SET ${COLS.map((c) => `${c}=coalesce(excluded.${c}, ${c})`).join(', ')}`);

const J = (v) => (v == null ? null : typeof v === 'string' ? v : JSON.stringify(v));

export function saveProducts(rows, { score = true } = {}) {
  if (!rows?.length) return 0;
  const domains = new Set();
  tx(() => {
    for (const r of rows) {
      const p = { $key: r.key };
      for (const c of COLS) p['$' + c] = c === 'stars' || c === 'extra' ? J(r[c]) : r[c] ?? null;
      // Store listings (WordPress, Shopify, App Store…) only join a product when the review finder matched them
      // (it passes the product's domain); a plugin's homepage alone says nothing about which product it is.
      p.$domain = r.domain ?? (LISTING_SOURCES.has(r.source) ? null : domainOf(r.website || (r.source === 'research' ? r.url : null)));
      if (p.$domain) domains.add(p.$domain);
      upsert.run(p);
    }
  });
  const canon = linkDuplicates([...domains]);
  if (score) for (const r of rows) rescore(r.key);
  for (const k of canon) rescore(k);
  return rows.length;
}

// Point every row of a domain at its canonical row. Returns the canonical keys touched.
export function linkDuplicates(domains) {
  const out = new Set();
  const rowsFor = db.prepare(`SELECT key, source FROM saas_products WHERE domain = ? AND name IS NOT NULL`);
  const setDup = db.prepare('UPDATE saas_products SET dup_of = ? WHERE key = ?');
  tx(() => {
    for (const d of domains) {
      const rows = rowsFor.all(d);
      if (!rows.length) continue;
      const live = rows.filter((r) => ENABLED.has(r.source)).sort((a, b) => prio(a.source) - prio(b.source));
      const canon = live[0]?.key || null;
      for (const r of rows) setDup.run(r.key === canon || rows.length === 1 ? null : canon, r.key);
      if (canon && rows.length > 1) out.add(canon);
    }
  });
  return out;
}

const insReview = db.prepare('INSERT OR REPLACE INTO saas_reviews (key, rid, stars, date, author, text, url, origin) VALUES (?,?,?,?,?,?,?,?)');
export function saveReviews(key, reviews, { origin = null } = {}) {
  tx(() => {
    for (const r of reviews) insReview.run(key, String(r.rid), r.stars ?? null, r.date ?? null, r.author ?? null, (r.text || '').slice(0, 2000), r.url ?? null, r.origin ?? origin);
    db.prepare('UPDATE saas_products SET reviews_at=? WHERE key=?').run(new Date().toISOString(), key);
  });
  rescore(key);
}

const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };
export const rowToProduct = (r) => r && ({ ...r, stars: parse(r.stars), extra: parse(r.extra) || {}, pillars: parse(r.pillars), angles: parse(r.angles) || [], themes: parse(r.themes) || [] });

const rawProduct = (key) => rowToProduct(db.prepare('SELECT * FROM saas_products WHERE key=?').get(key));
const twinsOf = (p) => (p?.domain ? db.prepare('SELECT * FROM saas_products WHERE domain = ? AND key != ? AND name IS NOT NULL').all(p.domain, p.key).map(rowToProduct) : []);

// The canonical product with data from its twins filled in (MRR from TrustMRR, team size from YC, Zapier tier, …).
const FILL = ['mrr', 'revenue_text', 'price_min', 'pricing', 'model', 'free_plan', 'launched', 'icon', 'description', 'category', 'developer', 'updated'];
export function getProduct(key) {
  let p = rawProduct(key);
  if (!p) return null;
  if (p.dup_of) { const c = rawProduct(p.dup_of); if (c) p = c; }
  const twins = twinsOf(p).sort((a, b) => prio(a.source) - prio(b.source));
  for (const t of twins) {
    if (LISTING_SOURCES.has(t.source)) continue; // store listings only contribute ratings and reviews (below)
    for (const f of FILL) if ((p[f] == null || p[f] === '') && t[f] != null && t[f] !== '') p[f] = t[f];
    const { verdict, why, idea, buildWeeks, complaints, researchId, evidence, customer, ...rest } = t.extra || {};
    p.extra = { ...rest, ...p.extra };
    if (t.source === 'research' && p.source !== 'research') Object.assign(p.extra, { verdict, why, idea, buildWeeks, complaints, researchId, evidence, customer });
  }
  // Ratings: the product's own, or the sum over its store listings (App Store, Google Play, WordPress, Shopify, Atlassian).
  const lst = [p, ...twins].filter((t) => LISTING_SOURCES.has(t.source) && t.reviews > 0);
  if (lst.length && !(LISTING_SOURCES.has(p.source) && lst.length === 1)) {
    const n = lst.reduce((a, t) => a + t.reviews, 0);
    p.reviews = n;
    p.rating = Math.round((lst.reduce((a, t) => a + (t.rating || 0) * t.reviews, 0) / n) * 10) / 10 || null;
    const st = {};
    for (const t of lst) if (t.stars) for (const k of [1, 2, 3, 4, 5]) st[k] = (st[k] || 0) + (+t.stars[k] || 0);
    p.stars = Object.keys(st).length ? st : null;
    p.installs = Math.max(p.installs || 0, ...lst.map((t) => t.installs || 0)) || null;
  }
  p.listings = [p, ...twins].filter((t) => LISTING_SOURCES.has(t.source)).map((t) => ({ source: t.source, key: t.key, name: t.name, url: t.url, rating: t.rating, reviews: t.reviews, installs: t.installs }));
  if (!p.website) p.website = twins.find((t) => t.website)?.website || (p.source === 'research' ? p.url : null);
  p.twins = twins.map((t) => ({ key: t.key, source: t.source, url: t.url, name: t.name }));
  return p;
}

// Reviews for a product and its twins.
export function getReviews(key, limit = 300) {
  const p = rawProduct(key);
  if (!p) return [];
  const keys = [p.key, ...twinsOf(p).map((t) => t.key)];
  return db.prepare(`SELECT * FROM saas_reviews WHERE key IN (${keys.map(() => '?').join(',')}) ORDER BY (stars IS NULL), stars, date DESC LIMIT ?`).all(...keys, limit);
}

const setScore = db.prepare('UPDATE saas_products SET score=?, verdict=?, pillars=?, angles=?, themes=?, confidence=?, neg=? WHERE key=?');
export function rescore(key) {
  const raw = rawProduct(key);
  if (!raw) return;
  const target = raw.dup_of || raw.key;
  const p = getProduct(target);
  if (!p) return;
  const reviews = getReviews(target, 300);
  const s = scoreProduct(p, reviews);
  const neg = reviews.filter((r) => r.stars == null ? r.origin !== 'praise' : r.stars <= 2).length;
  setScore.run(s.score, s.verdict, J(s.pillars), J(s.angles), J(s.themes), s.confidence, neg, target);
}

export function sourceState(source, patch) {
  db.prepare('INSERT OR IGNORE INTO saas_sources (source) VALUES (?)').run(source);
  const sets = Object.keys(patch).map((k) => `${k}=$${k}`).join(', ');
  db.prepare(`UPDATE saas_sources SET ${sets} WHERE source=$source`).run({ $source: source, ...Object.fromEntries(Object.entries(patch).map(([k, v]) => ['$' + k, v])) });
}

export function sourcesSummary() {
  const counts = Object.fromEntries(db.prepare(`SELECT source, count(*) n, sum(detail_at IS NOT NULL) detailed, sum(reviews_at IS NOT NULL) reviewed, sum(listings_at IS NOT NULL) matched FROM saas_products WHERE ${ON()} GROUP BY source`).all().map((r) => [r.source, r]));
  const states = db.prepare('SELECT * FROM saas_sources').all();
  const unique = db.prepare(`SELECT count(*) n FROM saas_products WHERE ${ON()} AND name IS NOT NULL AND dup_of IS NULL`).get().n;
  return { counts, states, unique, reviews: db.prepare('SELECT count(*) n FROM saas_reviews').get().n };
}

const SORTS = {
  score: 'score DESC NULLS LAST, reviews DESC NULLS LAST',
  complaints: 'neg DESC NULLS LAST, score DESC',
  reviews: 'reviews DESC NULLS LAST', installs: 'installs DESC NULLS LAST', mrr: 'mrr DESC NULLS LAST',
  build: `json_extract(extra, '$.buildWeeks') + 0 ASC NULLS LAST, score DESC`,
  tier: `CASE json_extract(extra, '$.tier') WHEN 'indie' THEN 0 WHEN 'established' THEN 1 WHEN 'giant' THEN 2 ELSE 3 END, score DESC`,
  rating_low: 'CASE WHEN reviews >= 20 THEN rating END ASC NULLS LAST', newest: 'launched DESC NULLS LAST', name: 'name COLLATE NOCASE',
};
const inList = (col, csv, p, tag) => `${col} IN (${csv.split(',').map((s, i) => { p[`$${tag}${i}`] = s; return `$${tag}${i}`; }).join(',')})`;

// Filters apply to the canonical row; research fields live in its extra (merged in at score time is not stored),
// so research-only filters read the research twin through a sub-select.
const RX = (path) => `coalesce(json_extract(extra, '${path}'), (SELECT json_extract(r.extra, '${path}') FROM saas_products r WHERE r.source = 'research' AND r.domain = saas_products.domain LIMIT 1))`;
export function listProducts(q = {}) {
  const where = ['name IS NOT NULL', 'dup_of IS NULL', ON()];
  const p = {};
  if (q.source) where.push(`(${inList('source', q.source, p, 's')} OR EXISTS (SELECT 1 FROM saas_products t WHERE t.dup_of = saas_products.key AND ${inList('t.source', q.source, p, 't')}))`);
  if (q.cat) { where.push('category = $cat'); p.$cat = q.cat; }
  if (q.q) { where.push('(name LIKE $q OR description LIKE $q OR developer LIKE $q OR category LIKE $q OR extra LIKE $q)'); p.$q = `%${q.q}%`; }
  if (q.verdict) where.push(inList('verdict', q.verdict, p, 'v'));
  if (q.rverdict) where.push(inList(RX('$.verdict'), q.rverdict, p, 'rv'));
  if (q.tier) where.push(inList(RX('$.tier'), q.tier, p, 'ti'));
  if (+q.maxBuild) { where.push(`${RX('$.buildWeeks')} + 0 BETWEEN 1 AND $mb`); p.$mb = +q.maxBuild; }
  if (q.evidence === 'reviews') where.push('neg >= 3');
  if (q.evidence === 'none') where.push('coalesce(neg, 0) = 0');
  if (+q.minReviews) { where.push('reviews >= $mr'); p.$mr = +q.minReviews; }
  if (+q.minScore) { where.push('score >= $ms'); p.$ms = +q.minScore; }
  if (+q.maxRating) { where.push('rating <= $xr AND rating > 0'); p.$xr = +q.maxRating; }
  if (q.paid === '1') where.push(`(price_min > 0 OR mrr > 0 OR model = 'subscription' OR pricing IS NOT NULL)`);
  if (q.revenue === '1') where.push(`(mrr > 0 OR coalesce(revenue_text, '') != '' OR EXISTS (SELECT 1 FROM saas_products t WHERE t.dup_of = saas_products.key AND (t.mrr > 0 OR coalesce(t.revenue_text, '') != '')))`);
  if (q.hard !== '1') where.push(`(pillars IS NULL OR json_extract(pillars, '$.build') >= 2)`);
  const W = `WHERE ${where.join(' AND ')}`;
  const limit = Math.min(200, +q.limit || 30);
  const page = Math.max(1, +q.page || 1);
  const rows = db.prepare(`SELECT key FROM saas_products ${W} ORDER BY ${SORTS[q.sort] || SORTS.score} LIMIT ${limit} OFFSET ${(page - 1) * limit}`).all(p)
    .map((r) => getProduct(r.key));
  const total = db.prepare(`SELECT count(*) n FROM saas_products ${W}`).get(p).n;
  return { rows, total, page, limit };
}

export function facets() {
  const W = `WHERE name IS NOT NULL AND dup_of IS NULL AND ${ON()}`;
  return {
    sources: db.prepare(`SELECT source, count(*) n FROM saas_products WHERE name IS NOT NULL AND ${ON()} GROUP BY source ORDER BY n DESC`).all(),
    categories: db.prepare(`SELECT category, count(*) n FROM saas_products ${W} AND category IS NOT NULL GROUP BY category HAVING n >= 3 ORDER BY category`).all(),
    verdicts: db.prepare(`SELECT verdict, count(*) n FROM saas_products ${W} GROUP BY verdict`).all(),
    total: db.prepare(`SELECT count(*) n FROM saas_products ${W}`).get().n,
  };
}

export function suggest(q, limit = 8) {
  const t = String(q || '').trim();
  if (t.length < 2) return [];
  return db.prepare(`SELECT key, source, name, category, icon, url, website, score, verdict FROM saas_products
    WHERE ${ON()} AND dup_of IS NULL AND name COLLATE NOCASE >= $a AND name COLLATE NOCASE < $b ORDER BY coalesce(reviews,0) + coalesce(installs,0)/1000 + coalesce(score,0) DESC LIMIT ${limit}`)
    .all({ $a: t, $b: t + '￿' });
}

// One-off backfill for rows saved before domains existed. Cheap; runs at start.
export function backfillDomains() {
  const stray = db.prepare(`SELECT DISTINCT domain FROM saas_products WHERE source IN ('wp','shopify','atl') AND domain IS NOT NULL AND json_extract(extra, '$.matchedFor') IS NULL`).all().map((r) => r.domain);
  if (stray.length) {
    db.prepare(`UPDATE saas_products SET domain = NULL, dup_of = NULL WHERE source IN ('wp','shopify','atl') AND domain IS NOT NULL AND json_extract(extra, '$.matchedFor') IS NULL`).run();
    for (const k of linkDuplicates(stray)) rescore(k);
  }
  const rows = db.prepare(`SELECT key, source, url, website FROM saas_products WHERE domain IS NULL AND name IS NOT NULL AND source NOT IN ('wp','shopify','atl','ios','gp') AND (website IS NOT NULL OR source = 'research')`).all();
  if (!rows.length) return 0;
  const set = db.prepare('UPDATE saas_products SET domain = ? WHERE key = ?');
  const ds = new Set();
  tx(() => { for (const r of rows) { const d = domainOf(r.website || (r.source === 'research' ? r.url : null)); if (d) { set.run(d, r.key); ds.add(d); } } });
  const canon = linkDuplicates([...ds]);
  for (const k of canon) rescore(k);
  // One-time full rescore when the scoring inputs change (merged twins, complaint counts).
  const V = 'saas_score_v3';
  if (db.prepare('SELECT v FROM kv WHERE k=?').get(V)?.v !== '1') {
    for (const { key } of db.prepare(`SELECT key FROM saas_products WHERE name IS NOT NULL AND dup_of IS NULL AND ${ON()}`).all()) rescore(key);
    db.prepare('INSERT INTO kv (k,v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(V, '1');
  }
  return rows.length;
}
