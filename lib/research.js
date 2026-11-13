// Idea Hunter research (SaaS Database, scans, startups) served from JSON files in data/idea-hunter/.
// Drop a newer export folder's `data/` contents in there and the server reloads it automatically
// (checked by file modification time on each request). Everything is small enough to filter in memory.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.RESEARCH_DIR || path.join(process.env.DATA_DIR || 'data', 'idea-hunter'));
const FILES = {
  products: 'saas_database/products.json',
  problems: 'saas_database/problem_statements.json',
  catNotes: 'saas_database/category_notes.json',
  startups: 'startups/startups.json',
  saasIdeas: 'saas_track/saas_ideas.json',
  saasCats: 'saas_track/saas_categories.json',
  saasComplaints: 'saas_track/saas_complaints.json',
  saasAvoid: 'saas_track/saas_avoid.json',
  appIdeas: 'apps_track/app_ideas.json',
  trends: 'apps_track/trends.json',
  stories: 'apps_track/builder_stories.json',
  sources: 'apps_track/sources.json',
  appList: 'reference/app_list_556.json',
  runlog: 'reference/runlog.json',
};
const cache = {};

function load(key) {
  const file = path.join(ROOT, FILES[key]);
  let st;
  try { st = fs.statSync(file); } catch { return []; }
  const hit = cache[key];
  if (hit && hit.mtime === st.mtimeMs) return hit.data;
  let data = [];
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`research: cannot read ${FILES[key]}: ${e.message}`); }
  data = Array.isArray(data) ? data : [];
  cache[key] = { mtime: st.mtimeMs, data: prepare(key, data) };
  return cache[key].data;
}

const domain = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const lc = (s) => String(s ?? '').toLowerCase();
const arr = (x) => (Array.isArray(x) ? x : x ? String(x).split(/\s*[,;]\s*/) : []);

// SaaS track score (methodology/saas-track-rules.md): weighted pillars rescaled to 0–100.
export function saasScore(i) {
  const n = (k) => +i[k] || 0;
  return Math.round(((4 * n('demand') + 4 * n('pain') + 3 * n('switch') + 3 * n('build') + 2 * n('recurring') + 2 * n('distribution') + n('monetization') + n('defensibility') - 20) / 80) * 100);
}
// Apps track status: pass = every pillar ≥3 and a wedge; watch = one pillar at 2 or no wedge; miss = rest.
const APP_PILLARS = ['demand', 'pain', 'build', 'content', 'search', 'recurring_s'];
export function appStatus(i) {
  const v = APP_PILLARS.map((k) => +i[k] || 0);
  const low = v.filter((x) => x < 3);
  const wedge = Boolean(String(i.wedge || '').trim());
  if (!low.length && wedge) return 'pass';
  if ((low.length === 1 && low[0] === 2) || (!low.length && !wedge)) return 'watch';
  return 'miss';
}

function prepare(key, data) {
  if (key === 'products') {
    return data.map((p, idx) => ({
      ...p, _id: idx, _domain: domain(p.url), _n: (p.complaints || []).length,
      _hay: lc([p.name, p.desc, p.cat, p.customer, p.idea, p.why, p.pattern, ...(p.complaints || []).map((c) => c.text)].join(' ')),
    }));
  }
  if (key === 'startups') return data.map((s, idx) => ({ ...s, _id: idx, _hay: lc([s.name, s.one_liner, s.desc, s.category, s.industry, ...(s.tags || []), s.idea].join(' ')) }));
  if (key === 'saasIdeas') return data.map((i) => ({ ...i, score: saasScore(i) })).sort((a, b) => b.score - a.score);
  if (key === 'appIdeas') {
    return data.map((i) => ({ ...i, computed: appStatus(i), pillarSum: APP_PILLARS.reduce((s, k) => s + (+i[k] || 0), 0), usersFor2k: i.price ? Math.ceil(2000 / i.price) : null }))
      .sort((a, b) => b.pillarSum - a.pillarSum);
  }
  if (key === 'problems') return data.map((p, idx) => ({ ...p, _id: idx }));
  return data;
}

const ORDER = { clone: 0, gap: 1, watch: 2, avoid: 3 };
const TIER = { indie: 0, established: 1, giant: 2 };

export function status() {
  const p = load('products');
  return {
    available: p.length > 0, dir: ROOT,
    counts: Object.fromEntries(Object.keys(FILES).map((k) => [k, load(k).length])),
    lastRun: load('runlog')[0]?.at || null,
  };
}

export function productFacets() {
  const p = load('products');
  const count = (k) => Object.entries(p.reduce((m, r) => ((m[r[k] || ''] = (m[r[k] || ''] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  return { categories: count('cat'), verdicts: count('verdict'), tiers: count('tier') };
}

export function products(q = {}) {
  let rows = load('products');
  const term = lc(q.q).trim();
  if (term) rows = rows.filter((r) => r._hay.includes(term));
  if (q.cat) rows = rows.filter((r) => r.cat === q.cat);
  if (q.verdict) { const v = q.verdict.split(','); rows = rows.filter((r) => v.includes(r.verdict)); }
  if (q.tier) rows = rows.filter((r) => r.tier === q.tier);
  if (q.evidence) rows = rows.filter((r) => r.evidence === q.evidence);
  if (q.price === '1') rows = rows.filter((r) => r.price);
  if (q.revenue === '1') rows = rows.filter((r) => r.revenue);
  if (+q.maxBuild) rows = rows.filter((r) => r.build != null && r.build <= +q.maxBuild);
  const sorts = {
    best: (a, b) => (ORDER[a.verdict] ?? 9) - (ORDER[b.verdict] ?? 9) || (b.evidence === 'sourced') - (a.evidence === 'sourced') || b._n - a._n || Boolean(b.revenue) - Boolean(a.revenue),
    complaints: (a, b) => b._n - a._n,
    build: (a, b) => (a.build ?? 99) - (b.build ?? 99),
    name: (a, b) => a.name.localeCompare(b.name),
    tier: (a, b) => (TIER[a.tier] ?? 9) - (TIER[b.tier] ?? 9),
  };
  rows = rows.slice().sort(sorts[q.sort] || sorts.best);
  const limit = Math.min(200, +q.limit || 50);
  const page = Math.max(1, +q.page || 1);
  return { total: rows.length, page, limit, rows: rows.slice((page - 1) * limit, page * limit).map(({ _hay, ...r }) => r) };
}

export function product(id) {
  const p = load('products')[+id];
  if (!p) return null;
  const { _hay, ...r } = p;
  const name = lc(p.name);
  return {
    product: r,
    problems: load('problems').filter((x) => (x.current || []).some((c) => lc(c) === name)),
    categoryNote: load('catNotes').find((c) => c.cat === p.cat) || null,
    peers: load('products').filter((x) => x.cat === p.cat && x._id !== p._id).sort((a, b) => (ORDER[a.verdict] ?? 9) - (ORDER[b.verdict] ?? 9)).slice(0, 12).map(({ _hay, complaints, ...x }) => x),
  };
}

export const categoryNote = (cat) => load('catNotes').find((c) => c.cat === cat) || null;
export const problemsNaming = (name) => load('problems').filter((x) => (x.current || []).some((c) => lc(c) === lc(name)));

export function problems(q = {}) {
  let rows = load('problems');
  const term = lc(q.q).trim();
  if (term) rows = rows.filter((r) => lc([r.title, r.who, r.pain, r.play, ...(r.current || [])].join(' ')).includes(term));
  if (q.strength) rows = rows.filter((r) => r.strength === q.strength);
  if (q.angle) rows = rows.filter((r) => r.angle === q.angle);
  const S = { strong: 0, moderate: 1, thin: 2 };
  const byName = new Map(load('products').map((p) => [lc(p.name), p._id]));
  return rows.slice().sort((a, b) => (S[a.strength] ?? 9) - (S[b.strength] ?? 9) || (a.build_weeks ?? 99) - (b.build_weeks ?? 99))
    .map((r) => ({ ...r, currentLinks: (r.current || []).map((n) => ({ name: n, id: byName.get(lc(n)) ?? null })) }));
}

export function categories() {
  const notes = load('catNotes');
  const prods = load('products');
  const by = {};
  for (const p of prods) {
    const c = (by[p.cat] ||= { cat: p.cat, total: 0, clone: 0, gap: 0, watch: 0, avoid: 0, complaints: 0, withRevenue: 0 });
    c.total++; c[p.verdict] = (c[p.verdict] || 0) + 1; c.complaints += p._n; if (p.revenue) c.withRevenue++;
  }
  return {
    catalogue: Object.values(by).map((c) => ({ ...c, note: notes.find((n) => n.cat === c.cat) || null })).sort((a, b) => b.clone + b.gap - (a.clone + a.gap)),
    researched: load('saasCats'),
  };
}

export const saasIdeas = () => load('saasIdeas');
export const saasComplaints = () => load('saasComplaints');
export const saasAvoid = () => load('saasAvoid');
export const appIdeas = () => ({ ideas: load('appIdeas'), trends: load('trends'), stories: load('stories'), sources: load('sources') });

export function startups(q = {}) {
  let rows = load('startups');
  const term = lc(q.q).trim();
  if (term) rows = rows.filter((r) => r._hay.includes(term));
  if (q.fit) rows = rows.filter((r) => r.fit === q.fit);
  if (q.source) rows = rows.filter((r) => r.source === q.source);
  if (q.angle) rows = rows.filter((r) => (q.angle === 'any' ? r.angle && r.angle !== 'skip' : r.angle === q.angle));
  if (q.ai === '1') rows = rows.filter((r) => r.ai);
  if (q.batch) rows = rows.filter((r) => r.batch === q.batch);
  if (q.status) rows = rows.filter((r) => lc(r.status) === lc(q.status));
  const F = { likely: 0, possible: 1, unlikely: 2 };
  rows = rows.slice().sort((a, b) => (b.judged - a.judged) || (F[a.fit] ?? 9) - (F[b.fit] ?? 9) || (b.border ?? -1) - (a.border ?? -1));
  const limit = Math.min(200, +q.limit || 60);
  const page = Math.max(1, +q.page || 1);
  const batches = [...new Set(load('startups').map((s) => s.batch).filter(Boolean))];
  return { total: rows.length, page, limit, batches, rows: rows.slice((page - 1) * limit, page * limit).map(({ _hay, ...r }) => r) };
}

// Type-ahead in SaaS mode: products and startups by name prefix first, then contains.
export function suggest(qs, limit = 10) {
  const t = lc(qs).trim();
  if (t.length < 2) return [];
  const rank = (n) => (lc(n).startsWith(t) ? 0 : lc(n).includes(t) ? 1 : 2);
  const p = load('products').filter((r) => rank(r.name) < 2).map((r) => ({ kind: 'product', id: r._id, name: r.name, sub: r.cat, verdict: r.verdict, url: r.url, r: rank(r.name) }));
  const s = load('startups').filter((r) => rank(r.name) < 2).map((r) => ({ kind: 'startup', id: r._id, name: r.name, sub: r.one_liner, url: r.url, r: rank(r.name) }));
  return [...p, ...s].sort((a, b) => a.r - b.r || a.name.length - b.name.length).slice(0, limit);
}
