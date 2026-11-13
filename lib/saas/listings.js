// Review finder for general SaaS. Most SaaS have no public review API, but many have their own listings on
// the App Store, Google Play, WordPress.org and the Shopify App Store, and people discuss them on Hacker News.
// For each product we search those stores by name and accept a listing only when its developer website is the
// product's own site (domain match) and the name agrees. Matched listings are saved as hidden "twin" rows, so
// their ratings roll up into the product and their critical reviews appear on its page.
// G2, Capterra and Trustpilot are deliberately not used: their terms forbid scraping.
import { db } from '../db.js';
import * as ios from '../ios.js';
import * as android from '../android.js';
import { saveProducts, saveReviews, getProduct, domainOf, sameSite, sourceState, ENABLED } from './store.js';
import { mapWpPlugin, parseWpFeed, parseShopifyApp, parseShopifyReviews, stripTags, decode } from './sources.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

// Per-host spacing so parallel workers never hammer one service (iTunes Search allows ~20 calls/min).
const GAP = { itunes: 3500, 'itunes-rss': 1000, play: 1200, wp: 600, shopify: 1600, hn: 400 };
const next = {};
async function slot(host) {
  const t = Math.max(Date.now(), next[host] || 0);
  next[host] = t + (GAP[host] || 1000);
  if (t > Date.now()) await sleep(t - Date.now());
}
async function get(url, { json = false, timeout = 25_000 } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw Object.assign(new Error(`${res.status} from ${new URL(url).host}`), { status: res.status });
  return json ? res.json() : res.text();
}

export const norm = (s) => decode(String(s || '')).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
const firstToken = (s) => decode(String(s || '')).toLowerCase().split(/[^a-z0-9]+/).find((w) => w.length >= 3) || norm(s);

// Does a store listing belong to this product?
export function isMatch(p, listing) {
  const d = domainOf(listing.website);
  if (!d || !p.domain || !sameSite(p.domain, d)) return false;
  const ln = norm(listing.name), pn = norm(p.name);
  if (!pn) return false;
  // Exact site match: the name only needs to share the product's first word ("Tidio" ↔ "Tidio – Live Chat & AI Chatbots").
  if (p.domain === d) return ln.includes(norm(firstToken(p.name))) || norm(listing.developer).includes(norm(firstToken(p.name)));
  // Same host, one side without a path (zoho.com vs zoho.com/crm): require the full product name.
  return ln.includes(pn);
}

const NEG = /\b(expensive|overpriced|pric(e|ing) (hike|increase)|bug(gy|s)?|broken|crash|slow|terrible|awful|horrible|hate|frustrat\w*|annoying|worst|useless|unreliable|downtime|outage|support (is|was) (bad|terrible|non)|no support|doesn'?t work|stopped working|bloat\w*|clunky|confusing|disappoint\w*|scam|refund|cancel\w*|lock-?in|switched (away|from)|moved (away|off)|left (them|it)|missing|lacks?|wish (it|they)|can'?t (even|believe)|dark pattern|spam)\b/i;

// ---------------- per-store matchers ----------------
async function findIos(p) {
  await slot('itunes');
  const res = await ios.search(p.name, 'us', 8).catch(() => []);
  const hits = res.filter((a) => isMatch(p, a)).sort((a, b) => (b.ratingsCount || 0) - (a.ratingsCount || 0)).slice(0, 2);
  const out = [];
  for (const a of hits) {
    await slot('itunes-rss');
    const { reviews = [] } = await ios.reviews(a.id, 'us', 4).catch(() => ({}));
    out.push({
      row: { key: `ios:${a.id}`, source: 'ios', name: a.name, url: a.url, website: a.website, developer: a.developer, icon: a.icon, rating: a.rating ? Math.round(a.rating * 10) / 10 : null, reviews: a.ratingsCount || 0, updated: a.updated?.slice(0, 10), domain: p.domain, detail_at: now() },
      reviews: reviews.filter((r) => r.score && r.text).map((r, i) => ({ rid: `ios-${a.id}-${r.date || i}-${(r.author || '').slice(0, 20)}`, stars: r.score, date: r.date?.slice(0, 10), author: r.author, text: [r.title, r.text].filter(Boolean).join('. '), url: a.url, origin: 'App Store' })),
    });
  }
  return out;
}

async function findPlay(p) {
  await slot('play');
  const res = await android.quickSearch(p.name, 'us', 5).catch(() => []);
  const cands = res.filter((a) => norm(a.name).includes(norm(firstToken(p.name)))).slice(0, 3);
  const out = [];
  for (const c of cands) {
    await slot('play');
    const d = await android.detailsFor(c.id).then((x) => android.normalize(x)).catch(() => null);
    if (!d || !isMatch(p, d)) continue;
    await slot('play');
    const rv = await android.reviews(d.id, 'us', 'newest', 300).catch(() => []);
    const h = d.histogram;
    out.push({
      row: { key: `gp:${d.id}`, source: 'gp', name: d.name, url: d.url, website: d.website, developer: d.developer, icon: d.icon, rating: d.rating ? Math.round(d.rating * 10) / 10 : null, reviews: d.ratingsCount || 0, installs: d.installs, stars: h ? { 1: h[1] || h['1'] || 0, 2: h[2] || 0, 3: h[3] || 0, 4: h[4] || 0, 5: h[5] || 0 } : null, updated: d.updated?.slice(0, 10), domain: p.domain, detail_at: now() },
      reviews: rv.filter((r) => r.score && r.text).map((r) => ({ rid: `gp-${r.id}`, stars: r.score, date: r.date ? new Date(r.date).toISOString().slice(0, 10) : null, author: r.author, text: r.text, url: d.url, origin: 'Google Play' })),
    });
    break;
  }
  return out;
}

async function findWp(p) {
  await slot('wp');
  const j = await get(`https://api.wordpress.org/plugins/info/1.2/?action=query_plugins&request[search]=${encodeURIComponent(p.name)}&request[per_page]=10&request[fields][sections]=0&request[fields][description]=0&request[fields][active_installs]=1&request[fields][short_description]=1`, { json: true }).catch(() => null);
  const hit = (j?.plugins || []).map((x) => ({ raw: x, name: decode(x.name), website: x.homepage, developer: stripTags(x.author) })).find((x) => isMatch(p, x));
  if (!hit) return [];
  const row = { ...mapWpPlugin(hit.raw), domain: p.domain };
  let reviews = [];
  if (row.reviews >= 3) {
    await slot('wp');
    reviews = parseWpFeed(await get(`https://wordpress.org/support/plugin/${hit.raw.slug}/reviews/feed/`).catch(() => '')).map((r) => ({ ...r, origin: 'WordPress.org' }));
  }
  return [{ row, reviews }];
}

// Shopify search results are rendered client-side, so candidates come from the app sitemap (already in the DB as
// placeholder rows) whose handle starts with the product's name; the app page's "Website" link confirms the match.
async function findShopify(p) {
  const slug = decode(p.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (slug.length < 3) return [];
  const cands = db.prepare(`SELECT key FROM saas_products WHERE source='shopify' AND (key = ? OR key LIKE ?) LIMIT 4`).all(`shopify:${slug}`, `shopify:${slug}-%`).map((r) => r.key.slice(8));
  for (const h of cands) {
    await slot('shopify');
    const html = await get(`https://apps.shopify.com/${h}`).catch(() => null);
    const a = html && parseShopifyApp(html, h);
    if (!a || !isMatch(p, a)) continue;
    const reviews = [];
    if (a.reviews >= 5) {
      for (const [q, st] of [['ratings%5B%5D=1', 1], ['ratings%5B%5D=2', 2], ['ratings%5B%5D=3', 3]]) {
        await slot('shopify');
        reviews.push(...parseShopifyReviews(await get(`https://apps.shopify.com/${h}/reviews?${q}`).catch(() => ''), st).map((r) => ({ ...r, url: `https://apps.shopify.com/${h}/reviews`, origin: 'Shopify App Store' })));
      }
    }
    return [{ row: { ...a, domain: p.domain }, reviews }];
  }
  return [];
}

// Hacker News comments that criticise the product. Generic names ("Fomo", "Switchy") have thousands of hits,
// so for those only comments that mention the product's site are kept.
export async function findHn(p) {
  const site = p.domain.split('/')[0];
  await slot('hn');
  const byName = await get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"${p.name}"`)}&tags=comment&hitsPerPage=200`, { json: true }).catch(() => null);
  const generic = !byName || byName.nbHits > 600 || norm(p.name).length < 5;
  let hits = generic ? [] : byName.hits;
  await slot('hn');
  const bySite = await get(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(site)}&tags=comment&hitsPerPage=100`, { json: true }).catch(() => null);
  hits = [...hits, ...(bySite?.hits || [])];
  const nameRe = new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
  const seen = new Set();
  const out = [];
  for (const h of hits) {
    if (seen.has(h.objectID)) continue;
    seen.add(h.objectID);
    const text = stripTags(h.comment_text || '');
    if (!(text.toLowerCase().includes(site) || nameRe.test(text))) continue;
    // Keep the sentences around the mention that carry the criticism.
    const sentences = text.split(/(?<=[.!?])\s+|\n+/).filter((s) => s.length > 20);
    const idx = sentences.findIndex((s) => nameRe.test(s) || s.toLowerCase().includes(site));
    const near = sentences.slice(Math.max(0, idx - 1), idx + 3).join(' ');
    if (!NEG.test(near)) continue;
    out.push({ rid: `hn-${h.objectID}`, stars: null, date: h.created_at?.slice(0, 10), author: h.author, text: near.slice(0, 900), url: `https://news.ycombinator.com/item?id=${h.objectID}`, origin: 'Hacker News' });
    if (out.length >= 25) break;
  }
  return out;
}

// ---------------- orchestration ----------------
const STEPS = [['App Store', findIos], ['Google Play', findPlay], ['WordPress.org', findWp], ['Shopify App Store', findShopify]];
export async function matchProduct(key) {
  const p = getProduct(key);
  if (!p?.domain) { db.prepare('UPDATE saas_products SET listings_at=? WHERE key=?').run(now(), key); return { found: [] }; }
  const found = [];
  for (const [label, fn] of STEPS) {
    try {
      for (const { row, reviews } of await fn(p)) {
        saveProducts([{ ...row, extra: { ...(row.extra || {}), matchedFor: p.key } }], { score: false });
        if (reviews.length) saveReviews(row.key, reviews);
        found.push({ store: label, name: row.name, reviews: row.reviews, collected: reviews.length });
      }
    } catch (e) { console.error(`[listings] ${label} for ${p.name}: ${e.message}`); }
  }
  try {
    const hn = await findHn(p);
    if (hn.length) { saveReviews(p.key, hn); found.push({ store: 'Hacker News', collected: hn.length }); }
  } catch {}
  db.prepare('UPDATE saas_products SET listings_at=? WHERE key=?').run(now(), p.key);
  const { rescore } = await import('./store.js');
  rescore(p.key);
  return { found };
}

// Research first (you picked those), then TrustMRR, the most popular Zapier apps, YC, launches.
export async function matchBatch({ budget = 120, workers = 3, prog = () => {} } = {}) {
  const src = [...ENABLED].filter((s) => !['shopify', 'wp', 'atl'].includes(s));
  const todo = db.prepare(`SELECT key, name FROM saas_products WHERE dup_of IS NULL AND name IS NOT NULL AND domain IS NOT NULL
      AND source IN (${src.map(() => '?').join(',')}) AND (listings_at IS NULL OR listings_at < ?)
    ORDER BY listings_at IS NOT NULL,
      CASE source WHEN 'research' THEN 0 WHEN 'trustmrr' THEN 1 WHEN 'zap' THEN 2 WHEN 'yc' THEN 3 ELSE 4 END,
      coalesce(json_extract(extra, '$.catRank'), 99), score DESC LIMIT ?`).all(...src, new Date(Date.now() - 45 * 864e5).toISOString(), budget);
  let done = 0, withReviews = 0;
  const queue = [...todo];
  await Promise.all(Array.from({ length: workers }, async () => {
    while (queue.length) {
      const { key, name } = queue.shift();
      const r = await matchProduct(key).catch(() => ({ found: [] }));
      done++;
      if (r.found.some((f) => f.collected)) withReviews++;
      if (done % 3 === 0) prog(`${done} of ${todo.length} this run · ${withReviews} with reviews found · last: ${name}`);
    }
  }));
  return { done, withReviews, left: db.prepare(`SELECT count(*) n FROM saas_products WHERE dup_of IS NULL AND name IS NOT NULL AND domain IS NOT NULL AND listings_at IS NULL AND source IN (${src.map(() => '?').join(',')})`).get(...src).n };
}

export async function listingsSource({ budget = 120 } = {}) {
  sourceState('listings', { status: 'running', progress: 'starting' });
  try {
    const r = await matchBatch({ budget, prog: (progress) => sourceState('listings', { progress }) });
    sourceState('listings', { status: 'ok', progress: `${r.done} products checked this run (${r.withReviews} with reviews) · ${r.left.toLocaleString()} not checked yet`, last_ok: now() });
    return r;
  } catch (e) {
    sourceState('listings', { status: 'error', last_error: e.message.slice(0, 300), last_error_at: now() });
    return { done: 0, left: 0 };
  }
}
