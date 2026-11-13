import express from 'express';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ios from './lib/ios.js';
import * as android from './lib/android.js';
import { metaAds, adLinks } from './lib/ads.js';
import { brandSocials } from './lib/socials.js';
import { igProfile, igConfigured } from './lib/instagram.js';
import * as trust from './lib/trustmrr.js';
import * as store from './lib/store.js';
import { upsertApps, queryCatalog, catalogStats, suggestLocal, chartWithHistory, grossingByCategory } from './lib/db.js';
import { crawl, crawlStatus } from './lib/crawler.js';
import { opportunities } from './lib/opportunity.js';
import { importAppGoblin, importStatus } from './lib/importer.js';
import { pool } from './lib/http.js';
import { mock } from './lib/mock.js';
import * as research from './lib/research.js';
import * as saasStore from './lib/saas/store.js';
import * as listings from './lib/saas/listings.js';
import { clonePlan } from './lib/saas/plan.js';
import * as saasSources from './lib/saas/sources.js';

const MOCK = process.env.MOCK === '1';
const PORT = Number(process.env.PORT || 4317); // not 3000: something on this PC kills whatever listens on 3000 every 5 minutes
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = { ios, android };

const app = express();
app.use(express.json());
let lastRoute = '';
app.use((req, _res, next) => { if (req.url.startsWith('/api/')) lastRoute = `${req.method} ${req.url.slice(0, 120)}`; next(); });
app.use(express.static(path.join(__dirname, 'public')));

const h = (fn) => async (req, res) => {
  try {
    res.json(await fn(req, res));
  } catch (e) {
    console.error(`[${req.method} ${req.path}]`, e.message);
    res.status(e.status && e.status < 600 ? e.status : 502).json({ error: e.message });
  }
};

const cc = (req) => String(req.query.country || 'us').toLowerCase().slice(0, 2);
const storeParam = (s) => {
  if (s !== 'ios' && s !== 'android') throw Object.assign(new Error('store must be ios or android'), { status: 400 });
  return s;
};
// Every app we see is added to the local catalog, so coverage grows as you browse.
const remember = (apps) => { try { upsertApps(apps); } catch {} return apps; };

export async function fetchApp(st, id, country = 'us') {
  if (MOCK) return mock.app(st, id);
  const a = await src[st].app(id, country);
  remember([a, ...(a.similar || [])]);
  return a;
}

app.get('/api/meta', h(async () => ({
  mock: MOCK,
  metaConfigured: Boolean(process.env.META_TOKEN) || MOCK,
  igConfigured: igConfigured() || MOCK,
  trustmrr: trust.syncStatus(),
  crawl: crawlStatus(),
  iosGenres: ios.IOS_GENRES,
  playCategories: android.PLAY_CATEGORIES,
})));

app.get('/api/charts', h(async (req) => {
  const st = storeParam(req.query.store || 'ios');
  const chart = ['free', 'paid', 'grossing'].includes(req.query.chart) ? req.query.chart : 'free';
  if (MOCK) return mock.chart({ store: st, chart });
  const r = st === 'ios'
    ? await ios.chart({ chart, country: cc(req), genre: req.query.category || '' })
    : await android.chart({ chart, country: cc(req), category: req.query.category || '' });
  remember(r.apps);
  return r;
}));

app.get('/api/search', h(async (req) => {
  const q = String(req.query.q || '').trim();
  if (!q) return { ios: [], android: [] };
  const which = req.query.store || 'both';
  const run = async (st) => {
    if (which !== 'both' && which !== st) return { apps: [] };
    try {
      return { apps: MOCK ? mock.search(q, st) : remember(await src[st].search(q, cc(req))) };
    } catch (e) {
      return { apps: [], error: e.message };
    }
  };
  const [i, a] = await Promise.all([run('ios'), run('android')]);
  return { ios: i.apps, android: a.apps, errors: [i.error, a.error].filter(Boolean) };
}));

app.get('/api/app/:store/:id', h(async (req) => {
  const st = storeParam(req.params.store);
  const a = await fetchApp(st, req.params.id, cc(req));
  const [history, tracked] = await Promise.all([store.history(st, a.id), store.listTracked()]);
  return { app: a, history, tracked: tracked.some((t) => t.store === st && t.id === a.id) };
}));

// Up to 500 reviews (App Store RSS caps at 10 pages × 50; Play via google-play-scraper).
app.get('/api/reviews/:store/:id', h(async (req) => {
  const st = storeParam(req.params.store);
  const sort = ['newest', 'rating', 'helpful'].includes(req.query.sort) ? req.query.sort : 'newest';
  if (MOCK) return { reviews: mock.reviews(st, req.params.id, 500), sort, cap: 500 };
  if (st === 'ios') {
    const r = await ios.reviews(req.params.id, cc(req), 10);
    return { reviews: r.reviews, sort: 'newest', cap: 500, note: 'Apple only exposes the 500 most recent reviews per country.' };
  }
  return { reviews: await android.reviews(req.params.id, cc(req), sort, 500), sort, cap: 500 };
}));

app.get('/api/developer/:store/:devId', h(async (req) => {
  const st = storeParam(req.params.store);
  if (MOCK) return { apps: mock.developer(st, req.params.devId) };
  return { apps: remember(await src[st].byDeveloper(req.params.devId, cc(req))) };
}));

// Type-ahead: instant local catalog matches (live=0), then live store matches (live=1).
app.get('/api/suggest', h(async (req) => {
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q.length < 2) return { apps: [] };
  const local = suggestLocal(q, 6).map((r) => ({ store: r.store, id: r.id, name: r.name, developer: r.developer, icon: r.icon, ratingsCount: r.ratings, installs: r.installs, genre: r.category }));
  if (req.query.live !== '1') return { apps: local };
  const live = MOCK ? [] : await Promise.allSettled([ios.search(q, cc(req), 6), android.quickSearch(q, cc(req), 6)])
    .then((rs) => rs.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])));
  if (!MOCK) remember(live);
  const seen = new Set();
  const lc = q.toLowerCase();
  const merged = [...live, ...local].filter((a) => (seen.has(a.store + a.id) ? false : seen.add(a.store + a.id)));
  merged.sort((a, b) => (b.name?.toLowerCase().startsWith(lc) ? 1 : 0) - (a.name?.toLowerCase().startsWith(lc) ? 1 : 0) || (b.ratingsCount || 0) - (a.ratingsCount || 0));
  return { apps: merged.slice(0, 10) };
}));

// Category insights from the daily crawl.
app.get('/api/insights', h(async (req) => {
  const st = storeParam(req.query.store || 'ios');
  const chart = ['free', 'paid', 'grossing'].includes(req.query.chart) ? req.query.chart : 'grossing';
  return { ...chartWithHistory({ store: st, country: cc(req), chart, category: req.query.category || '' }), crawl: crawlStatus() };
}));
app.get('/api/insights/overview', h(async (req) => ({ ...grossingByCategory({ store: storeParam(req.query.store || 'ios'), country: cc(req), top: 50 }), crawl: crawlStatus() })));
const oppCache = new Map();
app.get('/api/opportunities', h(async (req) => {
  const store = ['ios', 'android', 'both'].includes(req.query.store) ? req.query.store : 'both';
  const key = `${store}|${cc(req)}|${+req.query.minDemand || 30}`;
  const hit = oppCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return { ...hit.value, crawl: crawlStatus() };
  const t = Date.now();
  const value = opportunities({ store, country: cc(req), minDemand: +req.query.minDemand || 30 });
  if (Date.now() - t > 3000) console.log(`[slow] opportunities took ${Date.now() - t}ms`);
  oppCache.set(key, { at: Date.now(), value });
  return { ...value, crawl: crawlStatus() };
}));
app.get('/api/crawl', h(async () => crawlStatus()));
app.post('/api/crawl', h(async () => { if (!MOCK) crawl().catch(() => {}); return crawlStatus(); }));

app.get('/api/catalog', h(async (req) => ({ ...queryCatalog(req.query), import: importStatus() })));

// Fill icons / ratings / developer names for catalog rows that came from the bulk import.
app.post('/api/enrich', h(async (req) => {
  const st = storeParam(req.body.store);
  const ids = (req.body.ids || []).map(String).slice(0, 60);
  if (MOCK || !ids.length) return { apps: [] };
  let apps = [];
  if (st === 'ios') {
    apps = (await ios.lookup(ids, cc(req)).catch(() => [])).map((r) => ios.normalizeLookup(r));
  } else {
    apps = (await pool(ids, 6, (id) => android.detailsFor(id, cc(req)))).filter(Boolean).map((a) => android.normalize(a));
  }
  remember(apps);
  return { apps };
}));

app.get('/api/import', h(async () => importStatus()));
app.post('/api/import', h(async () => {
  if (!MOCK) importAppGoblin().catch(() => {});
  return importStatus();
}));
app.get('/api/catalog/stats', h(async () => catalogStats()));

app.get('/api/socials', h(async (req) => {
  const { website = '', name = '' } = req.query;
  return MOCK ? mock.socials({ name }) : brandSocials({ website, name });
}));

app.get('/api/instagram', h(async (req) => {
  const handle = String(req.query.handle || '').trim();
  if (!handle) throw Object.assign(new Error('handle required'), { status: 400 });
  return MOCK ? mock.instagram(handle) : igProfile(handle);
}));

app.get('/api/ads', h(async (req) => {
  const { q = '', pageId = '', domain = '', status = 'ACTIVE' } = req.query;
  const links = adLinks(q, domain);
  if (!q && !pageId) return { links, configured: Boolean(process.env.META_TOKEN) };
  const meta = MOCK ? mock.ads(q) : await metaAds({ q, pageId, status: status === 'ALL' ? 'ALL' : 'ACTIVE' });
  return { links, ...meta };
}));

app.get('/api/verified', h(async (req) => {
  const status = trust.syncStatus();
  const useApi = !MOCK && status.count > 0;
  const list = MOCK
    ? mock.trustmrr()
    : useApi
      ? trust.listSynced({ category: req.query.category, q: req.query.q, appsOnly: req.query.appsOnly === '1' })
      : await trust.discovery();
  const iosIds = [...new Set(list.map((s) => s.iosId).filter(Boolean))];
  let apps = [];
  if (iosIds.length) {
    apps = MOCK
      ? iosIds.map((id) => mock.app('ios', id))
      : remember((await ios.lookup(iosIds, 'us').catch(() => [])).map((r) => ios.normalizeLookup(r)));
  }
  const byId = new Map(apps.map((a) => [a.id, a]));
  return {
    source: MOCK ? 'demo' : useApi ? 'api' : 'discovery',
    status,
    categories: useApi ? trust.syncedCategories() : [],
    startups: list.map((s) => ({ ...s, app: s.iosId ? byId.get(s.iosId) || null : null })),
  };
}));

app.post('/api/verified/sync', h(async () => {
  if (!trust.apiConfigured()) throw Object.assign(new Error('Set TRUSTMRR_API_KEY first'), { status: 400 });
  trust.syncAll();
  return trust.syncStatus();
}));

// ---------- Idea Hunter research (SaaS mode + app ideas) ----------
app.get('/api/research/status', h(async () => research.status()));
app.get('/api/saas/facets', h(async () => research.productFacets()));
app.get('/api/saas/products', h(async (req) => research.products(req.query)));
app.get('/api/saas/product/:id', h(async (req) => {
  const r = research.product(req.params.id);
  if (!r) throw Object.assign(new Error('Product not found'), { status: 404 });
  return r;
}));
app.get('/api/saas/problems', h(async (req) => ({ rows: research.problems(req.query) })));
app.get('/api/saas/categories', h(async () => research.categories()));
app.get('/api/saas/ideas', h(async () => ({ rows: research.saasIdeas() })));
app.get('/api/saas/complaints', h(async () => ({ rows: research.saasComplaints() })));
app.get('/api/saas/avoid', h(async () => ({ rows: research.saasAvoid() })));
app.get('/api/saas/startups', h(async (req) => research.startups(req.query)));
app.get('/api/saas/suggest', h(async (req) => {
  const q = String(req.query.q || '');
  const live = saasStore.suggest(q, 8).map((r) => ({ kind: 'saas', key: r.key, name: r.name, sub: `${{ shopify: 'Shopify app', wp: 'WordPress plugin', atl: 'Atlassian app', trustmrr: 'TrustMRR', hn: 'Show HN', ph: 'Product Hunt', yc: 'Y Combinator', zap: 'Zapier directory', research: 'Research' }[r.source] || r.source}${r.category ? ' · ' + r.category : ''}`, verdict: r.verdict, score: r.score, icon: r.icon, url: r.website || r.url }));
  const startups = research.suggest(q, 6).filter((x) => x.kind === 'startup');
  return { items: [...live, ...startups].slice(0, 12) };
}));
app.get('/api/apps/ideas', h(async () => research.appIdeas()));

// ---------- Live SaaS catalog (Shopify, WordPress, Atlassian, TrustMRR, HN, Product Hunt, research) ----------
app.get('/api/s2/list', h(async (req) => saasStore.listProducts(req.query)));
app.get('/api/s2/facets', h(async () => saasStore.facets()));
app.get('/api/s2/item', h(async (req) => {
  const p = saasStore.getProduct(String(req.query.key || ''));
  if (!p) throw Object.assign(new Error('Product not found'), { status: 404 });
  const reviews = saasStore.getReviews(p.key, 800);
  const categoryNote = research.categoryNote(p.category);
  const peers = p.category ? saasStore.listProducts({ cat: p.category, limit: 12, sort: 'score', hard: '1' }).rows.filter((x) => x.key !== p.key).slice(0, 10) : [];
  return { product: p, reviews, plan: clonePlan(p, reviews, { categoryNote }), categoryNote, problems: research.problemsNaming(p.name), peers };
}));
// Look a product's store listings and reviews up now instead of waiting for the background pass.
app.post('/api/s2/match', h(async (req) => listings.matchProduct(String(req.query.key || ''))));
app.get('/api/s2/sources', h(async () => ({ ...saasStore.sourcesSummary(), ...saasSources.syncStatus(), enabled: [...saasStore.ENABLED], keys: { trustmrr: Boolean(process.env.TRUSTMRR_API_KEY), ph: Boolean(process.env.PH_TOKEN) } })));
app.post('/api/s2/sync', h(async () => { if (!MOCK) saasSources.syncAll(); else await saasSources.researchSource(); return saasSources.syncStatus(); }));

app.get('/api/tracked', h(async () => {
  const list = await store.listTracked();
  const withHist = await Promise.all(list.map(async (t) => ({ ...t, history: await store.history(t.store, t.id) })));
  return { tracked: withHist };
}));

app.post('/api/track', h(async (req) => {
  const st = storeParam(req.body.store);
  const a = await fetchApp(st, String(req.body.id), req.body.country || 'us');
  await store.track({ ...a, country: req.body.country || 'us' });
  return { history: await store.snapshot(a) };
}));

app.delete('/api/track/:store/:id', h(async (req) => ({ tracked: await store.untrack(req.params.store, req.params.id) })));

export async function snapshotAll(log = console.log) {
  const list = await store.listTracked();
  for (const t of list) {
    try {
      const a = await fetchApp(t.store, t.id, t.country);
      await store.snapshot(a);
      log(`snapshot ok  ${t.store} ${t.name}`);
    } catch (e) {
      log(`snapshot FAIL ${t.store} ${t.name}: ${e.message}`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url) || process.env.APP_INTEL_MAIN === '1') {
  // A failed background job (crawl, import, sync) must never take the dashboard down.
  // Crash diagnostics are written SYNCHRONOUSLY to data/crash.log: on Windows, console output piped to the
  // supervisor can be lost when the process dies, which hid the cause of earlier crashes.
  const dataDir = path.resolve(process.env.DATA_DIR || 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const crashLog = path.join(dataDir, 'crash.log');
  try { if (fs.statSync(crashLog).size > 2e6) fs.renameSync(crashLog, crashLog + '.old'); } catch {}
  const diag = (msg) => { try { fs.appendFileSync(crashLog, `[${new Date().toISOString()}] pid ${process.pid} ${msg}\n`); } catch {} };
  const mem = () => { const m = process.memoryUsage(); return `rss ${Math.round(m.rss / 1e6)}MB heap ${Math.round(m.heapUsed / 1e6)}/${Math.round(m.heapTotal / 1e6)}MB`; };
  process.on('unhandledRejection', (e) => { diag(`unhandledRejection: ${e?.stack || e}`); console.error('[background error]', e?.message || e); });
  process.on('uncaughtException', (e) => { diag(`uncaughtException: ${e?.stack || e}`); console.error('[background error]', e?.message || e); });
  process.on('exit', (code) => diag(`EXIT code ${code} after ${Math.round(process.uptime())}s · ${mem()} · last request ${lastRoute} · crawl ${crawlStatus().progress}`));
  diag(`started · node ${process.version} · ${process.platform} · ppid ${process.ppid} · ${mem()}`);
  // Record any shutdown signal (Ctrl+C, console close, external kill request) before acting on it.
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP']) {
    process.on(sig, () => { diag(`received ${sig}`); if (sig !== 'SIGHUP') process.exit(0); });
  }
  process.on('beforeExit', (code) => diag(`beforeExit ${code} (event loop empty)`));
  // On Windows, once per day, start a detached read-only process watcher (scripts/procwatch.ps1) that records what
  // happens around the 5-minute kill. Output: data/procwatch.txt. Off by default; PROCWATCH=1 enables it.
  if (process.platform === 'win32' && process.env.PROCWATCH === '1') {
    try {
      // One file per watcher; skip while another watcher is still running or one finished in the last 20 hours.
      const out = path.join(dataDir, `procwatch-${process.pid}.txt`);
      const others = fs.readdirSync(dataDir).filter((f) => /^procwatch.*\.txt$/.test(f)).map((f) => path.join(dataDir, f));
      const busy = others.some((f) => { const st = fs.statSync(f); const done = /== done/.test(fs.readFileSync(f, 'utf8')); return done ? Date.now() - st.mtimeMs < 20 * 3600_000 : Date.now() - st.mtimeMs < 60_000; });
      if (!busy) {
        // Run the script text via -EncodedCommand (no execution-policy or downloaded-file issues) and not detached
        // (a detached PowerShell has no console on Windows and exits immediately).
        const body = fs.readFileSync(path.join(__dirname, 'scripts', 'procwatch.ps1'), 'utf8').replace(/^param\([^)]*\)\s*$/m, '')
          .replace(/^/, `$ServerPid = ${process.pid}\n$Out = '${out.replace(/'/g, "''")}'\n`);
        const pw = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(body, 'utf16le').toString('base64')],
          { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        let err = '';
        pw.stdout.on('data', (d) => { err += d; });
        pw.stderr.on('data', (d) => { err += d; });
        pw.on('error', (e) => diag(`procwatch could not start: ${e.message}`));
        pw.on('close', (code) => diag(`procwatch ended code ${code}: ${err.slice(0, 600).replace(/\s+/g, ' ')}`));
        diag(`procwatch started (pid ${pw.pid})`);
      }
    } catch (e) { diag(`procwatch failed: ${e.message}`); }
  }
  // Snapshot of live resources shortly before the 5-minute mark where earlier runs were killed.
  for (const at of [240_000, 290_000]) setTimeout(() => {
    const info = process.getActiveResourcesInfo?.() || [];
    const counts = info.reduce((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});
    diag(`resources at ${at / 1000}s: ${JSON.stringify(counts)} · ${mem()}`);
  }, at).unref();
  // Heartbeat: memory and event-loop freezes (a long synchronous job blocks every request).
  let tick = Date.now();
  setInterval(() => {
    const lag = Date.now() - tick - 60_000;
    tick = Date.now();
    diag(`heartbeat · ${mem()} · loop lag ${lag}ms · last request ${lastRoute} · crawl ${crawlStatus().progress}`);
  }, 60_000).unref();
  if (MOCK) { mock.seedCatalog(); mock.seedRanks(); saasSources.researchSource().catch(() => {}); }
  app.listen(PORT, () => {
    console.log(`[${new Date().toISOString()}] App Intel running at http://localhost:${PORT}${MOCK ? '  (DEMO DATA)' : ''}`);
    if (MOCK) return;
    if (!process.env.META_TOKEN) console.log('META_TOKEN not set: Ad library shows links only.');
    if (!igConfigured()) console.log('IG_USER_ID/IG_TOKEN not set: Instagram posts disabled.');
    const imp = importStatus();
    // Runs until one import has fully completed (an interrupted import resumes; upserts are idempotent).
    if (process.env.AUTO_IMPORT !== '0' && !imp.last) {
      console.log('First run: downloading the AppGoblin catalog (~120 MB, ~1.1M apps with traction) in the background…');
      importAppGoblin().catch(() => {});
    }
    // SaaS catalog: research import immediately, live sources shortly after, then every 6 hours.
    saasSources.researchSource().catch(() => {}).finally(() => {
      try { const n = saasStore.backfillDomains(); if (n) console.log(`SaaS: linked ${n.toLocaleString()} products by website`); } catch (e) { console.error('SaaS domain backfill:', e.message); }
    });
    if (process.env.SAAS_SYNC !== '0') {
      setTimeout(() => saasSources.syncAll(), 45_000);
      setInterval(() => saasSources.syncAll(), 6 * 3600_000);
    }
    const c = crawlStatus();
    if (c.lastRun && /^expanding/.test(c.progress || '') && process.env.CRAWL_EXPAND !== '0') {
      console.log('Resuming the unfinished expansion pass…');
      setTimeout(() => crawl({ expandOnly: true }).catch((e) => console.error('expand failed:', e.message)), 60_000);
    }
    if (!c.lastRun || Date.now() - Date.parse(c.lastRun) > 20 * 3600_000) {
      console.log(`Category crawl starting for ${c.config.countries.join(',')} (first run can take ~1h per country; progress in Categories tab).`);
      setTimeout(() => crawl().catch((e) => console.error('crawl failed:', e.message)), 30_000);
    }
    setInterval(() => { const c2 = crawlStatus(); if (!c2.running && Date.now() - Date.parse(c2.lastRun || 0) > 20 * 3600_000) crawl().catch((e) => console.error('crawl failed:', e.message)); }, 3600_000);
    const s = trust.syncStatus();
    if (s.configured && (!s.lastSync || Date.now() - Date.parse(s.lastSync) > 24 * 3600_000)) {
      console.log('TrustMRR: starting background sync of all startups…');
      trust.syncAll();
    }
  });
  if (!MOCK) {
    setTimeout(() => snapshotAll(), 10_000);
    setInterval(() => snapshotAll(), 12 * 3600_000);
  }
}

export default app;
