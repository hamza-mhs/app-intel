// SaaS source fetchers. Each one writes into the unified catalog (store.js) and records its health.
// Formats were checked against live responses on 2 Nov 2026 (Shopify App Store HTML + JSON-LD,
// WordPress.org plugins API 1.2 + review RSS, Atlassian Marketplace REST v2, HN Algolia, TrustMRR).
import fs from 'node:fs';
import path from 'node:path';
import { db, tx } from '../db.js';
import { saveProducts, saveReviews, sourceState, ENABLED } from './store.js';
import * as trust from '../trustmrr.js';
import * as listings from './listings.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
// "September 20, 2012" → "2012-09-20" without time-zone shifts.
const longDate = (s) => { const m = String(s || '').match(/([A-Za-z]+) (\d{1,2}), (\d{4})/); const mo = m && MONTHS[m[1].toLowerCase()]; return mo ? `${m[3]}-${String(mo).padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString();

async function get(url, { json = false, timeout = 20_000, headers = {} } = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers }, signal: AbortSignal.timeout(timeout) });
  if (res.status === 429) { const e = new Error(`429 rate limited by ${new URL(url).host}`); e.status = 429; throw e; }
  if (!res.ok) { const e = new Error(`${res.status} from ${new URL(url).host}`); e.status = res.status; throw e; }
  return json ? res.json() : res.text();
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'", '#8211': '–', '#8212': '—', '#8217': '’', '#8220': '“', '#8221': '”', '#8230': '…' };
export const decode = (s) => String(s ?? '').replace(/&(#x?[0-9a-f]+|[a-z0-9#]+);/gi, (m, e) => ENT[e] ?? (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : m));
export const stripTags = (s) => decode(String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();

// Wrap a source run with health bookkeeping. A failure never throws past here.
async function run(source, fn) {
  sourceState(source, { status: 'running', progress: 'starting' });
  try {
    const msg = await fn((progress) => sourceState(source, { progress }));
    sourceState(source, { status: 'ok', progress: msg || 'done', last_ok: now() });
    db.prepare('UPDATE saas_sources SET runs = runs + 1 WHERE source = ?').run(source);
  } catch (e) {
    console.error(`[saas:${source}] ${e.message}`);
    sourceState(source, { status: 'error', last_error: e.message.slice(0, 300), last_error_at: now() });
  }
}
const lastOk = (source) => db.prepare('SELECT last_ok FROM saas_sources WHERE source=?').get(source)?.last_ok;
// Resumable checkpoints: long list crawls save their position so a restart continues instead of starting over.
const ckGet = (k) => { const v = db.prepare('SELECT v FROM kv WHERE k=?').get('ck:' + k)?.v; try { return v ? JSON.parse(v) : null; } catch { return null; } };
const ckSet = (k, v) => v == null ? db.prepare('DELETE FROM kv WHERE k=?').run('ck:' + k)
  : db.prepare('INSERT INTO kv (k,v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run('ck:' + k, JSON.stringify(v));
export const checkpoints = { get: ckGet, set: ckSet };
const due = (source, days) => { const t = lastOk(source); return !t || Date.now() - Date.parse(t) > days * 864e5; };

// ---------- price parsing ----------
// "$15/month", "$9.99 / month", "$199/year", "$49 one-time charge", "Free to install", "Free plan available"
export function parsePlans(prices) {
  let min = null, model = null, free = 0;
  for (const raw of prices) {
    const t = String(raw).replace(/,/g, '');
    if (/free/i.test(t) && !/\$\s*[1-9]/.test(t)) { free = 1; continue; }
    const m = t.match(/\$\s*(\d+(?:\.\d+)?)/);
    if (!m) continue;
    let v = +m[1];
    // "$11/seat/mo (annual)" is already monthly; only a price quoted per year ("$199/year") is divided by 12.
    const after = t.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (/^\s*(\/|per\s*)?\s*(seat\/|user\/)?\s*(mo\b|month)/i.test(after) || (/\/mo\b|per month|\/month/i.test(t) && !/^\s*\/\s*(year|yr)/i.test(after))) model = 'subscription';
    else if (/^\s*(\/|per\s*)?\s*(year|yr|annum)/i.test(after)) { v /= 12; model ||= 'subscription'; }
    else if (/month/i.test(t)) model = 'subscription';
    else if (/one[- ]time/i.test(t)) model ||= 'one-time';
    if (v > 0 && (min == null || v < min)) min = Math.round(v * 100) / 100;
  }
  if (!model && free && min == null) model = 'free';
  return { price_min: min, model, free_plan: free };
}

// ================= Shopify App Store =================
export function parseShopifyApp(html, handle) {
  const ldRaw = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  let ld = {};
  try { ld = JSON.parse(ldRaw); } catch {}
  if (Array.isArray(ld)) ld = ld.find((x) => x['@type'] === 'SoftwareApplication') || ld[0] || {};
  const names = [...html.matchAll(/data-test-id="name"[^>]*>\s*([^<]+?)\s*</g)].map((m) => decode(m[1]));
  const prices = [...html.matchAll(/data-test-id="price"[^>]*>\s*([^<]+?)\s*</g)].map((m) => decode(m[1]).replace(/\s+/g, ' '));
  const plans = prices.map((p, i) => ({ name: names[i] || '', price: p }));
  const launched = html.match(/Launched\s*<\/p>\s*<p[^>]*>\s*([A-Z][a-z]+ \d{1,2}, \d{4})/)?.[1];
  const cat = html.match(/href="https:\/\/apps\.shopify\.com\/categories\/([a-z0-9-]+)\?surface_detail=[^"]*surface_type=app_details"[^>]*>\s*([^<]+?)\s*</);
  const dev = html.match(/href="https:\/\/apps\.shopify\.com\/partners\/([a-z0-9-]+)"[^>]*>\s*([^<]+?)\s*</);
  const stars = {};
  for (const m of html.matchAll(/aria-label="([\d,]+) total reviews" href="\/[^"]*\/reviews\?ratings%5B%5D=(\d)"/g)) stars[m[2]] = +m[1].replace(/,/g, '');
  const web = html.match(/href="(https?:\/\/[^"]+)"[^>]*>\s*Website\s*</)?.[1];
  const rating = +ld?.aggregateRating?.ratingValue || null;
  const reviews = +ld?.aggregateRating?.ratingCount || 0;
  if (!ld.name) return null;
  return {
    key: `shopify:${handle}`, source: 'shopify', name: decode(ld.name), url: `https://apps.shopify.com/${handle}`,
    website: web ? decode(web).replace(/[?#].*$/, '') : null,
    developer: dev ? decode(dev[2]) : ld.brand || null, category: cat ? decode(cat[2]) : null,
    description: decode(ld.description || ''), icon: Array.isArray(ld.image) ? ld.image[0] : ld.image || null,
    rating, reviews, stars: Object.keys(stars).length ? stars : null,
    ...parsePlans(prices), pricing: plans.length ? plans.map((p) => `${p.name}: ${p.price}`).join(' · ') : null,
    launched: longDate(launched),
    extra: { plans, partner: dev?.[1] || null, catHandle: cat?.[1] || null }, detail_at: now(),
  };
}

export function parseShopifyReviews(html, filterStars) {
  const out = [];
  for (const chunk of html.split('data-merchant-review=""').slice(1)) {
    const rid = chunk.match(/data-review-content-id="(\d+)"/)?.[1];
    const stars = +chunk.match(/aria-label="(\d) out of 5 stars"/)?.[1] || filterStars || null;
    const date = chunk.match(/tw-text-fg-tertiary">\s*([A-Z][a-z]+ \d{1,2}, \d{4})\s*</)?.[1];
    const body = chunk.split('data-merchant-review-reply')[0];
    const text = [...body.matchAll(/<p class="tw-break-words">([\s\S]*?)<\/p>/g)].map((m) => stripTags(m[1])).join('\n');
    const author = decode(chunk.match(/<span class="tw-overflow-hidden[^"]*" title="([^"]+)"/)?.[1] || '');
    if (rid && text) out.push({ rid: `s${rid}`, stars, date: longDate(date), author, text });
  }
  return out;
}

export async function shopifySitemap() {
  await run('shopify-sitemap', async (prog) => {
    const xml = await get('https://apps.shopify.com/sitemap_apps_en.xml', { timeout: 60_000 });
    const rows = [...xml.matchAll(/<url>\s*<loc>https:\/\/apps\.shopify\.com\/([^<]+)<\/loc>\s*(?:<lastmod>([^<]+)<\/lastmod>)?/g)]
      .map((m) => ({ handle: m[1], lastmod: m[2] || null }));
    const ins = db.prepare(`INSERT INTO saas_products (key, source, url, listed_at) VALUES (?, 'shopify', ?, ?)
      ON CONFLICT(key) DO UPDATE SET listed_at=excluded.listed_at`);
    tx(() => { for (const r of rows) ins.run(`shopify:${r.handle}`, `https://apps.shopify.com/${r.handle}`, r.lastmod); });
    return `${rows.length.toLocaleString()} apps listed`;
  });
}

// Detail pages: never-fetched first (most recently updated listings first), then anything older than 21 days.
export async function shopifyDetails({ budget = 600, gap = 1500 } = {}) {
  await run('shopify', async (prog) => {
    const todo = db.prepare(`SELECT key FROM saas_products WHERE source='shopify' AND (detail_at IS NULL OR detail_at < ?)
      ORDER BY detail_at IS NOT NULL, listed_at DESC LIMIT ?`).all(daysAgo(21), budget).map((r) => r.key);
    let ok = 0, gone = 0, fail = 0;
    for (const [i, key] of todo.entries()) {
      const handle = key.slice(8);
      try {
        const p = parseShopifyApp(await get(`https://apps.shopify.com/${handle}`), handle);
        if (p) { saveProducts([p]); ok++; } else fail++;
      } catch (e) {
        if (e.status === 404 || e.status === 410) { db.prepare('UPDATE saas_products SET detail_at=?, name=NULL WHERE key=?').run(now(), key); gone++; }
        else if (e.status === 429) { prog(`rate limited; pausing 60s (${ok} done)`); await sleep(60_000); }
        else fail++;
      }
      if (i % 10 === 0) prog(`${ok.toLocaleString()} of ${todo.length.toLocaleString()} app pages this run (${fail} failed, ${gone} removed)`);
      await sleep(gap);
    }
    const left = db.prepare(`SELECT count(*) n FROM saas_products WHERE source='shopify' AND detail_at IS NULL`).get().n;
    return `${ok} app pages fetched this run · ${left.toLocaleString()} never fetched yet`;
  });
}

export async function shopifyReviews({ budget = 120, gap = 1500 } = {}) {
  await run('shopify-reviews', async (prog) => {
    const todo = db.prepare(`SELECT key, reviews FROM saas_products WHERE source='shopify' AND reviews >= 15 AND (reviews_at IS NULL OR reviews_at < ?)
      ORDER BY reviews_at IS NOT NULL, reviews DESC LIMIT ?`).all(daysAgo(30), budget);
    let n = 0;
    for (const [i, { key }] of todo.entries()) {
      const handle = key.slice(8);
      const all = [];
      for (const [q, st] of [['ratings%5B%5D=1', 1], ['ratings%5B%5D=2', 2], ['ratings%5B%5D=3', 3], ['sort_by=newest', null]]) {
        try { all.push(...parseShopifyReviews(await get(`https://apps.shopify.com/${handle}/reviews?${q}`), st)); } catch (e) { if (e.status === 429) await sleep(60_000); }
        await sleep(gap);
      }
      const seen = new Set();
      saveReviews(key, all.filter((r) => (seen.has(r.rid) ? false : seen.add(r.rid))).map((r) => ({ ...r, url: `https://apps.shopify.com/${handle}/reviews` })));
      n += all.length;
      prog(`${i + 1} of ${todo.length} apps · ${n} reviews`);
    }
    return `${n} reviews from ${todo.length} apps`;
  });
}

// ================= WordPress.org plugins =================
export function mapWpPlugin(p) {
  const threads = +p.support_threads || 0;
  return {
    key: `wp:${p.slug}`, source: 'wp', name: decode(p.name), url: `https://wordpress.org/plugins/${p.slug}/`,
    website: p.homepage || null, developer: stripTags(p.author) || null,
    category: Object.values(p.tags || {})[0] ? `WordPress · ${Object.values(p.tags)[0]}` : 'WordPress plugin',
    description: decode(p.short_description || ''), icon: p.icons?.['2x'] || p.icons?.['1x'] || p.icons?.default || null,
    rating: p.rating ? Math.round((+p.rating / 20) * 10) / 10 : null, reviews: +p.num_ratings || 0, installs: +p.active_installs || 0,
    stars: p.ratings && typeof p.ratings === 'object' ? p.ratings : null, free_plan: 1,
    updated: String(p.last_updated || '').match(/\d{4}-\d{2}-\d{2}/)?.[0] || null,
    launched: p.added || null,
    extra: { supportThreads: threads, unresolvedShare: threads ? (threads - (+p.support_threads_resolved || 0)) / threads : null, tags: Object.values(p.tags || {}) },
    detail_at: now(),
  };
}

export async function wordpressList({ minInstalls = +process.env.WP_MIN_INSTALLS || 2000, maxPages = 80 } = {}) {
  await run('wp', async (prog) => {
    const ck = ckGet('wp');
    let saved = ck?.saved || 0;
    for (let page = ck?.page || 1; page <= maxPages; page++) {
      const u = `https://api.wordpress.org/plugins/info/1.2/?action=query_plugins&request[browse]=popular&request[per_page]=250&request[page]=${page}`
        + '&request[fields][active_installs]=1&request[fields][short_description]=1&request[fields][description]=0&request[fields][sections]=0&request[fields][versions]=0&request[fields][screenshots]=0&request[fields][contributors]=0&request[fields][banners]=0';
      const j = await get(u, { json: true, timeout: 60_000 });
      const rows = (j.plugins || []).map(mapWpPlugin);
      saveProducts(rows.filter((r) => r.installs >= minInstalls));
      saved += rows.filter((r) => r.installs >= minInstalls).length;
      prog(`page ${page}: ${saved.toLocaleString()} plugins saved`);
      ckSet('wp', { page: page + 1, saved });
      if (!rows.length || rows[rows.length - 1].installs < minInstalls || page >= (j.info?.pages || 0)) break;
      await sleep(1000);
    }
    ckSet('wp', null);
    return `${saved.toLocaleString()} plugins with ≥${minInstalls.toLocaleString()} installs`;
  });
}

export function parseWpFeed(xml) {
  return xml.split('<item>').slice(1).map((it) => {
    const title = decode(it.match(/<title>([\s\S]*?)<\/title>/)?.[1] || '');
    const stars = +title.match(/\((\d) stars?\)\s*$/)?.[1] || +it.match(/Rating: (\d) stars?/)?.[1] || null;
    const link = it.match(/<link>([^<]+)<\/link>/)?.[1];
    const desc = it.match(/<description>\s*<!\[CDATA\[([\s\S]*?)\]\]>/)?.[1] || '';
    const text = stripTags(desc).replace(/^Replies: \d+\s*/i, '').replace(/^Rating: \d stars?\s*/i, '').trim();
    const date = it.match(/<pubDate>([^<]+)<\/pubDate>/)?.[1];
    return { rid: link || title, stars, date: date ? new Date(date).toISOString().slice(0, 10) : null, author: decode(it.match(/<dc:creator>([^<]*)<\/dc:creator>/)?.[1] || ''), text: `${title.replace(/\s*\(\d stars?\)\s*$/, '')}. ${text}`, url: link };
  });
}

export async function wordpressReviews({ budget = 200 } = {}) {
  await run('wp-reviews', async (prog) => {
    const todo = db.prepare(`SELECT key FROM saas_products WHERE source='wp' AND reviews >= 20 AND (reviews_at IS NULL OR reviews_at < ?) ORDER BY reviews_at IS NOT NULL, installs DESC LIMIT ?`).all(daysAgo(30), budget);
    let n = 0;
    for (const [i, { key }] of todo.entries()) {
      try { const r = parseWpFeed(await get(`https://wordpress.org/support/plugin/${key.slice(3)}/reviews/feed/`)); saveReviews(key, r); n += r.length; } catch {}
      if (i % 5 === 0) prog(`${i + 1} of ${todo.length} plugins · ${n} reviews`);
      await sleep(1200);
    }
    return `${n} reviews from ${todo.length} plugins`;
  });
}

// ================= Atlassian Marketplace =================
export function mapAtlassian(a) {
  const e = a._embedded || {};
  const href = a._links?.alternate?.href;
  return {
    key: `atl:${a.key}`, source: 'atl', name: a.name, url: href ? `https://marketplace.atlassian.com${href.split('?')[0]}` : null,
    developer: e.vendor?.name || null, category: e.categories?.[0]?.name ? `Atlassian · ${e.categories[0].name}` : 'Atlassian app',
    description: a.summary || a.tagLine || '', icon: e.logo?._links?.highRes?.href || e.logo?._links?.image?.href || null,
    rating: e.reviews?.averageStars ? Math.round(e.reviews.averageStars * 10) / 10 : null, reviews: e.reviews?.count || 0,
    installs: e.distribution?.totalInstalls ?? null, model: 'subscription',
    updated: e.lastModified?.date || (typeof e.lastModified === 'string' ? e.lastModified : null),
    extra: { downloads: e.distribution?.downloads ?? null, categories: (e.categories || []).map((c) => c.name) }, detail_at: now(),
  };
}

export async function atlassianList() {
  await run('atl', async (prog) => {
    const ck = ckGet('atl');
    let offset = ck?.offset || 0, saved = offset, total = null;
    for (let guard = 0; guard < 300; guard++) {
      const j = await get(`https://marketplace.atlassian.com/rest/2/addons?cost=marketplace&limit=50&offset=${offset}`, { json: true });
      const list = j._embedded?.addons || [];
      total ??= j.count;
      saveProducts(list.map(mapAtlassian));
      saved += list.length;
      offset += list.length;
      ckSet('atl', { offset });
      prog(`${saved.toLocaleString()} of ${total?.toLocaleString() || '?'} paid apps`);
      if (!list.length || offset >= total) break;
      await sleep(800);
    }
    ckSet('atl', null);
    return `${saved.toLocaleString()} paid apps`;
  });
}

export async function atlassianReviews({ budget = 200 } = {}) {
  await run('atl-reviews', async (prog) => {
    const todo = db.prepare(`SELECT key FROM saas_products WHERE source='atl' AND reviews >= 10 AND (reviews_at IS NULL OR reviews_at < ?) ORDER BY reviews_at IS NOT NULL, reviews DESC LIMIT ?`).all(daysAgo(30), budget);
    let n = 0;
    for (const [i, { key }] of todo.entries()) {
      try {
        const j = await get(`https://marketplace.atlassian.com/rest/2/addons/${encodeURIComponent(key.slice(4))}/reviews?limit=50&sort=recent`, { json: true });
        const cpr = j.countPerRating;
        if (cpr) {
          const st = Array.isArray(cpr) ? Object.fromEntries(cpr.map((c) => [c.stars ?? c.rating, c.count])) : cpr;
          db.prepare('UPDATE saas_products SET stars=? WHERE key=?').run(JSON.stringify(st), key);
        }
        const rs = (j._embedded?.reviews || []).map((r) => ({ rid: r.id, stars: r.stars, date: r.date?.slice(0, 10), author: r._embedded?.author?.name, text: r.review || r.text || r.reviewText || '' })).filter((r) => r.text);
        saveReviews(key, rs);
        n += rs.length;
      } catch {}
      if (i % 5 === 0) prog(`${i + 1} of ${todo.length} apps · ${n} written reviews`);
      await sleep(900);
    }
    return `${n} written reviews from ${todo.length} apps`;
  });
}

// ================= TrustMRR (verified revenue) =================
export async function trustmrrSource() {
  await run('trustmrr', async () => {
    const list = trust.syncStatus().count ? trust.listSynced({ limit: 1000 }) : await trust.discovery();
    saveProducts(list.map((s) => ({
      key: `trustmrr:${s.slug}`, source: 'trustmrr', name: s.name, url: s.url || `https://trustmrr.com/startup/${s.slug}`, website: s.website || null,
      category: s.category || null, description: s.description || '', icon: s.icon || null,
      mrr: s.revenue?.mrr || null, revenue_text: s.revenue?.mrr ? `$${Math.round(s.revenue.mrr).toLocaleString()} MRR (TrustMRR verified)` : null,
      model: s.revenue?.mrr ? 'subscription' : null,
      extra: { growth30d: s.growth30d ?? null, growthMRR30d: s.growthMRR30d ?? null, customers: s.customers ?? null, provider: s.paymentProvider, onSale: s.onSale ?? null, askingPrice: s.askingPrice ?? null },
      detail_at: now(),
    })));
    return `${list.length} startups with verified revenue${trust.apiConfigured() ? '' : ' (free feed; add TRUSTMRR_API_KEY for all)'}`;
  });
}

// ================= Hacker News "Show HN" launches =================
// Code hosts mean an open-source project or library, not a product people pay for.
export const OSS_HOST = /^https?:\/\/([^/]*\.)?(github\.com|gitlab\.com|codeberg\.org|sr\.ht|bitbucket\.org|huggingface\.co|npmjs\.com|pypi\.org|crates\.io)\b|\.github\.io\b/i;
export async function hnShow({ minPoints = 80, years = 3 } = {}) {
  await run('hn', async (prog) => {
    // Remove open-source launches saved by earlier versions.
    const old = db.prepare("SELECT key, website FROM saas_products WHERE source='hn'").all().filter((r) => OSS_HOST.test(r.website || '')).map((r) => r.key);
    tx(() => { for (const k of old) { db.prepare('DELETE FROM saas_reviews WHERE key=?').run(k); db.prepare('DELETE FROM saas_products WHERE key=?').run(k); } });
    let saved = 0;
    const end = Math.floor(Date.now() / 1000);
    const start = end - years * 365 * 86400;
    const step = 45 * 86400; // ~45-day windows keep each query under Algolia's 1,000-hit cap
    for (let t = start; t < end; t += step) {
      const u = `https://hn.algolia.com/api/v1/search?tags=show_hn&numericFilters=points%3E%3D${minPoints},created_at_i%3E%3D${t},created_at_i%3C${t + step}&hitsPerPage=1000`;
      const j = await get(u, { json: true });
      const rows = (j.hits || []).filter((h) => h.url && !OSS_HOST.test(h.url)).map((h) => {
        const title = (h.title || '').replace(/^Show HN:\s*/i, '');
        const [name, ...rest] = title.split(/\s+[–—-]\s+|:\s+/);
        return {
          key: `hn:${h.objectID}`, source: 'hn', name: name.slice(0, 80), url: `https://news.ycombinator.com/item?id=${h.objectID}`, website: h.url,
          description: rest.join(' – ') || title, launched: h.created_at?.slice(0, 10),
          extra: { points: h.points, comments: h.num_comments, title }, detail_at: now(),
        };
      });
      saveProducts(rows);
      saved += rows.length;
      prog(`${saved} launches so far`);
      await sleep(400);
    }
    return `${saved.toLocaleString()} Show HN launches with ≥${minPoints} points (last ${years} years)`;
  });
}

// ================= Product Hunt (needs PH_TOKEN) =================
export async function productHunt({ months = 12 } = {}) {
  if (!process.env.PH_TOKEN) { sourceState('ph', { status: 'off', progress: 'Add PH_TOKEN (free developer token from producthunt.com/v2/oauth/applications) to enable' }); return; }
  await run('ph', async (prog) => {
    let saved = 0;
    for (let m = 0; m < months; m++) {
      const after = new Date(Date.now() - (m + 1) * 30 * 864e5).toISOString();
      const before = new Date(Date.now() - m * 30 * 864e5).toISOString();
      const query = `query($a:DateTime,$b:DateTime){posts(order:VOTES,postedAfter:$a,postedBefore:$b,first:50){edges{node{id name tagline description website url votesCount commentsCount reviewsRating createdAt thumbnail{url} topics{edges{node{name}}}}}}}`;
      const res = await fetch('https://api.producthunt.com/v2/api/graphql', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.PH_TOKEN}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query, variables: { a: after, b: before } }), signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`Product Hunt ${res.status}: ${(await res.text()).slice(0, 150)}`);
      const j = await res.json();
      if (j.errors) throw new Error(`Product Hunt: ${j.errors[0]?.message}`);
      const rows = (j.data?.posts?.edges || []).map(({ node: n }) => ({
        key: `ph:${n.id}`, source: 'ph', name: n.name, url: n.url, website: n.website, description: n.tagline || n.description || '',
        icon: n.thumbnail?.url || null, category: n.topics?.edges?.[0]?.node?.name || null, launched: n.createdAt?.slice(0, 10),
        rating: n.reviewsRating || null, extra: { votes: n.votesCount, comments: n.commentsCount, topics: (n.topics?.edges || []).map((e) => e.node.name) }, detail_at: now(),
      }));
      saveProducts(rows);
      saved += rows.length;
      prog(`${saved} launches`);
      await sleep(1500);
    }
    return `${saved} top launches from the last ${months} months`;
  });
}

// ================= Zapier app directory (~10K SaaS products in ~90 categories) =================
// Category pages list each category's most popular apps (name, description, website, partner tier); per-app pages
// (from Zapier's sitemap, allowed by its robots.txt) cover the long tail. Only the product's own data is used.
const ZAP_SKIP_CATS = new Set(['app-families', 'aws', 'facebook', 'google', 'microsoft', 'wordpress', 'zapier-tools', 'zoho']);
const zapNext = (html) => { const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); return m ? JSON.parse(m[1]).props?.pageProps || {} : {}; };
export function mapZapApp(a, { category = null, rank = null, alternatives = null } = {}) {
  return {
    key: `zap:${a.slug}`, source: 'zap', name: a.name, url: `https://zapier.com/apps/${a.slug}/integrations`,
    website: a.externalUrl || null, description: a.description || '', icon: a.logo?.mainUrl || a.logo?.mediumUrl || null,
    category,
    extra: { zapTier: a.partnerTier || null, ...(a.partnerTier === 'PLATINUM' ? { tier: 'giant' } : a.partnerTier === 'GOLD' ? { tier: 'established' } : {}), premium: Boolean(a.isPremium), beta: Boolean(a.isBeta), ...(rank ? { catRank: rank } : {}), ...(alternatives?.length ? { alternatives } : {}) },
    detail_at: now(),
  };
}
export const parseZapCategory = (html) => { const pp = zapNext(html); return { title: pp.categoryTitle, total: pp.totalApps, apps: pp.apps || [], categories: pp.appCategories || [] }; };
export function parseZapApp(html) {
  const ad = zapNext(html).oneAppPage?.appDetails;
  if (!ad?.app?.name) return null;
  const cat = (ad.appCategories || []).find((c) => !ZAP_SKIP_CATS.has(c.slug));
  return mapZapApp(ad.app, { category: cat?.title || null, alternatives: (ad.topAlternatives || []).map((x) => x.name || x.app?.name || x.title).filter(Boolean).slice(0, 8) });
}

export async function zapierCategories() {
  await run('zap', async (prog) => {
    const first = parseZapCategory(await get('https://zapier.com/apps/categories/customer-support', { timeout: 60_000 }));
    const subs = first.categories.filter((c) => !ZAP_SKIP_CATS.has(c.category.slug))
      .flatMap((c) => (c.subCategories?.length ? c.subCategories : [c.category]).filter((x) => !ZAP_SKIP_CATS.has(x.slug)));
    let saved = ckGet('zapcat')?.saved || 0;
    for (const [i, c] of subs.entries()) {
      if (i < (ckGet('zapcat')?.i ?? -1)) continue;
      try {
        const r = parseZapCategory(await get(`https://zapier.com/apps/categories/${c.slug}`, { timeout: 60_000 }));
        // An app already in another category keeps its first (most specific popular) category.
        const rows = r.apps.map((a, k) => mapZapApp(a, { category: c.title, rank: k + 1 }))
          .map((row) => db.prepare('SELECT category FROM saas_products WHERE key=?').get(row.key)?.category ? { ...row, category: null } : row);
        saveProducts(rows);
        saved += rows.length;
      } catch (e) { if (e.status === 429) await sleep(60_000); }
      ckSet('zapcat', { i: i + 1, saved });
      prog(`${i + 1} of ${subs.length} categories · ${saved.toLocaleString()} popular apps`);
      await sleep(1200);
    }
    // Queue the long tail from the sitemap (name stays empty until its page is fetched, so it's hidden till then).
    const idx = await get('https://zapier.com/uag6x9zaeydnbfy75xsggcsb37h8cgzf-one-service-sitemap.xml', { timeout: 60_000 }).catch(() => '');
    const parts = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => decode(m[1]));
    const ins = db.prepare(`INSERT OR IGNORE INTO saas_products (key, source, url, listed_at) VALUES (?, 'zap', ?, ?)`);
    let queued = 0;
    for (const u of parts) {
      const xml = await get(u, { timeout: 60_000 }).catch(() => '');
      const slugs = [...xml.matchAll(/<loc>https:\/\/zapier\.com\/apps\/([a-z0-9-]+)\/integrations<\/loc>/g)].map((m) => m[1]);
      tx(() => { for (const sl of slugs) queued += ins.run(`zap:${sl}`, `https://zapier.com/apps/${sl}/integrations`, now()).changes; });
      await sleep(800);
    }
    ckSet('zapcat', null);
    return `${saved.toLocaleString()} popular apps from ${subs.length} categories · ${queued.toLocaleString()} more queued`;
  });
}

export async function zapierDetails({ budget = 400, gap = 1500 } = {}) {
  await run('zap-pages', async (prog) => {
    const todo = db.prepare(`SELECT key FROM saas_products WHERE source='zap' AND (detail_at IS NULL OR (name IS NOT NULL AND detail_at < ?))
      ORDER BY detail_at IS NOT NULL, coalesce(json_extract(extra, '$.catRank'), 99) LIMIT ?`).all(daysAgo(60), budget).map((r) => r.key);
    let ok = 0, gone = 0;
    for (const [i, key] of todo.entries()) {
      try {
        const row = parseZapApp(await get(`https://zapier.com/apps/${key.slice(4)}/integrations`, { timeout: 45_000 }));
        if (row) {
          const had = db.prepare('SELECT category, extra FROM saas_products WHERE key=?').get(key);
          if (had?.category) row.category = null; // keep the category from the category pages
          const oldExtra = had?.extra ? JSON.parse(had.extra) : {};
          row.extra = { ...oldExtra, ...row.extra, catRank: oldExtra.catRank ?? row.extra.catRank };
          saveProducts([row]); ok++;
        } else { db.prepare('UPDATE saas_products SET detail_at=? WHERE key=?').run(now(), key); }
      } catch (e) {
        if (e.status === 404 || e.status === 410) { db.prepare('UPDATE saas_products SET detail_at=?, name=NULL WHERE key=?').run(now(), key); gone++; }
        else if (e.status === 429) { prog('rate limited; pausing 60s'); await sleep(60_000); }
      }
      if (i % 10 === 0) prog(`${ok} of ${todo.length} app pages this run (${gone} removed)`);
      await sleep(gap);
    }
    const left = db.prepare(`SELECT count(*) n FROM saas_products WHERE source='zap' AND detail_at IS NULL`).get().n;
    return `${ok} app pages this run · ${left.toLocaleString()} not fetched yet`;
  });
}

// ================= Y Combinator companies (yc-oss open dataset, rebuilt daily from YC's directory) =================
const YC_SKIP = /hardware|robotics|biotech|drug|therapeutic|medical device|aerospace|space|energy|climate|manufacturing|semiconductor|agriculture|mining|nuclear/i;
export function mapYc(c) {
  const team = +c.team_size || null;
  return {
    key: `yc:${c.id}`, source: 'yc', name: c.name, url: c.url || `https://www.ycombinator.com/companies/${c.slug}`, website: c.website || null,
    category: `YC · ${c.subindustry || c.industry || 'Other'}`.replace(/ -> /g, ' › '), description: c.one_liner || (c.long_description || '').slice(0, 300),
    icon: c.small_logo_thumb_url && !/missing/.test(c.small_logo_thumb_url) ? c.small_logo_thumb_url : null,
    launched: c.launched_at ? new Date(c.launched_at * 1000).toISOString().slice(0, 10) : null,
    model: (c.tags || []).some((t) => /saas|subscription/i.test(t)) ? 'subscription' : null,
    extra: { batch: c.batch, status: c.status, teamSize: team, stage: c.stage, top: Boolean(c.top_company), hiring: Boolean(c.isHiring), tags: c.tags || [],
      tier: team >= 500 || c.status === 'Public' ? 'giant' : team >= 50 ? 'established' : 'indie' },
    detail_at: now(),
  };
}
export const keepYc = (c) => !c.nonprofit && c.status !== 'Inactive' && c.industry !== 'Government'
  && !YC_SKIP.test(`${c.subindustry || ''} ${(c.tags || []).join(' ')}`);

export async function ycSource() {
  await run('yc', async () => {
    const all = await get('https://yc-oss.github.io/api/companies/all.json', { json: true, timeout: 90_000 });
    const rows = all.filter(keepYc).map(mapYc);
    for (let i = 0; i < rows.length; i += 500) saveProducts(rows.slice(i, i + 500));
    return `${rows.length.toLocaleString()} active software companies (of ${all.length.toLocaleString()} YC companies)`;
  });
}

// ================= Your research (SaaS Database export) =================
export async function researchSource() {
  await run('research', async () => {
    const dir = path.resolve(process.env.RESEARCH_DIR || path.join(process.env.DATA_DIR || 'data', 'idea-hunter'));
    const file = path.join(dir, 'saas_database', 'products.json');
    if (!fs.existsSync(file)) return 'no export in data/idea-hunter';
    const mtime = String(fs.statSync(file).mtimeMs);
    if (db.prepare("SELECT v FROM kv WHERE k='research_mtime'").get()?.v === mtime) return 'up to date';
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    saveProducts(list.map((p, i) => ({
      key: `research:${i}`, source: 'research', name: p.name, url: p.url || null, website: p.url || null, category: p.cat,
      description: p.desc, ...parsePlans([p.price || '']), pricing: p.price || null,
      model: /subscription|per seat|\/mo/i.test(`${p.model} ${p.price}`) ? 'subscription' : /one[- ]time|lifetime/i.test(p.model || '') ? 'one-time' : null,
      revenue_text: p.revenue || null,
      extra: { verdict: p.verdict, why: p.why, idea: p.idea, buildWeeks: p.build, tier: p.tier, complaints: (p.complaints || []).length, customer: p.customer, evidence: p.evidence, researchId: i },
      detail_at: now(),
    })));
    for (const [i, p] of list.entries()) {
      if (p.complaints?.length) saveReviews(`research:${i}`, p.complaints.map((c, k) => ({ rid: `c${k}`, stars: null, date: null, author: c.count || '', text: c.text, url: c.src })));
    }
    db.prepare("INSERT INTO kv (k,v) VALUES ('research_mtime', ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v").run(mtime);
    return `${list.length} researched products`;
  });
}

// ================= Orchestration =================
let running = null;
export function syncStatus() { return { running: Boolean(running) }; }

// Independent lanes run in parallel (different hosts, so no shared rate limit). SQLite writes are synchronous,
// so lanes never interleave inside a transaction. Long list crawls resume from checkpoints after a restart.
export function syncAll({ log = console.log } = {}) {
  if (running) return running;
  const lane = (name, fn) => fn().catch((e) => log(`[saas:${name}] lane error: ${e.message}`));
  running = (async () => {
    await researchSource();
    const on = (src) => ENABLED.has(src);
    await Promise.all([
      on('atl') && lane('atlassian', async () => {
        if (due('atl', 7) || ckGet('atl')) await atlassianList();
        await atlassianReviews();
      }),
      on('wp') && lane('wordpress', async () => {
        if (due('wp', 7) || ckGet('wp')) await wordpressList();
        await wordpressReviews();
      }),
      lane('launches', async () => {
        if (on('trustmrr') && due('trustmrr', 0.5)) await trustmrrSource();
        if (on('yc') && due('yc', 3)) await ycSource();
        if (on('hn') && (due('hn', 1) || db.prepare("SELECT 1 FROM saas_products WHERE source='hn' AND website LIKE '%github.com/%' LIMIT 1").get())) await hnShow();
        if (on('ph') && due('ph', 1)) await productHunt();
      }),
      on('zap') && lane('zapier', async () => {
        if (due('zap', 7) || ckGet('zapcat')) await zapierCategories();
        for (let i = 0; i < 40; i++) {
          const left = db.prepare(`SELECT count(*) n FROM saas_products WHERE source='zap' AND detail_at IS NULL`).get().n;
          if (!left) break;
          await zapierDetails({ budget: 400 });
        }
      }),
      lane('reviews', async () => {
        // Give the list sources a head start so new products get matched too.
        await sleep(90_000);
        for (let i = 0; i < 200; i++) {
          const r = await listings.listingsSource({ budget: 90 });
          if (!r.done) break;
        }
      }),
      on('shopify') && lane('shopify', async () => {
        if (due('shopify-sitemap', 7)) await shopifySitemap();
        // Alternate detail pages and reviews until nothing is due (each chunk ~15 min).
        for (let i = 0; i < 200; i++) {
          const pending = db.prepare(`SELECT count(*) n FROM saas_products WHERE source='shopify' AND (detail_at IS NULL OR detail_at < ?)`).get(daysAgo(21)).n;
          const revPending = db.prepare(`SELECT count(*) n FROM saas_products WHERE source='shopify' AND reviews >= 15 AND (reviews_at IS NULL OR reviews_at < ?)`).get(daysAgo(30)).n;
          if (!pending && !revPending) break;
          if (pending) await shopifyDetails({ budget: 600 });
          if (revPending) await shopifyReviews({ budget: 60 });
        }
      }),
    ]);
    log('[saas] sync pass finished');
  })().catch((e) => log(`[saas] sync error: ${e.message}`)).finally(() => (running = null));
  return running;
}
