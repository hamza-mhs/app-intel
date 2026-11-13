import { estimate, DEFAULT_ASSUMPTIONS, fmtNum, fmtMoney, fmtRange, median } from './estimate.js';
import { registerResearch } from './research.js';

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ls = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const COUNTRIES = ['us', 'gb', 'ca', 'au', 'de', 'fr', 'es', 'it', 'nl', 'se', 'in', 'pk', 'ae', 'sa', 'br', 'mx', 'jp', 'kr', 'id', 'tr'];
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '–');
const ago = (d) => {
  const days = Math.round((Date.now() - Date.parse(d)) / 864e5);
  return !Number.isFinite(days) ? '' : days < 1 ? 'today' : days < 31 ? `${days}d ago` : days < 365 ? `${Math.round(days / 30)}mo ago` : `${(days / 365).toFixed(1)}y ago`;
};
const stars = (n) => { const k = Math.max(0, Math.min(5, Math.round(n || 0))); return '★'.repeat(k) + `<span style="color:var(--line-2)">${'★'.repeat(5 - k)}</span>`; };
const icon = (a, lg) =>
  a.icon ? `<img class="ico${lg ? ' lg' : ''}" src="${esc(a.icon)}" alt="" loading="lazy" data-name="${esc(a.name || '?')}">` : `<div class="ico${lg ? ' lg' : ''}">${esc((a.name || '?')[0])}</div>`;
const conf = (c) => `<span class="pill ${c}">${c === 'none' ? 'no signal' : c + ' confidence'}</span>`;
const loading = (t = 'Loading…') => `<div class="loading"><span class="spin"></span>${esc(t)}</div>`;

const cache = new Map();
async function api(path, opts) {
  const isGet = !opts || !opts.method || opts.method === 'GET';
  if (isGet && cache.has(path)) return cache.get(path);
  const p = fetch(path, opts && { ...opts, headers: { 'Content-Type': 'application/json' } }).catch(() => {
    throw new Error("Can't reach the App Intel server. Check the PowerShell window: if it closed or shows an error, run npm start again.");
  }).then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `${r.status} ${r.statusText}`);
    return j;
  });
  if (isGet) {
    cache.set(path, p);
    p.catch(() => cache.delete(path));
  }
  return p;
}

// ---------- assumptions ----------
let A = { ...DEFAULT_ASSUMPTIONS, ...ls.get('assumptions', {}) };
const est = (app, hist) => estimate(app, A, hist || []);

const FIELD_LABELS = {
  iosDownloadsPerRating: 'iOS downloads per rating',
  payConversion: 'Download → paying (fraction)',
  monthlyChurn: 'Monthly churn (fraction)',
  storeCut: 'Store cut (fraction)',
  defaultSubPrice: 'Default price when unknown ($)',
  yearlyThreshold: 'Prices above this are yearly ($)',
  adDauPerMonthlyDownload: 'Ad apps: DAU per monthly download',
  adArpdau: 'Ad apps: revenue per DAU per day ($)',
};
function renderAssumptionFields() {
  $('#assumptionFields').innerHTML =
    `<div class="af"><span></span><span class="kicker">low</span><span class="kicker">mid</span><span class="kicker">high</span></div>` +
    Object.entries(FIELD_LABELS)
      .map(([k, label]) => {
        const v = A[k];
        const vals = Array.isArray(v) ? v : [null, v, null];
        return `<div class="af"><label>${label}</label>${vals
          .map((x, i) => `<input data-k="${k}" data-i="${i}" type="number" step="any" value="${x ?? ''}" ${x == null ? 'disabled' : ''}>`)
          .join('')}</div>`;
      })
      .join('');
}
$('#assumptionFields').addEventListener('input', (e) => {
  const { k, i } = e.target.dataset;
  const n = parseFloat(e.target.value);
  if (!Number.isFinite(n)) return;
  if (Array.isArray(A[k])) A[k] = A[k].map((x, j) => (j === +i ? n : x));
  else A[k] = n;
  ls.set('assumptions', A);
  route(true);
});
$('#openAssumptions').onclick = () => { renderAssumptionFields(); $('#assumptions').showModal(); };
$('#resetAssumptions').onclick = () => { A = { ...DEFAULT_ASSUMPTIONS }; ls.set('assumptions', {}); renderAssumptionFields(); route(true); };

// ---------- routing ----------
let META = null;
function parseHash() {
  const [p, q] = location.hash.replace(/^#\/?/, '').split('?');
  return { parts: p.split('/').filter(Boolean), q: Object.fromEntries(new URLSearchParams(q || '')) };
}
const go = (path) => (location.hash = path);

// ---------- Apps / SaaS mode ----------
let research;
let MODE = ls.get('mode', 'apps') === 'saas' ? 'saas' : 'apps';
const APP_ROUTES = new Set(['charts', 'insights', 'opps', 'appideas', 'catalog', 'search', 'app', 'tracked', 'sources']);
function setMode(m) {
  MODE = m;
  ls.set('mode', m);
  document.body.dataset.mode = m;
  document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  document.querySelectorAll('#nav a').forEach((a) => (a.hidden = !(a.dataset.mode === 'both' || a.dataset.mode === m)));
  $('#searchInput').placeholder = m === 'saas' ? 'Search SaaS products & startups…' : 'Search any app…';
  $('.brand').lastChild.textContent = m === 'saas' ? ' SaaS Intel' : ' App Intel';
}
$('#modeSeg').addEventListener('click', (e) => {
  const m = e.target.dataset.m;
  if (!m || m === MODE) return;
  setMode(m);
  go(m === 'saas' ? '#/s-clone' : '#/charts');
});

async function route(soft) {
  const { parts, q } = parseHash();
  const v = parts[0] || (MODE === 'saas' ? 's-clone' : 'charts');
  // The route decides the mode (so shared links open in the right mode); shared tabs keep the current one.
  const m = v.startsWith('s-') ? 'saas' : APP_ROUTES.has(v) ? 'apps' : MODE;
  if (m !== MODE || document.body.dataset.mode !== m) setMode(m);
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === v || (v === 's-item' && a.dataset.v === 's-all')));
  if (!soft) window.scrollTo(0, 0);
  research ||= registerResearch({ api, esc, $, go, loading, fmtDate, view, renderBrandBits });
  const R = { ...research.routes, opps: viewOpps, insights: viewInsights, catalog: viewCatalog, charts: viewCharts, search: viewSearch, app: viewApp, ads: viewAds, brand: viewBrand, verified: viewVerified, tracked: viewTracked, sources: viewSources }[v] || (MODE === 'saas' ? research.routes['s-clone'] : viewCharts);
  try {
    await R(parts, q, soft);
  } catch (e) {
    view.innerHTML = `<div class="empty err">${esc(e.message)}</div>`;
  }
}
window.addEventListener('hashchange', () => route());
$('#searchForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#searchInput').value.trim();
  if (q) go(MODE === 'saas' ? `#/s-all?q=${encodeURIComponent(q)}` : `#/search?q=${encodeURIComponent(q)}`);
});

// ---------- shared app table ----------
const COLS = [
  ['rank', '#', (a) => a.rank ?? 0, 'num'],
  ['name', 'App', (a) => a.name],
  ['genre', 'Category', (a) => a.genre || ''],
  ['rating', 'Rating', (a) => a.rating ?? 0, 'num'],
  ['ratings', 'Ratings', (a) => a.ratingsCount ?? 0, 'num'],
  ['dl', 'Downloads / mo', (a) => a._e.downloads.mid, 'num'],
  ['mrr', 'MRR (est.)', (a) => a._e.revenue.mrr?.mid ?? 0, 'num'],
  ['rev', 'Revenue / mo', (a) => a._e.revenue.monthly.mid, 'num'],
  ['price', 'Price', (a) => a.price ?? 0, 'num'],
];

function appTable(apps, { sortKey = 'rank', dir = 1, onSort, country = 'us', showRank = true } = {}) {
  apps.forEach((a) => (a._e = est(a))); // recompute: assumptions may have changed
  const col = COLS.find((c) => c[0] === sortKey) || COLS[0];
  const sorted = apps.slice().sort((x, y) => {
    const a = col[2](x), b = col[2](y);
    return (typeof a === 'string' ? a.localeCompare(b) : a - b) * dir;
  });
  const cols = COLS.filter((c) => showRank || c[0] !== 'rank');
  const html = `<div class="table-wrap"><table><thead><tr>${cols
    .map((c) => `<th class="${c[3] || ''}" data-sort="${c[0]}">${c[1]}${c[0] === sortKey ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`)
    .join('')}</tr></thead><tbody>${sorted
    .map((a) => {
      const e = a._e;
      return `<tr data-href="#/app/${a.store}/${encodeURIComponent(a.id)}?country=${country}">
        ${showRank ? `<td class="rank num">${a.rank ?? ''}${a.rankDelta ? `<br><span class="delta ${a.rankDelta > 0 ? 'up' : 'down'}">${a.rankDelta > 0 ? '▲' : '▼'}${Math.abs(a.rankDelta)}</span>` : a.isNew ? '<br><span class="delta up">new</span>' : ''}</td>` : ''}
        <td><div class="appcell">${icon(a)}<div><b>${esc(a.name)}</b><small>${a.store === 'ios' ? 'iOS' : 'Android'}${a.developer ? ' · ' + esc(a.developer) : ''}</small></div></div></td>
        <td class="muted">${esc(a.genre || '')}</td>
        <td class="num">${a.rating ? a.rating.toFixed(1) : '–'}</td>
        <td class="num">${fmtNum(a.ratingsCount)}${a.installsText ? `<span class="range">${esc(a.installsText)} inst.</span>` : ''}</td>
        <td class="num">${fmtNum(e.downloads.mid)}<span class="range">${fmtRange(e.downloads)}</span></td>
        <td class="num">${e.revenue.mrr ? fmtMoney(e.revenue.mrr.mid) : '–'}<span class="range">${e.revenue.mrr ? fmtRange(e.revenue.mrr, fmtMoney) : ''}</span></td>
        <td class="num">${fmtMoney(e.revenue.monthly.mid)}<span class="range">${conf(e.confidence)}</span></td>
        <td class="num">${a.price ? '$' + a.price : 'Free'}</td></tr>`;
    })
    .join('')}</tbody></table></div>`;
  const wrap = document.createElement('div');
  wrap.innerHTML = html;
  wrap.querySelectorAll('tbody tr').forEach((tr) => (tr.onclick = () => go(tr.dataset.href)));
  wrap.querySelectorAll('th').forEach((th) => (th.onclick = () => onSort?.(th.dataset.sort)));
  return wrap;
}

// ---------- Charts ----------
async function viewCharts(_, __, soft) {
  const S = { store: 'ios', chart: 'grossing', country: 'us', category: '', sort: 'rank', dir: 1, ...ls.get('charts', {}) };
  const save = () => ls.set('charts', S);
  const cats = S.store === 'ios' ? Object.entries(META.iosGenres).sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[1].localeCompare(b[1]))) :[['', 'All categories'], ...META.playCategories.map((c) => [c, c.replace(/_/g, ' ').toLowerCase()])];
  view.innerHTML = `
    <div class="view-head"><div><h1>Top charts</h1><p>Live store charts with modelled downloads and revenue. Click any app for detail and method.</p></div></div>
    <div class="controls" style="margin-bottom:14px">
      <div class="seg" id="st">${['ios', 'android'].map((s) => `<button data-v="${s}" class="${S.store === s ? 'on' : ''}">${s === 'ios' ? 'App Store' : 'Google Play'}</button>`).join('')}</div>
      <div class="seg" id="ch">${['free', 'paid', 'grossing'].map((s) => `<button data-v="${s}" class="${S.chart === s ? 'on' : ''}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <select id="cc">${COUNTRIES.map((c) => `<option ${c === S.country ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <select id="cat">${cats.map(([k, v]) => `<option value="${k}" ${k === S.category ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
    </div>
    <div id="notes"></div><div id="tbl">${loading('Loading chart and app details (first load of a chart can take ~20s)…')}</div>`;
  $('#st').onclick = (e) => { if (e.target.dataset.v) { S.store = e.target.dataset.v; S.category = ''; save(); viewCharts(); } };
  $('#ch').onclick = (e) => { if (e.target.dataset.v) { S.chart = e.target.dataset.v; save(); viewCharts(); } };
  $('#cc').onchange = (e) => { S.country = e.target.value; save(); viewCharts(); };
  $('#cat').onchange = (e) => { S.category = e.target.value; save(); viewCharts(); };
  const data = await api(`/api/charts?store=${S.store}&chart=${S.chart}&country=${S.country}&category=${S.category}`);
  const notes = [...(data.notes || [])];
  if (S.store === 'ios') notes.push('Chart rows don\'t include IAP prices, so revenue here uses the default price. Open an app to use its real prices.');
  $('#notes').innerHTML = notes.map((n) => `<div class="banner warn">${esc(n)}</div>`).join('');
  const draw = () => {
    const t = $('#tbl');
    if (!t) return;
    t.innerHTML = data.apps.length ? '' : '<div class="empty">No apps returned.</div>';
    if (data.apps.length)
      t.append(appTable(data.apps, { sortKey: S.sort, dir: S.dir, country: S.country, onSort: (k) => { S.dir = S.sort === k ? -S.dir : k === 'rank' || k === 'name' ? 1 : -1; S.sort = k; save(); draw(); } }));
  };
  draw();
}

// ---------- All apps (local catalog) ----------
const fromRow = (r) => ({
  store: r.store, id: r.id, name: r.name || r.id, developer: r.developer || '', developerId: r.developer_id,
  genre: r.category, price: r.price || 0, offersIAP: r.iap == null ? null : !!r.iap, adSupported: !!r.ad_supported,
  installs: r.installs, ratingsCount: r.ratings || 0, rating: r.rating, released: r.released, updated: r.updated,
  icon: r.icon, iapPrices: [],
});

function importBanner(imp, total) {
  if (imp.running) return `<div class="banner"><span class="spin"></span>Building the full catalog from AppGoblin: ${esc(imp.progress || 'starting…')}. Browse while it runs; refresh to see new apps.</div>`;
  if (imp.imported) return `<div class="dim" style="font-size:12px;margin:-8px 0 12px">Includes ${fmtNum(imp.imported)} apps from the AppGoblin catalog (CC BY 4.0, appgoblin.info). Live store search below covers apps newer than the catalog.</div>`;
  return `<div class="banner warn" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">Only ${fmtNum(total)} apps from charts and searches so far. ${imp.progress && /error/.test(imp.progress) ? `Last import failed: ${esc(imp.progress)}.` : ''}
    <button class="primary" id="impBtn" style="padding:5px 12px">Import ~1.1M apps (free, ~120 MB)</button></div>`;
}

async function viewCatalog(_, q) {
  const F = { store: '', category: '', q: '', minInstalls: '', minRatings: '', minRating: '', iap: '', ads: '', paid: '', releasedAfter: '', updatedAfter: '', sort: 'ratings', page: '1', ...q };
  const stats = await api('/api/catalog/stats?_=' + Math.floor(Date.now() / 30000));
  const total = stats.byStore.reduce((s, x) => s + x.n, 0);
  const catMap = {};
  for (const c of stats.categories) if (!F.store || c.store === F.store) catMap[c.category] = (catMap[c.category] || 0) + c.n;
  const cats = Object.entries(catMap).sort((a, b) => a[0].localeCompare(b[0]));
  const sel = (name, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}" ${String(F[name]) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  view.innerHTML = `
    <div class="view-head"><div><h1>All apps</h1><p>${fmtNum(total)} apps in your catalog (${stats.byStore.map((x) => `${fmtNum(x.n)} ${x.store === 'ios' ? 'App Store' : 'Google Play'}`).join(' · ') || 'empty'}). Filters apply as you type.</p></div></div>
    <div id="impBox"></div>
    <form id="cf" class="controls" style="margin-bottom:14px" onsubmit="return false">
      <input class="input" name="q" placeholder="Search name or developer" value="${esc(F.q)}" style="min-width:220px" autocomplete="off">
      ${sel('store', [['', 'Both stores'], ['ios', 'App Store'], ['android', 'Google Play']])}
      <select name="category"><option value="">All categories</option>${cats.map(([c, n]) => `<option value="${esc(c)}" ${c === F.category ? 'selected' : ''}>${esc(c)} (${fmtNum(n)})</option>`).join('')}</select>
      ${sel('minRatings', [['', 'Any ratings'], [100, '100+ ratings'], [1000, '1K+'], [10000, '10K+'], [100000, '100K+']])}
      ${sel('minInstalls', [['', 'Any installs'], [10000, '10K+ installs'], [100000, '100K+'], [1000000, '1M+'], [10000000, '10M+']])}
      ${sel('minRating', [['', 'Any rating'], [4, '4.0★+'], [4.5, '4.5★+']])}
      ${sel('iap', [['', 'IAP: any'], ['1', 'Has IAP'], ['0', 'No IAP']])}
      ${sel('ads', [['', 'Ads: any'], ['1', 'Shows ads'], ['0', 'No ads']])}
      ${sel('paid', [['', 'Free + paid'], ['0', 'Free'], ['1', 'Paid']])}
      <label class="muted" style="font-size:12px">Released after <input class="input" type="date" name="releasedAfter" value="${esc(F.releasedAfter)}"></label>
      <label class="muted" style="font-size:12px">Updated after <input class="input" type="date" name="updatedAfter" value="${esc(F.updatedAfter)}"></label>
      ${sel('sort', [['ratings', 'Sort: most ratings'], ['installs', 'Most installs'], ['rating', 'Highest rated'], ['newest', 'Newest'], ['updated', 'Recently updated'], ['name', 'Name']])}
    </form><div id="live"></div><div id="ct">${loading()}</div>`;

  const form = $('#cf');
  let seq = 0, timer, pollT;
  const readForm = () => { for (const [k, v] of new FormData(form)) F[k] = v; };
  const qs = () => new URLSearchParams(Object.fromEntries(Object.entries(F).filter(([, v]) => v !== '')));
  const schedule = (resetPage = true, delay = 250) => {
    clearTimeout(timer);
    timer = setTimeout(() => { readForm(); if (resetPage) F.page = '1'; history.replaceState(null, '', `#/catalog?${qs()}`); refresh(); }, delay);
  };
  form.addEventListener('input', (e) => schedule(true, e.target.name === 'q' ? 300 : 0));
  form.addEventListener('change', () => schedule(true, 0));

  const renderImport = (imp) => {
    const box = $('#impBox');
    if (!box) return;
    box.innerHTML = importBanner(imp, total);
    const b = $('#impBtn');
    if (b) b.onclick = async () => { b.disabled = true; renderImport(await api('/api/import', { method: 'POST' })); poll(); };
  };
  const poll = () => { clearTimeout(pollT); pollT = setTimeout(async () => { if (!$('#impBox')) return; const imp = await api('/api/import?_=' + Date.now()).catch(() => null); if (imp) { renderImport(imp); if (imp.running) poll(); } }, 4000); };

  async function liveResults(term, my) {
    const box = $('#live');
    if (!box) return;
    if (term.length < 2) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="muted" style="margin-bottom:10px"><span class="spin"></span>Searching the App Store and Google Play live…</div>`;
    const r = await api(`/api/suggest?q=${encodeURIComponent(term)}&live=1`).catch(() => ({ apps: [] }));
    if (my !== seq || !$('#live')) return;
    box.innerHTML = r.apps.length ? `<div class="kicker" style="margin-bottom:6px">Quick matches · live from both stores + your catalog</div><div class="grid g3" style="margin-bottom:16px">${r.apps.map((a) => `<a class="sg card tight" href="#/app/${a.store}/${encodeURIComponent(a.id)}">${icon(a)}<span class="tx"><div class="nm">${esc(a.name)}</div><div class="sub">${esc(a.developer || '')}</div></span><span class="pill ${a.store}" style="flex:none">${a.store === 'ios' ? 'iOS' : 'Android'}</span></a>`).join('')}</div>` : '';
  }

  async function enrich(apps, redraw, my) {
    for (const st of ['ios', 'android']) {
      const ids = apps.filter((a) => a.store === st && !a.icon).map((a) => a.id);
      if (!ids.length) continue;
      const r = await api('/api/enrich', { method: 'POST', body: JSON.stringify({ store: st, ids }) }).catch(() => null);
      if (!r || my !== seq) return;
      const by = new Map(r.apps.map((x) => [x.id, x]));
      for (const a of apps) {
        const x = a.store === st && by.get(a.id);
        if (x) Object.assign(a, { icon: x.icon, developer: x.developer || a.developer, rating: x.rating ?? a.rating, ratingsCount: x.ratingsCount || a.ratingsCount, installs: x.installs ?? a.installs, offersIAP: x.offersIAP ?? a.offersIAP, adSupported: x.adSupported ?? a.adSupported, iapPrices: x.iapPrices || [], updated: x.updated || a.updated, ratingsCurrentVersion: x.ratingsCurrentVersion, currentVersionReleased: x.currentVersionReleased });
      }
      redraw();
    }
  }

  async function refresh() {
    const my = ++seq;
    F.page = '1'; // pages after the first are appended as you scroll
    const el = $('#ct');
    if (!el) return;
    el.style.opacity = '0.55';
    liveResults(F.q.trim(), my);
    let r;
    try { r = await api(`/api/catalog?${qs()}`); } catch (e) { el.style.opacity = ''; el.innerHTML = `<div class="empty err">${esc(e.message)}</div>`; return; }
    if (my !== seq) return;
    el.style.opacity = '';
    renderImport(r.import);
    if (r.import.running) poll();
    const apps = r.rows.map(fromRow);
    if (!apps.length) { el.innerHTML = `<div class="empty">No apps in your catalog match these filters.${F.q ? ' Check the live store results above.' : ''}</div>`; return; }
    let sort = '', dir = -1;
    let total = r.total, capped = r.capped, more = r.rows.length === r.limit, loadingMore = false;
    const pager = () => `<div class="controls" style="margin-top:12px;justify-content:space-between"><span class="muted">${fmtNum(total)}${capped ? '+' : ''} matches · showing ${fmtNum(apps.length)}</span>${more ? `<button class="ghost" data-auto id="catMore">Load more</button>` : ''}</div>`;
    const loadMore = async () => {
      if (loadingMore || !more) return;
      loadingMore = true;
      F.page = String((+F.page || 1) + 1);
      let r2;
      try { r2 = await api(`/api/catalog?${qs()}`); } catch { loadingMore = false; return; }
      if (my !== seq) return;
      const next = r2.rows.map(fromRow);
      apps.push(...next);
      more = r2.rows.length === r2.limit;
      loadingMore = false;
      draw(true);
      enrich(next, () => draw(true), my);
    };
    const draw = (keepScroll) => {
      if (my !== seq) return;
      const y = window.scrollY;
      el.innerHTML = '';
      el.append(appTable(apps, { sortKey: sort, dir, showRank: false, onSort: (k) => { dir = sort === k ? -dir : -1; sort = k; draw(); } }));
      el.insertAdjacentHTML('beforeend', pager() + '<p class="dim" style="font-size:12px;margin-top:8px">Estimates here use catalog fields only (no reviews or IAP prices), so they are rougher than on the app page. Column sorting applies to the rows loaded so far.</p>');
      const cm = el.querySelector('#catMore');
      if (cm) cm.onclick = loadMore;
      if (window.scrollY !== y) window.scrollTo(0, y);
    };
    draw();
    enrich(apps, draw, my);
  }
  refresh();
}

// ---------- Search ----------
async function viewSearch(_, q) {
  const term = q.q || '';
  $('#searchInput').value = term;
  view.innerHTML = `<div class="view-head"><div><h1>Search</h1><p>${term ? `Results for “${esc(term)}” in both stores` : 'Type an app, keyword or brand in the search box.'}</p></div></div><div id="res">${term ? loading() : ''}</div>`;
  if (!term) return;
  const r = await api(`/api/search?q=${encodeURIComponent(term)}&country=${q.country || 'us'}`);
  const res = $('#res');
  res.innerHTML = (r.errors || []).map((e) => `<div class="banner warn">${esc(e)}</div>`).join('');
  for (const [st, label] of [['ios', 'App Store'], ['android', 'Google Play']]) {
    const sec = document.createElement('div');
    sec.className = 'section';
    sec.innerHTML = `<h2>${label} <span class="pill">${r[st].length}</span></h2>`;
    let sort = 'ratings', dir = -1;
    const draw = () => {
      sec.querySelector('.table-wrap')?.parentElement.remove();
      sec.append(r[st].length ? appTable(r[st], { sortKey: sort, dir, showRank: false, onSort: (k) => { dir = sort === k ? -dir : -1; sort = k; draw(); } }) : Object.assign(document.createElement('div'), { className: 'empty', textContent: 'No results' }));
    };
    draw();
    res.append(sec);
  }
}

// ---------- App detail ----------
const THEMES = [
  ['Pricing / paywall', /price|expensive|subscription|subscribe|paywall|pay(ing)? for|refund|charged|trial/i],
  ['Ads', /\bads?\b|advert/i],
  ['Bugs / crashes', /crash|bug|freez|broken|doesn'?t work|not working|glitch/i],
  ['Missing features', /\bwish\b|missing|please add|would be nice|feature request|integrat|\bsync/i],
  ['Login / account', /login|log in|sign in|account|password/i],
  ['Praise', /love|amazing|great|best|perfect|helpful/i],
];

function historyChart(hist, key, label) {
  const pts = hist.filter((p) => p[key] != null);
  if (pts.length < 2) return `<p class="muted">${pts.length} snapshot${pts.length === 1 ? '' : 's'} so far. The chart appears after the second daily snapshot; estimates switch to observed growth after 3+ days.</p>`;
  const W = 640, H = 160, P = 28;
  const xs = pts.map((p) => Date.parse(p.t)), ys = pts.map((p) => p[key]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const X = (x) => P + ((x - x0) / (x1 - x0 || 1)) * (W - 2 * P);
  const Y = (y) => H - P - ((y - y0) / (y1 - y0 || 1)) * (H - 2 * P);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(ys[i]).toFixed(1)}`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(label)} over time">
    <line x1="${P}" x2="${W - P}" y1="${H - P}" y2="${H - P}" stroke="var(--line)"/>
    <path d="${d}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${pts.map((p, i) => `<circle cx="${X(xs[i])}" cy="${Y(ys[i])}" r="3" fill="var(--accent)"><title>${fmtDate(p.t)}: ${p[key].toLocaleString()}</title></circle>`).join('')}
    <text x="${P}" y="14">${esc(label)} ${fmtNum(y1)}</text><text x="${P}" y="${H - 8}">${fmtDate(x0)}</text><text x="${W - P}" y="${H - 8}" text-anchor="end">${fmtDate(x1)}</text></svg>`;
}

async function viewApp(parts, q, soft) {
  const [, st, rawId] = parts;
  const id = decodeURIComponent(rawId || '');
  const country = q.country || 'us';
  if (!soft) view.innerHTML = loading('Loading app, reviews and prices…');
  const { app: a, history, tracked } = await api(`/api/app/${st}/${encodeURIComponent(id)}?country=${country}`);
  const e = est(a, history);
  const R = e.revenue;
  const hist = (a.reviews || []).length;
  const starDist = [5, 4, 3, 2, 1].map((s) => [s, (a.reviews || []).filter((r) => r.score === s).length]);
  const hasHistogram = a.histogram && Object.values(a.histogram).some(Boolean);
  const histo = hasHistogram ? [5, 4, 3, 2, 1].map((s) => [s, a.histogram[s] || 0]) : starDist;
  const hmax = Math.max(1, ...histo.map((x) => x[1]));
  const brandHref = `#/brand?name=${encodeURIComponent(a.developer || a.name)}&website=${encodeURIComponent(a.website || '')}&${st === 'ios' ? 'iosDev' : 'playDev'}=${encodeURIComponent(a.developerId || '')}`;

  view.innerHTML = `
  <div class="apphead">${icon(a, true)}
    <div><div class="kicker">${st === 'ios' ? 'App Store' : 'Google Play'} · ${esc(country.toUpperCase())}</div>
      <h1>${esc(a.name)}</h1>
      <div class="meta"><a href="${brandHref}">${esc(a.developer || '')}</a> · ${esc(a.genre || '')} · <span class="stars">${stars(a.rating)}</span> ${a.rating ? a.rating.toFixed(2) : ''} (${fmtNum(a.ratingsCount)}) · ${a.price ? '$' + a.price : 'Free'}${a.offersIAP ? ' + IAP' : ''}</div></div>
    <div class="actions">
      <button class="${tracked ? 'ghost' : 'primary'}" id="trackBtn">${tracked ? 'Tracking ✓' : 'Track daily'}</button>
      <a class="ghost" style="padding:8px 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel)" href="${esc(a.url)}" target="_blank" rel="noopener">Store page ↗</a>
    </div></div>

  <div class="grid g4">
    <div class="card kpi hero"><div class="kicker">MRR (estimated)</div><div class="v">${R.mrr ? fmtMoney(R.mrr.mid) : '$0'}</div><div class="r">${R.mrr ? fmtRange(R.mrr, fmtMoney) : 'No subscription signal'}</div></div>
    <div class="card kpi"><div class="kicker">Revenue / month</div><div class="v">${fmtMoney(R.monthly.mid)}</div><div class="r">${fmtRange(R.monthly, fmtMoney)} · net of store cut</div></div>
    <div class="card kpi"><div class="kicker">Downloads / month</div><div class="v">${fmtNum(e.downloads.mid)}</div><div class="r">${fmtRange(e.downloads)}</div></div>
    <div class="card kpi"><div class="kicker">${st === 'android' ? 'Lifetime installs (Google)' : 'Lifetime downloads (est.)'}</div><div class="v">${fmtNum(e.downloads.lifetime.mid)}</div><div class="r">${st === 'android' ? esc(a.installsText || '') + ' on the listing' : fmtRange(e.downloads.lifetime)}</div></div>
  </div>
  <div class="card" style="margin-top:12px">
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${conf(e.confidence)}<span class="muted">${esc(e.downloads.method)}</span></div>
    <details class="method"><summary>How these numbers are built</summary>
      <p><b>Downloads.</b> ${esc(e.downloads.method)}</p>
      <p><b>Revenue.</b> ${esc(R.method)}</p>
      ${R.price ? `<p><b>Price used.</b> $${R.price.price.toFixed(2)}${R.price.yearly ? ` (treated as yearly → $${R.price.monthly.toFixed(2)}/mo)` : '/mo'} from ${esc(R.price.source)}.</p>` : ''}
      ${R.subscribers ? `<p><b>Paying subscribers.</b> ${fmtRange(R.subscribers)} (mid ${fmtNum(R.subscribers.mid)}).</p>` : ''}
      ${R.ads ? `<p><b>Ad revenue.</b> ${fmtRange(R.ads, fmtMoney)} / month (Google says this app shows ads).</p>` : ''}
      ${R.upfront ? `<p><b>Paid downloads.</b> ${fmtRange(R.upfront, fmtMoney)} / month.</p>` : ''}
      <ul>${R.notes.map((n) => `<li>${esc(n)}</li>`).join('')}<li>Change the assumptions (sidebar) to see how sensitive these numbers are. Calibrate against real MRR in “Verified MRR”.</li></ul>
    </details>
  </div>

  <div class="grid g3 section">
    <div class="card"><h3>Ratings</h3><div class="bars">${histo
      .map(([s, n]) => `<div class="bar"><span>${s} ★</span><span class="track"><i style="width:${(n / hmax) * 100}%"></i></span><span>${fmtNum(n)}</span></div>`)
      .join('')}</div><p class="dim" style="margin-top:8px;font-size:12px">${hasHistogram ? 'All ratings (Google histogram)' : `Last ${hist} reviews`}</p></div>
    <div class="card"><h3>Pricing</h3>${a.price ? `<p style="margin-bottom:8px">Upfront price <b>$${a.price}</b></p>` : ''}${a.iapPrices?.length ? `<div class="chips">${a.iapPrices.map((p) => `<span class="chip">$${p}</span>`).join('')}</div>` : `<p class="muted">${a.offersIAP === false ? 'No in-app purchases listed.' : a.offersIAP ? 'Offers IAP; prices not readable.' : 'IAP prices unavailable.'}</p>`}
      ${a.iapRange ? `<p class="muted" style="margin-top:8px">Play range: ${esc(a.iapRange)}</p>` : ''}${a.adSupported ? '<p class="muted" style="margin-top:8px">Contains ads</p>' : ''}</div>
    <div class="card"><h3>Facts</h3><div class="list">
      ${[['Released', fmtDate(a.released)], ['Last update', `${fmtDate(a.updated)} (${ago(a.updated)})`], ['Version', a.version], ['Ratings this version', a.ratingsCurrentVersion != null ? fmtNum(a.ratingsCurrentVersion) : null], ['Review pace', a.reviewVelocity?.perDay ? `${a.reviewVelocity.perDay}/day (${a.reviewVelocity.sampleSize} sampled)` : null], ['Size', a.sizeMB ? a.sizeMB + ' MB' : null], ['Content rating', a.contentRating], ['Website', a.website ? `<a href="${esc(a.website)}" target="_blank" rel="noopener">${esc(a.website.replace(/^https?:\/\//, ''))}</a>` : null]]
        .filter((r) => r[1])
        .map(([k, v]) => `<div class="item" style="display:flex;justify-content:space-between;gap:10px;padding:6px 0"><span class="muted">${k}</span><span>${k === 'Website' ? v : esc(v)}</span></div>`)
        .join('')}</div></div>
  </div>

  <div class="section"><h2>History ${tracked ? '<span class="pill high">tracking</span>' : ''}</h2><div class="card">${
    tracked || history.length ? historyChart(history, st === 'android' ? 'installs' : 'ratingsCount', st === 'android' ? 'Installs' : 'Ratings') : '<p class="muted">Track this app to record a snapshot every day. After 3+ days, downloads switch from a model to observed growth.</p>'
  }</div></div>

  <div class="section" id="revSec"><h2>Reviews</h2>${loading('Loading up to 500 reviews…')}</div>

  <div class="section"><h2>Brand: socials & ads <a href="${brandHref}" style="font-size:13px;font-weight:500">Open brand view →</a></h2><div id="brandBits">${loading('Reading the developer website and ad library…')}</div></div>
  ${a.similar?.length ? `<div class="section"><h2>Similar apps</h2><div id="sim"></div></div>` : ''}`;

  $('#trackBtn').onclick = async () => {
    const btn = $('#trackBtn');
    btn.disabled = true;
    if (tracked) await api(`/api/track/${st}/${encodeURIComponent(a.id)}`, { method: 'DELETE' });
    else await api('/api/track', { method: 'POST', body: JSON.stringify({ store: st, id: a.id, country }) });
    cache.delete(`/api/app/${st}/${encodeURIComponent(id)}?country=${country}`);
    route(true);
  };
  if (a.similar?.length) $('#sim').append(appTable(a.similar, { sortKey: 'ratings', dir: -1, showRank: false, country }));
  renderBrandBits($('#brandBits'), { name: a.developer || a.name, adQuery: a.name, website: a.website });
  renderReviews($('#revSec'), st, a.id, country, a.reviews || []);
}

// ---------- Review explorer ----------
const SENT = { all: [1, 2, 3, 4, 5], negative: [1, 2], neutral: [3], positive: [4, 5] };

async function renderReviews(el, st, id, country, initial) {
  const S = { tab: 'all', sort: 'newest', q: '', shown: 20 };
  let all = initial;
  let note = '';
  const draw = () => {
    if (!el.isConnected) return;
    const counts = Object.fromEntries(Object.entries(SENT).map(([k, s]) => [k, all.filter((r) => s.includes(r.score)).length]));
    const themes = THEMES.map(([name, re]) => {
      const hits = all.filter((r) => re.test(`${r.title || ''} ${r.text || ''}`));
      const neg = hits.filter((r) => r.score <= 2).length;
      return { name, n: hits.length, neg, ex: hits.find((r) => (name === 'Praise' ? r.score >= 4 : r.score <= 3)) || hits[0] };
    });
    const q = S.q.toLowerCase();
    let list = all.filter((r) => SENT[S.tab].includes(r.score) && (!q || `${r.title || ''} ${r.text || ''}`.toLowerCase().includes(q)));
    const by = {
      newest: (a, b) => Date.parse(b.date) - Date.parse(a.date),
      lowest: (a, b) => a.score - b.score || Date.parse(b.date) - Date.parse(a.date),
      highest: (a, b) => b.score - a.score || Date.parse(b.date) - Date.parse(a.date),
      helpful: (a, b) => (b.thumbsUp || 0) - (a.thumbsUp || 0),
      longest: (a, b) => (b.text || '').length - (a.text || '').length,
    }[S.sort];
    list = list.slice().sort(by);
    const n = all.length || 1;
    el.innerHTML = `<h2>Reviews <span class="pill">${all.length} loaded</span></h2>
      ${note ? `<div class="banner">${esc(note)}</div>` : ''}
      <div class="grid g2">
        <div class="card"><h3>Sentiment</h3>
          <div class="bars">${[['Positive (4–5★)', counts.positive, 'var(--good)'], ['Neutral (3★)', counts.neutral, 'var(--warn)'], ['Negative (1–2★)', counts.negative, 'var(--bad)']]
            .map(([l, c, col]) => `<div class="bar" style="grid-template-columns:120px 1fr 64px"><span>${l}</span><span class="track"><i style="width:${(c / n) * 100}%;background:${col}"></i></span><span>${c} · ${Math.round((c / n) * 100)}%</span></div>`).join('')}</div>
          <h3 style="margin-top:18px">Themes</h3><div class="list">${themes
            .map((t) => `<div class="item"><div style="display:flex;justify-content:space-between;gap:8px"><a href="#" class="t" data-theme="${esc(t.name)}">${t.name}</a><span class="muted">${t.n} · ${Math.round((t.n / n) * 100)}%${t.name !== 'Praise' && t.n ? ` · ${t.neg} negative` : ''}</span></div>${t.ex ? `<div class="s">“${esc((t.ex.text || '').slice(0, 150))}”</div>` : ''}</div>`).join('')}</div>
          <p class="dim" style="margin-top:8px;font-size:12px">Keyword matching. Click a theme to filter the reviews.</p></div>
        <div class="card">
          <div class="controls" style="margin-bottom:10px">
            <div class="seg" id="rvTab">${Object.keys(SENT).map((k) => `<button data-v="${k}" class="${S.tab === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)} ${counts[k]}</button>`).join('')}</div>
            <select id="rvSort">${[['newest', 'Newest'], ['lowest', 'Lowest rated'], ['highest', 'Highest rated'], ['longest', 'Most detailed'], ...(st === 'android' ? [['helpful', 'Most helpful']] : [])].map(([v, l]) => `<option value="${v}" ${S.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <input class="input" id="rvQ" placeholder="Search reviews" value="${esc(S.q)}" style="flex:1;min-width:140px">
          </div>
          <div class="list">${list.slice(0, S.shown).map((r) => `<div class="item"><div style="display:flex;justify-content:space-between;gap:8px"><span class="stars">${stars(r.score)}</span><span class="dim">${ago(r.date)}${r.version ? ` · v${esc(r.version)}` : ''}${r.thumbsUp ? ` · 👍 ${r.thumbsUp}` : ''}</span></div>${r.title ? `<div class="t">${esc(r.title)}</div>` : ''}<div class="s">${esc(r.text || '')}</div>${r.reply ? `<div class="s" style="border-left:2px solid var(--line-2);padding-left:8px;margin-top:6px">Developer: ${esc(r.reply.slice(0, 300))}</div>` : ''}</div>`).join('') || '<p class="muted">No reviews match.</p>'}</div>
          ${list.length > S.shown ? `<button class="ghost wide" id="rvMore" data-auto style="margin-top:10px">Show more (${list.length - S.shown} left)</button>` : ''}
        </div></div>`;
    $('#rvTab', el).onclick = (e) => { if (e.target.dataset.v) { S.tab = e.target.dataset.v; S.shown = 20; draw(); } };
    $('#rvSort', el).onchange = (e) => { S.sort = e.target.value; draw(); };
    const qi = $('#rvQ', el);
    qi.oninput = () => { S.q = qi.value; S.shown = 20; draw(); const n2 = $('#rvQ', el); n2.focus(); n2.setSelectionRange(n2.value.length, n2.value.length); };
    $('#rvMore', el) && ($('#rvMore', el).onclick = () => { S.shown += 30; draw(); });
    el.querySelectorAll('[data-theme]').forEach((x) => (x.onclick = (ev) => { ev.preventDefault(); const re = THEMES.find((t) => t[0] === x.dataset.theme)[1]; S.q = ''; S.tab = 'all'; S.shown = 20; all = all.map((r) => r); themeFilter(re); }));
  };
  // Theme click: temporarily narrow to matching reviews via the search box semantics.
  const themeFilter = (re) => {
    const full = all;
    const matched = full.filter((r) => re.test(`${r.title || ''} ${r.text || ''}`));
    all = matched;
    note = `Showing ${matched.length} reviews in this theme.`;
    draw();
    const back = document.createElement('button');
    back.className = 'ghost';
    back.textContent = 'Show all reviews';
    back.style.marginBottom = '12px';
    back.onclick = () => { all = full; note = ''; draw(); };
    el.querySelector('.banner')?.after(back);
  };
  draw();
  try {
    const r = await api(`/api/reviews/${st}/${encodeURIComponent(id)}?country=${country}`);
    if (r.reviews?.length > all.length) all = r.reviews;
    note = r.note || '';
  } catch (e) {
    note = `Could not load more reviews: ${e.message}`;
  }
  draw();
}

// ---------- socials + ads blocks (shared by app + brand views) ----------
function domainOf(u) { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } }

async function renderBrandBits(el, { name, adQuery, website, ig }) {
  const [soc, ads] = await Promise.allSettled([
    api(`/api/socials?website=${encodeURIComponent(website || '')}&name=${encodeURIComponent(name || '')}`),
    api(`/api/ads?q=${encodeURIComponent(adQuery || name || '')}&domain=${encodeURIComponent(domainOf(website))}`),
  ]);
  if (!el.isConnected) return;
  el.innerHTML = `<div class="grid g2"><div class="card" id="socCard"></div><div class="card" id="adCard"></div></div><div id="igBox" class="section"></div>`;
  $('#socCard', el).innerHTML = socialsHTML(soc);
  $('#adCard', el).innerHTML = adsSummaryHTML(ads, adQuery || name);
  const handle = ig || (soc.status === 'fulfilled' ? soc.value.links?.instagram?.handle : null);
  renderInstagram($('#igBox', el), handle);
}

async function renderInstagram(el, handle) {
  if (!handle) {
    el.innerHTML = `<div class="card"><h3>Instagram</h3><p class="muted">No Instagram account found on the website. Enter a handle in Brand lookup to load posts and reels.</p></div>`;
    return;
  }
  if (!META.igConfigured) {
    el.innerHTML = `<div class="card"><h3>Instagram · @${esc(handle)}</h3><p class="muted">To load posts, reels, likes, comments and views, set <span class="mono">IG_USER_ID</span> and <span class="mono">IG_TOKEN</span> (Meta's free Business Discovery API; see README). Works for business and creator accounts only.</p>
      <div class="chips" style="margin-top:10px"><a class="chip" href="https://instagram.com/${esc(handle)}" target="_blank" rel="noopener">Open @${esc(handle)} ↗</a><a class="chip" href="https://instagram.com/${esc(handle)}/reels/" target="_blank" rel="noopener">Reels ↗</a></div></div>`;
    return;
  }
  el.innerHTML = loading(`Loading @${handle} from Instagram…`);
  let p;
  try { p = await api(`/api/instagram?handle=${encodeURIComponent(handle)}`); } catch (e) { p = { error: e.message }; }
  if (!el.isConnected) return;
  if (p.error) { el.innerHTML = `<div class="card"><h3>Instagram · @${esc(handle)}</h3><p class="err">${esc(p.error)}</p><p class="dim" style="font-size:12px;margin-top:6px">Personal and age-gated accounts can't be read through the API.</p></div>`; return; }
  const s = p.stats || {};
  const top = p.media.slice().sort((a, b) => (b.views || b.likes || 0) - (a.views || a.likes || 0));
  el.innerHTML = `<h2>Instagram · @${esc(p.username)} <a href="https://instagram.com/${esc(p.username)}" target="_blank" rel="noopener" style="font-size:13px;font-weight:500">Open ↗</a></h2>
    <div class="grid g4">
      <div class="card kpi"><div class="kicker">Followers</div><div class="v">${fmtNum(p.followers)}</div><div class="r">${fmtNum(p.posts)} posts</div></div>
      <div class="card kpi"><div class="kicker">Avg engagement</div><div class="v">${fmtNum(s.avgEngagement)}</div><div class="r">${s.engagementRate != null ? (s.engagementRate * 100).toFixed(2) + '% of followers' : ''}</div></div>
      <div class="card kpi"><div class="kicker">Posting pace</div><div class="v">${s.postsPerWeek ?? '–'}</div><div class="r">posts / week (last ${p.media.length})</div></div>
      <div class="card kpi"><div class="kicker">Reels share</div><div class="v">${s.reelShare != null ? Math.round(s.reelShare * 100) + '%' : '–'}</div><div class="r">of recent posts</div></div>
    </div>
    <div class="table-wrap section" style="margin-top:12px"><table><thead><tr><th>Post</th><th>Type</th><th class="num">Views</th><th class="num">Likes</th><th class="num">Comments</th><th>Posted</th></tr></thead><tbody>
      ${top.map((m) => `<tr onclick="window.open('${esc(m.url)}','_blank','noopener')"><td style="white-space:normal;max-width:460px">${esc(m.caption.slice(0, 140)) || '<span class="dim">(no caption)</span>'}</td><td><span class="pill ${m.type === 'Reel' ? 'high' : ''}">${m.type}</span></td><td class="num">${fmtNum(m.views)}</td><td class="num">${fmtNum(m.likes)}</td><td class="num">${fmtNum(m.comments)}</td><td class="muted">${ago(m.date)}</td></tr>`).join('')}
    </tbody></table></div><p class="dim" style="margin-top:8px;font-size:12px">Sorted by views (likes when views are hidden). Views include paid reach.</p>`;
}

function socialsHTML(res) {
  if (res.status === 'rejected') return `<h3>Socials</h3><p class="err">${esc(res.reason.message)}</p>`;
  const s = res.value;
  const links = Object.entries(s.links || {});
  const yt = s.youtube?.value?.videos || [];
  const bs = s.bluesky?.value?.posts || [];
  const hn = s.hackerNews?.value || [];
  const rd = s.reddit?.value || [];
  return `<h3>Socials</h3>
    ${s.error ? `<p class="err">${esc(s.error)}</p>` : ''}
    ${links.length ? `<div class="chips">${links.map(([k, v]) => `<a class="chip" href="${esc(v.url)}" target="_blank" rel="noopener">${k} · ${esc(v.handle)}</a>`).join('')}</div>` : `<p class="muted">No social links found on ${esc(s.site || 'the website')}.</p>`}
    ${yt.length ? `<div class="kicker" style="margin-top:14px">Latest YouTube</div><div class="list">${yt.slice(0, 5).map((v) => `<div class="item"><a class="t" href="${esc(v.url)}" target="_blank" rel="noopener">${esc(v.title)}</a><div class="s">${ago(v.published)}${v.views ? ` · ${fmtNum(v.views)} views` : ''}</div></div>`).join('')}</div>` : s.youtube?.error ? `<p class="dim" style="margin-top:10px">YouTube: ${esc(s.youtube.error)}</p>` : ''}
    ${bs.length ? `<div class="kicker" style="margin-top:14px">Latest Bluesky</div><div class="list">${bs.slice(0, 4).map((p) => `<div class="item"><a href="${esc(p.url)}" target="_blank" rel="noopener" class="s" style="color:var(--text)">${esc((p.text || '').slice(0, 180))}</a><div class="s">${ago(p.date)} · ♥ ${p.likes ?? 0}</div></div>`).join('')}</div>` : ''}
    ${hn.length ? `<div class="kicker" style="margin-top:14px">Hacker News mentions</div><div class="list">${hn.slice(0, 5).map((h) => `<div class="item"><a class="t" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title || 'comment')}</a><div class="s">${ago(h.date)}${h.points != null ? ` · ${h.points} pts` : ''}${h.text ? ` · ${esc(h.text.slice(0, 120))}` : ''}</div></div>`).join('')}</div>` : ''}
    ${rd.length ? `<div class="kicker" style="margin-top:14px">Reddit mentions</div><div class="list">${rd.slice(0, 5).map((h) => `<div class="item"><a class="t" href="${esc(h.url)}" target="_blank" rel="noopener">${esc(h.title)}</a><div class="s">${esc(h.sub)} · ${ago(h.date)} · ${h.score} pts</div></div>`).join('')}</div>` : s.reddit?.error ? `<p class="dim" style="margin-top:10px">Reddit: ${esc(s.reddit.error)}</p>` : ''}
    <p class="dim" style="margin-top:12px;font-size:12px">Instagram, TikTok, X and Facebook have no free post API, so those show links only.</p>`;
}

function adLinksHTML(links) {
  return `<div class="chips" style="margin-top:10px">${[['Meta Ad Library', links.meta], ['Google Ads Transparency', links.google], ['TikTok Ad Library', links.tiktok], ['LinkedIn Ad Library', links.linkedin]]
    .map(([n, u]) => `<a class="chip" href="${esc(u)}" target="_blank" rel="noopener">${n} ↗</a>`).join('')}</div>`;
}

function adsSummaryHTML(res, q) {
  if (res.status === 'rejected') return `<h3>Meta ads</h3><p class="err">${esc(res.reason.message)}</p>`;
  const r = res.value;
  if (!r.configured) return `<h3>Meta ads</h3><p class="muted">Add a free Meta Ad Library token to see ads here (see Ad library page). Meanwhile, open the libraries directly:</p>${adLinksHTML(r.links)}`;
  if (r.error) return `<h3>Meta ads</h3><p class="err">${esc(r.error)}</p>${adLinksHTML(r.links)}`;
  const s = r.summary;
  return `<h3>Meta ads · EU/UK</h3>
    <div class="grid g3"><div><div class="kicker">Active ads</div><div style="font-size:22px;font-weight:700">${s.total}</div></div>
    <div><div class="kicker">EU reach</div><div style="font-size:22px;font-weight:700">${fmtNum(s.euReach)}</div></div>
    <div><div class="kicker">Spend guess</div><div style="font-size:22px;font-weight:700">${s.spendGuessEUR ? '€' + fmtNum(s.spendGuessEUR.mid) : '–'}</div></div></div>
    <div class="list" style="margin-top:10px">${s.longestRunning.slice(0, 3).map((a) => `<div class="item"><div class="s">${a.daysRunning}d running · ${esc(a.page)}</div><div style="font-size:13px">${esc(a.body.slice(0, 140))}</div></div>`).join('')}</div>
    <p style="margin-top:8px"><a href="#/ads?q=${encodeURIComponent(q)}">See all ads →</a></p>${adLinksHTML(r.links)}`;
}

// ---------- Ad library ----------
async function viewAds(_, q) {
  const term = q.q || '';
  view.innerHTML = `
    <div class="view-head"><div><h1>Ad library</h1><p>Meta ads (Facebook, Instagram, Messenger, Audience Network) via the official API. Commercial ads are only visible if they ran in the EU or UK.</p></div></div>
    <form id="adForm" class="controls" style="margin-bottom:16px"><input class="input" name="q" placeholder="Brand or keyword" value="${esc(term)}" style="min-width:260px">
      <select name="status"><option value="ACTIVE">Active now</option><option value="ALL" ${q.status === 'ALL' ? 'selected' : ''}>Active + ended</option></select><button class="primary">Search ads</button></form>
    <div id="adRes">${term ? loading('Querying the Meta Ad Library…') : ''}</div>`;
  $('#adForm').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); go(`#/ads?q=${encodeURIComponent(f.get('q'))}&status=${f.get('status')}`); };
  const r = await api(`/api/ads?q=${encodeURIComponent(term)}&status=${q.status || 'ACTIVE'}`);
  const el = $('#adRes');
  if (!r.configured) {
    el.innerHTML = `<div class="card"><h3>Connect the Meta Ad Library API (free)</h3>
      <ol class="muted" style="padding-left:18px;margin:8px 0 0;display:flex;flex-direction:column;gap:6px">
        <li>Confirm your identity at <a href="https://www.facebook.com/ID" target="_blank" rel="noopener">facebook.com/ID</a> (government ID; approval usually takes a few days).</li>
        <li>Create an app at <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com</a>. No App Review needed.</li>
        <li>Generate a user token in the Graph API Explorer, then exchange it for a long-lived token (~60 days).</li>
        <li>Start the server with <span class="mono">META_TOKEN=… npm start</span>. Optional: <span class="mono">META_COUNTRIES=DE,FR,GB</span>.</li></ol>
      <p class="muted" style="margin-top:12px">Until then, these open the official libraries${term ? ` for “${esc(term)}”` : ''}:</p>${adLinksHTML(r.links)}</div>`;
    return;
  }
  if (!term) { el.innerHTML = '<div class="empty">Search a brand or keyword.</div>'; return; }
  if (r.error) { el.innerHTML = `<div class="banner warn">${esc(r.error)}</div>${adLinksHTML(r.links)}`; return; }
  const s = r.summary;
  el.innerHTML = `
    ${r.demo ? '' : `<div class="banner">Countries queried: ${esc(r.countries.join(', '))}. Spend is a guess: ${esc(s.spendMethod)}</div>`}
    <div class="grid g4"><div class="card kpi"><div class="kicker">Ads</div><div class="v">${s.total}</div></div>
      <div class="card kpi"><div class="kicker">Advertisers</div><div class="v">${s.advertisers.length}</div></div>
      <div class="card kpi"><div class="kicker">EU/UK reach</div><div class="v">${fmtNum(s.euReach)}</div></div>
      <div class="card kpi hero"><div class="kicker">Spend guess (lifetime)</div><div class="v">${s.spendGuessEUR ? '€' + fmtNum(s.spendGuessEUR.mid) : '–'}</div><div class="r">${s.spendGuessEUR ? '€' + fmtNum(s.spendGuessEUR.low) + ' – €' + fmtNum(s.spendGuessEUR.high) : ''}</div></div></div>
    <div class="section"><h2>Advertisers</h2><div class="table-wrap"><table><thead><tr><th>Page</th><th class="num">Ads</th><th class="num">EU reach</th><th class="num">Longest run</th></tr></thead><tbody>
      ${s.advertisers.map((p) => `<tr><td>${esc(p.page)}</td><td class="num">${p.ads}</td><td class="num">${fmtNum(p.reach)}</td><td class="num">${p.longest}d</td></tr>`).join('')}</tbody></table></div></div>
    <div class="section"><h2>Ads <span class="pill">longest running first</span></h2><div class="grid g3">
      ${r.ads.slice().sort((x, y) => (y.daysRunning || 0) - (x.daysRunning || 0)).map((a) => `<div class="card adcard">
        <div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(a.page)}</b><span class="pill ${a.daysRunning >= 30 ? 'high' : ''}">${a.daysRunning}d</span></div>
        <div class="body">${esc(a.body)}</div>${a.title ? `<div class="muted">${esc(a.title)}</div>` : ''}
        <div class="s muted" style="font-size:12px">${esc(a.platforms.join(', '))}${a.reach ? ` · reach ${fmtNum(a.reach)}` : ''}${a.variants > 1 ? ` · ${a.variants} variants` : ''}</div>
        <a href="${esc(a.snapshot)}" target="_blank" rel="noopener" style="font-size:13px">View creative ↗</a></div>`).join('')}
    </div></div>${adLinksHTML(r.links)}
    <p class="dim" style="margin-top:12px;font-size:12px">Long-running ads are the usual “winning ad” signal: advertisers stop paying for ads that don't convert.</p>`;
}

// ---------- Brand ----------
async function viewBrand(_, q) {
  const name = q.name || '';
  const website = q.website || '';
  view.innerHTML = `
    <div class="view-head"><div><h1>Brand lookup</h1><p>A brand's apps, social accounts, latest posts and ads in one place.</p></div></div>
    <form id="bf" class="controls" style="margin-bottom:16px"><input class="input" name="name" placeholder="Brand or developer name" value="${esc(name)}" style="min-width:220px">
      <input class="input" name="website" placeholder="Website (finds socials)" value="${esc(website)}" style="min-width:220px">
      <input class="input" name="ig" placeholder="Instagram handle (optional)" value="${esc(q.ig || '')}" style="min-width:180px"><button class="primary">Look up</button></form>
    <div id="br">${name ? '' : '<div class="empty">Enter a brand. The website is optional but needed to find social accounts.</div>'}</div>`;
  $('#bf').onsubmit = (e) => { e.preventDefault(); const f = new FormData(e.target); go(`#/brand?name=${encodeURIComponent(f.get('name'))}&website=${encodeURIComponent(f.get('website'))}&ig=${encodeURIComponent(f.get('ig'))}`); };
  if (!name) return;
  const br = $('#br');
  br.innerHTML = `<div id="bb">${loading('Reading website, socials and ads…')}</div><div class="section"><h2>Apps</h2><div id="bapps">${loading()}</div></div>`;
  renderBrandBits($('#bb'), { name, adQuery: name, website, ig: q.ig });
  const reqs = [];
  if (q.iosDev) reqs.push(api(`/api/developer/ios/${q.iosDev}`).then((r) => r.apps));
  if (q.playDev) reqs.push(api(`/api/developer/android/${encodeURIComponent(q.playDev)}`).then((r) => r.apps));
  if (!reqs.length) reqs.push(api(`/api/search?q=${encodeURIComponent(name)}`).then((r) => [...r.ios, ...r.android].filter((a) => (a.developer || '').toLowerCase().includes(name.toLowerCase().split(' ')[0]))));
  const apps = (await Promise.all(reqs.map((p) => p.catch(() => [])))).flat();
  const el = $('#bapps');
  if (!el) return;
  el.innerHTML = apps.length ? '' : '<div class="empty">No apps matched this developer name. Try the exact developer name from the store.</div>';
  if (apps.length) {
    let sort = 'rev', dir = -1;
    const draw = () => { el.innerHTML = ''; el.append(appTable(apps, { sortKey: sort, dir, showRank: false, onSort: (k) => { dir = sort === k ? -dir : -1; sort = k; draw(); } })); };
    draw();
  }
}

// ---------- Verified MRR (TrustMRR) + calibration ----------
async function viewVerified(_, q = {}) {
  view.innerHTML = `<div class="view-head"><div><h1>Verified MRR</h1><p>Payment-provider-verified revenue from TrustMRR. App Store entries are compared with this tool's estimate.</p></div></div><div id="vtop"></div><div id="vr">${loading()}</div>`;
  const qs = new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)));
  const { startups, source, status, categories } = await api(`/api/verified?${qs}`);
  const top = $('#vtop');
  if (source === 'api') {
    top.innerHTML = `<form id="vf" class="controls" style="margin-bottom:12px">
      <input class="input" name="q" placeholder="Search name, site, description" value="${esc(q.q || '')}" style="min-width:220px">
      <select name="category"><option value="">All categories</option>${categories.map((c) => `<option value="${esc(c.category)}" ${c.category === q.category ? 'selected' : ''}>${esc(c.category)} (${c.n})</option>`).join('')}</select>
      <label class="muted"><input type="checkbox" name="appsOnly" value="1" ${q.appsOnly === '1' ? 'checked' : ''}> Mobile apps only</label>
      <button class="primary">Filter</button><span class="muted">${fmtNum(status.count)} startups synced · ${status.running ? `syncing (${esc(status.progress || '')})` : `last sync ${status.lastSync ? ago(status.lastSync) : 'never'}`}</span>
      <button type="button" class="ghost" id="vsync">Sync now</button></form>`;
    $('#vf').onsubmit = (e) => { e.preventDefault(); const f = Object.fromEntries([...new FormData(e.target)].filter(([, v]) => v)); go(`#/verified?${new URLSearchParams(f)}`); };
    $('#vsync').onclick = async () => { await api('/api/verified/sync', { method: 'POST' }).catch((e) => alert(e.message)); cache.clear(); route(true); };
  } else if (source === 'discovery') {
    top.innerHTML = `<div class="banner warn">${status.configured ? `Full sync in progress (${esc(status.progress || 'starting')}); showing the free 50-startup feed meanwhile.` : `Showing TrustMRR's free 50-startup feed. Add <span class="mono">TRUSTMRR_API_KEY</span> (from their developer dashboard) to sync every startup in the background.`}</div>`;
  }
  const rows = startups.map((s) => ({ ...s, e: s.app ? est(s.app) : null }));
  const pairs = rows.filter((r) => r.e && r.e.revenue.mrr?.mid > 0 && r.revenue?.mrr > 0);
  const ratios = pairs.map((r) => r.revenue.mrr / r.e.revenue.mrr.mid).sort((a, b) => a - b);
  const med = ratios.length ? ratios[Math.floor(ratios.length / 2)] : null;
  const inRange = pairs.filter((r) => r.revenue.mrr >= r.e.revenue.mrr.low && r.revenue.mrr <= r.e.revenue.mrr.high).length;
  $('#vr').innerHTML = `
    <div class="grid g3"><div class="card kpi"><div class="kicker">App Store entries matched</div><div class="v">${pairs.length}</div><div class="r">of ${rows.length} startups</div></div>
      <div class="card kpi"><div class="kicker">Real MRR inside our range</div><div class="v">${pairs.length ? Math.round((inRange / pairs.length) * 100) + '%' : '–'}</div><div class="r">${inRange} of ${pairs.length}</div></div>
      <div class="card kpi hero"><div class="kicker">Median real ÷ estimate</div><div class="v">${med ? med.toFixed(2) + '×' : '–'}</div><div class="r">${med ? (med > 1 ? 'We underestimate' : 'We overestimate') : 'Not enough matches'}</div></div></div>
    ${med && pairs.length >= 3 ? `<div class="card" style="margin-top:12px;display:flex;gap:12px;align-items:center;flex-wrap:wrap"><p class="muted" style="flex:1;min-width:240px">Scale the download→paying conversion by ${med.toFixed(2)}× so the median estimate matches verified MRR. Small sample, skewed to indie apps that chose to publish revenue; treat it as a nudge, not truth.</p><button class="primary" id="cal">Apply calibration</button></div>` : ''}
    <div class="section"><div class="table-wrap"><table><thead><tr><th>Startup</th><th>Category</th><th>Provider</th><th class="num">Verified MRR</th><th class="num">Last 30 days</th><th class="num">MRR growth</th><th class="num">Our MRR est.</th><th class="num">Real ÷ est.</th></tr></thead><tbody>
    ${rows.sort((a, b) => (b.revenue?.mrr || 0) - (a.revenue?.mrr || 0)).map((r) => `<tr ${r.app ? `data-href="#/app/ios/${r.app.id}"` : ''}>
      <td><div class="appcell">${r.app ? icon(r.app) : `<div class="ico">${esc((r.name || '?')[0])}</div>`}<div><b>${esc(r.name)}</b><small>${esc(r.list)}${r.app ? ' · App Store' : ''}</small></div></div></td>
      <td class="muted">${esc(r.category || '')}</td><td class="muted">${esc(r.paymentProvider || '')}</td>
      <td class="num">${fmtMoney(r.revenue?.mrr)}</td><td class="num">${fmtMoney(r.revenue?.last30Days)}</td>
      <td class="num">${r.growthMRR30d != null ? Math.round(r.growthMRR30d) + '%' : r.growth30d != null ? Math.round(r.growth30d) + '%' : '–'}</td>
      <td class="num">${r.e?.revenue.mrr ? fmtMoney(r.e.revenue.mrr.mid) + `<span class="range">${fmtRange(r.e.revenue.mrr, fmtMoney)}</span>` : '–'}</td>
      <td class="num">${r.e?.revenue.mrr?.mid ? (r.revenue.mrr / r.e.revenue.mrr.mid).toFixed(2) + '×' : '–'}</td></tr>`).join('')}
    </tbody></table></div></div>
    <p class="dim" style="margin-top:10px;font-size:12px">Source: trustmrr.com public discovery feed. Startup names and descriptions are user-provided.</p>`;
  $('#vr').querySelectorAll('tr[data-href]').forEach((tr) => (tr.onclick = () => go(tr.dataset.href)));
  const cal = $('#cal');
  if (cal) cal.onclick = () => {
    const f = Math.min(10, Math.max(0.1, med));
    A.payConversion = A.payConversion.map((x) => +(x * f).toFixed(4));
    ls.set('assumptions', A);
    route(true);
  };
}

// ---------- Tracked ----------
async function viewTracked() {
  view.innerHTML = `<div class="view-head"><div><h1>Tracked apps</h1><p>A snapshot of each app is saved daily while the server runs (or via <span class="mono">npm run snapshot</span> on a cron). Real deltas beat every model.</p></div></div><div id="tr">${loading()}</div>`;
  const { tracked } = await api('/api/tracked?_=' + Date.now());
  const el = $('#tr');
  if (!tracked.length) { el.innerHTML = '<div class="empty">Nothing tracked yet. Open an app and press “Track daily”.</div>'; return; }
  el.innerHTML = `<div class="table-wrap"><table><thead><tr><th>App</th><th>Store</th><th class="num">Days of history</th><th class="num">Ratings Δ</th><th class="num">Installs Δ</th><th>Since</th><th></th></tr></thead><tbody>
    ${tracked.map((t) => {
      const h = t.history, f = h[0], l = h[h.length - 1];
      const d = (k) => (f && l && f[k] != null && l[k] != null ? '+' + fmtNum(l[k] - f[k]) : '–');
      return `<tr data-href="#/app/${t.store}/${encodeURIComponent(t.id)}?country=${t.country}"><td><div class="appcell">${icon(t)}<b>${esc(t.name)}</b></div></td><td><span class="pill ${t.store}">${t.store}</span></td><td class="num">${h.length}</td><td class="num">${d('ratingsCount')}</td><td class="num">${d('installs')}</td><td class="muted">${fmtDate(t.addedAt)}</td><td><button class="ghost" data-del="${t.store}|${esc(t.id)}">Remove</button></td></tr>`;
    }).join('')}</tbody></table></div>`;
  el.querySelectorAll('tr[data-href]').forEach((tr) => (tr.onclick = (e) => { if (!e.target.dataset.del) go(tr.dataset.href); }));
  el.querySelectorAll('[data-del]').forEach((b) => (b.onclick = async () => { const [s, i] = b.dataset.del.split('|'); await api(`/api/track/${s}/${encodeURIComponent(i)}`, { method: 'DELETE' }); viewTracked(); }));
}

// ---------- Sources ----------
const SOURCES = [
  ['iTunes Search & Lookup API', 'iOS metadata, price, ratings count, current-version ratings, developer, website', 'Free, no key. ~20 req/min soft limit.', 'https://performance-partners.apple.com/search-api'],
  ['App Store RSS charts', 'Top free / paid / grossing by country and genre (up to 200)', 'Free, no key. Legacy feed; marketing RSS v2 as fallback (no grossing).', 'https://rss.marketingtools.apple.com/'],
  ['App Store review RSS', 'Most recent reviews (up to ~500) → review pace and themes', 'Free, no key.', ''],
  ['App Store web page', 'In-app purchase price list', 'Scraped, fragile: Apple changes markup.', ''],
  ['google-play-scraper (MIT)', 'Play charts, search, details, exact install counter, IAP range, ads flag, reviews, similar apps', 'Free. Unofficial: parses Play pages and can break.', 'https://github.com/facundoolano/google-play-scraper'],
  ['Meta Ad Library API', 'Ads, creatives, start dates, platforms, EU/UK reach', 'Free. Needs identity check + token. Commercial ads only if run in EU/UK; no commercial spend.', 'https://www.facebook.com/ads/library/api/'],
  ['Google / TikTok / LinkedIn ad libraries', 'Ad creatives', 'No free API: links only.', 'https://adstransparency.google.com/'],
  ['Developer website', 'Social account links', 'Scraped from the homepage HTML.', ''],
  ['YouTube channel RSS', 'Latest 15 videos, views', 'Free, no key.', ''],
  ['Bluesky public API', 'Latest posts and engagement', 'Free, no key.', 'https://docs.bsky.app/'],
  ['Hacker News (Algolia API)', 'Mentions and launches', 'Free, no key.', 'https://hn.algolia.com/api'],
  ['Reddit search.json', 'Mentions', 'Best effort; often rate-limited or blocked without OAuth.', ''],
  ['TrustMRR', 'Verified MRR, revenue, growth, customers for every listed startup → calibration ground truth', 'Free 50-startup feed without a key; official API (TRUSTMRR_API_KEY) syncs all, 10 req/min. Website scraping is against their terms.', 'https://trustmrr.com/docs/api'],
  ['AppGoblin App Metrics dataset', '≈5M Play + App Store apps: category, installs, ratings, IAP, ads, dates → the All apps catalog', 'Free (CC BY 4.0, attribution), needs a free account to download. Import with npm run import:appgoblin.', 'https://appgoblin.info/free-app-datasets'],
  ['Instagram Business Discovery API', 'Followers, posts, reels, likes, comments, views of business/creator accounts', 'Free. Needs your own IG professional account + token (IG_USER_ID, IG_TOKEN).', 'https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery'],
  ['Not wired in', 'TikTok posts (Research API is academic-only); Apple Search Ads keyword popularity (needs ASA account); open-app-intel (MIT, Python, rank→downloads curve)', 'See README.', 'https://github.com/Ahad690/open-app-intel'],
];
async function viewSources() {
  view.innerHTML = `<div class="view-head"><div><h1>Sources</h1><p>Everything here comes from free, public sources. What each gives you, and its limits.</p></div></div>
    <div class="table-wrap"><table><thead><tr><th>Source</th><th>What it gives</th><th>Cost / limits</th></tr></thead><tbody>
    ${SOURCES.map(([n, w, c, u]) => `<tr style="cursor:default"><td style="white-space:normal;min-width:180px">${u ? `<a href="${u}" target="_blank" rel="noopener">${esc(n)}</a>` : esc(n)}</td><td style="white-space:normal" class="muted">${esc(w)}</td><td style="white-space:normal" class="muted">${esc(c)}</td></tr>`).join('')}
    </tbody></table></div>
    <div class="section card"><h3>What can't be had for free</h3><p class="muted">Real revenue or downloads for apps that don't publish them, Meta spend for non-political ads, Instagram/TikTok/X post feeds, and panel-based usage data (Sensor Tower, data.ai). Paid tools fill these gaps with consumer panels and private data.</p></div>`;
}

// ---------- Type-ahead search ----------
(() => {
  const input = $('#searchInput');
  const box = $('#suggest');
  let seq = 0, items = [], sel = -1, timer, liveLoading = false;
  const close = () => { box.hidden = true; sel = -1; };
  const href = (a) => (a.kind === 'saas' ? `#/s-item?key=${encodeURIComponent(a.key)}` : a.kind === 'product' ? `#/s-product/${a.id}` : a.kind === 'startup' ? `#/s-startups?q=${encodeURIComponent(a.name)}` : `#/app/${a.store}/${encodeURIComponent(a.id)}`);
  const render = () => {
    if (MODE === 'saas') {
      box.innerHTML = items.length
        ? items.map((a, i) => `<a class="sg ${i === sel ? 'on' : ''}" role="option" href="${href(a)}">${a.icon ? `<img class="ico" src="${esc(a.icon)}" alt="" data-name="${esc(a.name)}">` : research.fav(a.url, a.name)}<span class="tx"><div class="nm">${esc(a.name)}</div><div class="sub">${esc(a.sub || '')}</div></span><span style="text-align:right;flex:none"><span class="pill ${a.kind === 'startup' ? '' : ({ clone: 'high', gap: 'medium', avoid: 'low', strong: 'high', validate: 'medium', reject: 'low' }[a.verdict] || '')}">${a.kind === 'startup' ? 'startup' : a.score != null ? `${a.score} · ${esc(a.verdict || '')}` : esc(a.verdict || '')}</span></span></a>`).join('') + '<div class="sg-foot"><span>↑↓ move · Enter open</span><span>Enter on text: all products</span></div>'
        : '<div class="sg-foot"><span>No SaaS products or startups match.</span><span>Enter: full search</span></div>';
      box.hidden = false;
      return;
    }
    if (!items.length && !liveLoading) {
      box.innerHTML = '<div class="sg-foot"><span>No matches in either store.</span><span>Enter: full search</span></div>';
    } else {
      box.innerHTML = items.map((a, i) => `<a class="sg ${i === sel ? 'on' : ''}" role="option" href="${href(a)}">${icon(a)}
          <span class="tx"><div class="nm">${esc(a.name)}</div><div class="sub">${esc(a.developer || '')}${a.genre ? ' · ' + esc(a.genre) : ''}</div></span>
          <span style="text-align:right;flex:none"><span class="pill ${a.store}">${a.store === 'ios' ? 'App Store' : 'Google Play'}</span><div class="sub">${a.installs ? fmtNum(a.installs) + '+ installs' : a.ratingsCount ? fmtNum(a.ratingsCount) + ' ratings' : ''}</div></span></a>`).join('') +
        `<div class="sg-foot"><span>${liveLoading ? '<span class="spin"></span>Searching both stores…' : '↑↓ move · Enter open'}</span><span>Enter on text: all results</span></div>`;
    }
    box.hidden = false;
  };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) return close();
    timer = setTimeout(async () => {
      const my = ++seq;
      if (MODE === 'saas') {
        research ||= registerResearch({ api, esc, $, go, loading, fmtDate, view, renderBrandBits });
        const r = await api(`/api/saas/suggest?q=${encodeURIComponent(q)}`).catch(() => ({ items: [] }));
        if (my !== seq) return;
        items = r.items; sel = -1; render();
        return;
      }
      liveLoading = true;
      const local = await api(`/api/suggest?q=${encodeURIComponent(q)}`).catch((e) => ({ apps: [], error: e.message }));
      if (local.error) { box.innerHTML = `<div class="sg-foot"><span class="err">${esc(local.error)}</span></div>`; box.hidden = false; return; }
      if (my !== seq) return;
      items = local.apps; sel = -1; render();
      const live = await api(`/api/suggest?q=${encodeURIComponent(q)}&live=1`).catch(() => ({ apps: items }));
      if (my !== seq) return;
      liveLoading = false; items = live.apps; render();
    }, 180);
  });
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(-1, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && sel >= 0) { e.preventDefault(); const a = items[sel]; close(); go(href(a)); }
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('focus', () => { if (items.length && input.value.trim().length >= 2) render(); });
  $('#searchForm').addEventListener('submit', close);
  document.addEventListener('click', (e) => { if (!e.target.closest('.search') || e.target.closest('.sg')) close(); });
  window.addEventListener('hashchange', close);
})();

// ---------- Categories (from the daily crawl) ----------
const catLabel = (st, c) => (c === '' ? 'All apps' : st === 'ios' ? META.iosGenres[c] || c : c.replace(/_/g, ' ').toLowerCase().replace(/^./, (x) => x.toUpperCase()));

function crawlBanner(c) {
  return `<div class="banner ${c.running ? '' : 'warn'}">${c.running ? `<span class="spin"></span>Crawling: ${esc(c.progress || '')}` : `Last crawl: ${c.lastRun ? ago(c.lastRun) : 'never'}${c.progress ? ` (${esc(c.progress)})` : ''}`} · countries ${esc(c.config.countries.join(', '))}
    ${c.running ? '' : '<button class="ghost" id="crawlNow" style="margin-left:8px;padding:4px 10px">Crawl now</button>'}</div>`;
}
function wireCrawl() {
  const b = $('#crawlNow');
  if (b) b.onclick = async () => { await api('/api/crawl', { method: 'POST' }); cache.clear(); setTimeout(() => route(true), 800); };
}

async function viewInsights(_, q) {
  const S = { store: 'ios', country: 'us', category: '*', chart: 'grossing', ...ls.get('insights', {}), ...q };
  ls.set('insights', { store: S.store, country: S.country, chart: S.chart });
  const set = (k, v) => go(`#/insights?${new URLSearchParams({ ...S, [k]: v, ...(k === 'store' ? { category: '*' } : {}) })}`);
  const cats = S.store === 'ios' ? Object.keys(META.iosGenres).filter(Boolean) : META.playCategories;
  view.innerHTML = `
    <div class="view-head"><div><h1>Categories</h1><p>What's working in each category, from daily crawls of every chart. Rising, new and hidden earners need a week of crawls.</p></div></div>
    <div class="controls" style="margin-bottom:14px">
      <div class="seg" id="ist">${['ios', 'android'].map((x) => `<button data-v="${x}" class="${S.store === x ? 'on' : ''}">${x === 'ios' ? 'App Store' : 'Google Play'}</button>`).join('')}</div>
      <select id="icat"><option value="*" ${S.category === '*' ? 'selected' : ''}>Overview: all categories</option><option value="" ${S.category === '' ? 'selected' : ''}>All apps chart</option>${cats.map((c) => `<option value="${c}" ${S.category === c ? 'selected' : ''}>${esc(catLabel(S.store, c))}</option>`).join('')}</select>
      ${S.category === '*' ? '' : `<div class="seg" id="ich">${['grossing', 'free', 'paid'].map((x) => `<button data-v="${x}" class="${S.chart === x ? 'on' : ''}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}</div>`}
      <select id="icc">${COUNTRIES.map((c) => `<option ${c === S.country ? 'selected' : ''}>${c}</option>`).join('')}</select>
    </div><div id="ins">${loading()}</div>`;
  $('#ist').onclick = (e) => e.target.dataset.v && set('store', e.target.dataset.v);
  $('#icat').onchange = (e) => set('category', e.target.value);
  $('#icc').onchange = (e) => set('country', e.target.value);
  if ($('#ich')) $('#ich').onclick = (e) => e.target.dataset.v && set('chart', e.target.dataset.v);
  const el = $('#ins');

  if (S.category === '*') {
    const r = await api(`/api/insights/overview?store=${S.store}&country=${S.country}`);
    if (!r.day) { el.innerHTML = crawlBanner(r.crawl) + '<div class="empty">No crawl data for this store and country yet. The live Top charts tab works meanwhile.</div>'; wireCrawl(); return; }
    const groups = {};
    for (const row of r.rows) if (row.chart_category !== '') (groups[row.chart_category] ||= []).push(row);
    const stats = Object.entries(groups).map(([cat, rows]) => {
      const apps = rows.filter((x) => x.id).map(fromRow);
      apps.forEach((a) => (a._e = est(a)));
      const rev = apps.reduce((t, a) => t + a._e.revenue.monthly.mid, 0);
      const ratings = apps.map((a) => a.ratingsCount).filter(Boolean).sort((x, y) => x - y);
      const p20 = ratings[Math.floor(ratings.length * 0.2)] || 0;
      return { cat, n: apps.length, rev, top: apps[0], iap: apps.filter((a) => a.offersIAP).length / (apps.length || 1),
        rating: median(apps.map((a) => a.rating).filter(Boolean)), hidden: rows.filter((x) => x.rank <= 30 && x.ratings && x.ratings <= p20).length };
    }).sort((a, b) => b.rev - a.rev);
    el.innerHTML = crawlBanner(r.crawl) + `<p class="muted" style="margin-bottom:10px">Top 50 grossing per category on ${fmtDate(r.day)}. Revenue is the sum of our estimates for those 50 apps: a size signal, not market size.</p>
      <div class="table-wrap"><table><thead><tr><th>Category</th><th>#1 grossing</th><th class="num">Top-50 est. revenue / mo</th><th class="num">With IAP</th><th class="num">Median rating</th><th class="num">Hidden earners</th></tr></thead><tbody>
      ${stats.map((x) => `<tr data-cat="${esc(x.cat)}"><td><b>${esc(catLabel(S.store, x.cat))}</b></td><td><div class="appcell">${x.top ? icon(x.top) + `<div><b>${esc(x.top.name)}</b><small>${esc(x.top.developer || '')}</small></div>` : '–'}</div></td>
        <td class="num">${fmtMoney(x.rev)}</td><td class="num">${Math.round(x.iap * 100)}%</td><td class="num">${x.rating ? x.rating.toFixed(1) : '–'}</td><td class="num">${x.hidden}</td></tr>`).join('')}
      </tbody></table></div><p class="dim" style="margin-top:8px;font-size:12px">Hidden earners: in the top 30 grossing with ratings in the bottom fifth of that category's top 50.</p>`;
    el.querySelectorAll('tr[data-cat]').forEach((tr) => (tr.onclick = () => set('category', tr.dataset.cat)));
    wireCrawl();
    return;
  }

  const r = await api(`/api/insights?store=${S.store}&country=${S.country}&chart=${S.chart}&category=${encodeURIComponent(S.category)}`);
  if (!r.day) { el.innerHTML = crawlBanner(r.crawl) + '<div class="empty">This chart hasn\'t been crawled yet.</div>'; wireCrawl(); return; }
  const apps = r.rows.map((row) => {
    const a = row.name ? fromRow(row) : { store: S.store, id: row.id, name: row.id, ratingsCount: 0, iapPrices: [] };
    a.store = S.store; a.id = row.id; a.rank = row.rank;
    a.rankDelta = row.prev_rank ? row.prev_rank - row.rank : 0;
    a.isNew = r.days > 1 && row.first_day > r.firstDay && !row.prev_rank;
    return a;
  });
  apps.forEach((a) => (a._e = est(a)));
  const rising = apps.filter((a) => a.rankDelta >= 5).sort((x, y) => y.rankDelta - x.rankDelta).slice(0, 8);
  const fresh = apps.filter((a) => a.isNew).slice(0, 8);
  const ratings = apps.map((a) => a.ratingsCount).filter(Boolean).sort((x, y) => x - y);
  const p20 = ratings[Math.floor(ratings.length * 0.2)] || 0;
  const hidden = S.chart === 'grossing' ? apps.filter((a) => a.rank <= 50 && a.ratingsCount && a.ratingsCount <= p20).slice(0, 8) : [];
  const mini = (list, why) => list.length ? `<div class="list">${list.map((a) => `<a class="sg" href="#/app/${a.store}/${encodeURIComponent(a.id)}">${icon(a)}<span class="tx"><div class="nm">${esc(a.name)}</div><div class="sub">${why(a)}</div></span></a>`).join('')}</div>` : '<p class="muted">Nothing yet. Needs more days of crawls.</p>';
  el.innerHTML = crawlBanner(r.crawl) + `
    <div class="grid g4"><div class="card kpi"><div class="kicker">Apps in chart</div><div class="v">${apps.length}</div><div class="r">${fmtDate(r.day)}</div></div>
      <div class="card kpi"><div class="kicker">History</div><div class="v">${r.days}d</div><div class="r">compared with ${r.prevDay ? fmtDate(r.prevDay) : '–'}</div></div>
      <div class="card kpi"><div class="kicker">Rising (▲5+)</div><div class="v">${rising.length}</div></div>
      <div class="card kpi"><div class="kicker">New in chart</div><div class="v">${apps.filter((a) => a.isNew).length}</div></div></div>
    <div class="grid g3 section">
      <div class="card"><h3>Rising fastest</h3>${mini(rising, (a) => `▲${a.rankDelta} to #${a.rank} · ${fmtMoney(a._e.revenue.monthly.mid)}/mo est.`)}</div>
      <div class="card"><h3>New in this chart</h3>${mini(fresh, (a) => `#${a.rank} · ${a.ratingsCount ? fmtNum(a.ratingsCount) + ' ratings' : 'new'}`)}</div>
      <div class="card"><h3>Hidden earners</h3>${S.chart === 'grossing' ? mini(hidden, (a) => `Grossing #${a.rank} with only ${fmtNum(a.ratingsCount)} ratings`) : '<p class="muted">Switch to the Grossing chart.</p>'}</div>
    </div>
    <div class="section"><h2>${esc(catLabel(S.store, S.category))} · ${S.chart}</h2><div id="ichart"></div></div>`;
  let sort = 'rank', dir = 1;
  const draw = () => { const t = $('#ichart'); t.innerHTML = ''; t.append(appTable(apps, { sortKey: sort, dir, country: S.country, onSort: (k) => { dir = sort === k ? -dir : k === 'rank' ? 1 : -1; sort = k; draw(); } })); };
  draw();
  wireCrawl();
}

// ---------- Worth building (opportunities) ----------
const PARTS = [['demand', 'Demand', 'Grossing rank, revenue estimate, audience'], ['weakness', 'Weakness', 'Low rating, stale updates, ads'], ['competition', 'Open field', 'Few strong rivals in category top 50'], ['buildability', 'Buildable', 'No network effects, licensing, regulation, big tech'], ['monetization', 'Pays', 'IAP / paid / ads']];
const REVIEW_ANGLE = {
  'Pricing / paywall': (p) => `Pricing is a top complaint (${p}% of reviews): undercut with a cheaper plan, one-time unlock or a generous free tier.`,
  Ads: (p) => `Ad complaints (${p}%): ad-free is a selling point by itself.`,
  'Bugs / crashes': (p) => `Bugs and crashes (${p}%): reliability alone wins switchers.`,
  'Missing features': (p) => `Feature requests (${p}%): build what they keep asking for.`,
  'Login / account': (p) => `Account/login friction (${p}%): let people start without signing up.`,
};

function oppCard(a, country) {
  const sc = a.score >= 70 ? 'high' : a.score >= 55 ? 'medium' : 'low';
  return `<div class="card opp" data-key="${a.store}|${esc(a.id)}">
    <div style="display:flex;gap:12px;align-items:flex-start">${icon(a)}
      <div style="min-width:0;flex:1"><a class="t" href="#/app/${a.store}/${encodeURIComponent(a.id)}?country=${country}" style="font-weight:700;color:var(--text)">${esc(a.name)}</a>
        <div class="muted" style="font-size:12px">${esc(a.developer)} · ${esc(a.genre || '')}</div>
        <div style="margin-top:4px"><span class="pill ${a.store}">${a.store === 'ios' ? 'App Store' : 'Google Play'}</span></div></div>
      <div class="score ${sc}" title="Opportunity score">${a.score}</div></div>
    <div class="parts">${PARTS.map(([k, l, tip]) => `<div class="part" title="${esc(tip)}"><span>${l}</span><span class="track"><i style="width:${a.parts[k]}%"></i></span><span>${a.parts[k]}</span></div>`).join('')}</div>
    <div class="facts">
      <div><div class="kicker">Rev / mo</div><b>${fmtMoney(a.est.revenue.mid)}</b><div class="dim" style="font-size:11px">${fmtRange(a.est.revenue, fmtMoney)}</div></div>
      <div><div class="kicker">Grossing</div><b>${a.grossingRank ? '#' + a.grossingRank : '–'}</b></div>
      <div><div class="kicker">Rating</div><b>${a.rating ? '★' + a.rating.toFixed(1) : '–'}</b><div class="dim" style="font-size:11px">${fmtNum(a.ratingsCount)}</div></div>
      <div><div class="kicker">Updated</div><b>${a.daysStale != null ? ago(a.updated) : '–'}</b></div>
    </div>
    <div class="kicker" style="margin-top:12px">How to beat it</div>
    <ul class="angles">${a.angles.map((x) => `<li>${esc(x.t)}</li>`).join('')}</ul>
    ${a.cautions.length ? `<p class="err" style="font-size:12px;margin-top:6px">⚠ ${a.cautions.map(esc).join(' · ')}</p>` : ''}
    <div class="rv"></div>
    <div class="controls" style="margin-top:10px"><button class="ghost" data-analyze>Analyze reviews</button><a class="chip" href="#/app/${a.store}/${encodeURIComponent(a.id)}?country=${country}">Open app →</a><a class="chip" href="#/brand?name=${encodeURIComponent(a.developer || a.name)}">Ads & socials →</a></div>
  </div>`;
}

async function analyzeReviews(card, a, country) {
  const box = $('.rv', card);
  box.innerHTML = loading('Reading reviews…');
  try {
    const { reviews } = await api(`/api/reviews/${a.store}/${encodeURIComponent(a.id)}?country=${country}`);
    const n = reviews.length || 1;
    const neg = reviews.filter((r) => r.score <= 2);
    const themes = THEMES.filter(([k]) => REVIEW_ANGLE[k]).map(([k, re]) => [k, neg.filter((r) => re.test(`${r.title || ''} ${r.text || ''}`)).length])
      .filter(([, c]) => c >= 3).sort((x, y) => y[1] - x[1]).slice(0, 3);
    const ex = neg.find((r) => (r.text || '').length > 60);
    box.innerHTML = `<div class="kicker" style="margin-top:12px">From ${reviews.length} recent reviews</div>
      <p class="muted" style="font-size:13px;margin-top:4px">${Math.round((neg.length / n) * 100)}% are 1–2★.</p>
      <ul class="angles">${themes.map(([k, c]) => `<li>${esc(REVIEW_ANGLE[k](Math.round((c / n) * 100)))}</li>`).join('') || '<li>No dominant complaint: users are mostly satisfied, so differentiate on segment or price.</li>'}</ul>
      ${ex ? `<p class="dim" style="font-size:12px;margin-top:6px">“${esc(ex.text.slice(0, 200))}”</p>` : ''}`;
  } catch (e) {
    box.innerHTML = `<p class="err" style="font-size:12px">${esc(e.message)}</p>`;
  }
}

async function viewOpps(_, q) {
  const S = { store: 'both', country: 'us', tab: 'top', category: '', hard: '0', big: '0', ...ls.get('opps', {}), ...q };
  ls.set('opps', { store: S.store, country: S.country, hard: S.hard, big: S.big });
  const set = (patch) => go(`#/opps?${new URLSearchParams({ ...S, ...patch })}`);
  view.innerHTML = `<div class="view-head"><div><h1>Worth building</h1><p>Apps with proven demand and a beatable incumbent, in niches a small team can enter. Build a better alternative, not a copy.</p></div></div>
    <div class="controls" style="margin-bottom:14px">
      <div class="seg" id="ost">${[['both', 'Both stores'], ['ios', 'App Store'], ['android', 'Google Play']].map(([v, l]) => `<button data-v="${v}" class="${S.store === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="seg" id="otab">${[['top', 'Top picks'], ['cat', 'Best per category']].map(([v, l]) => `<button data-v="${v}" class="${S.tab === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <select id="occ">${COUNTRIES.map((c) => `<option ${c === S.country ? 'selected' : ''}>${c}</option>`).join('')}</select>
      <select id="ocat"><option value="">All categories</option></select>
      <label class="muted"><input type="checkbox" id="ohard" ${S.hard === '1' ? 'checked' : ''}> Include hard niches</label>
      <label class="muted"><input type="checkbox" id="obig" ${S.big === '1' ? 'checked' : ''}> Include big publishers</label>
    </div><div id="ores">${loading('Scoring every app in the latest crawl…')}</div>`;
  $('#ost').onclick = (e) => e.target.dataset.v && set({ store: e.target.dataset.v, category: '' });
  $('#otab').onclick = (e) => e.target.dataset.v && set({ tab: e.target.dataset.v });
  $('#occ').onchange = (e) => set({ country: e.target.value });
  $('#ohard').onchange = (e) => set({ hard: e.target.checked ? '1' : '0' });
  $('#obig').onchange = (e) => set({ big: e.target.checked ? '1' : '0' });
  const r = await api(`/api/opportunities?store=${S.store}&country=${S.country}`);
  const el = $('#ores');
  if (!r.day) { el.innerHTML = crawlBanner(r.crawl) + '<div class="empty">No crawl data yet. Opportunities are scored from the daily category crawl; start one above.</div>'; wireCrawl(); return; }
  let apps = r.apps.filter((a) => (S.hard === '1' || a.parts.buildability > 20) && (S.big === '1' || !a.cautions.some((c) => /Big-tech|Large publisher/.test(c))));
  const cats = [...new Set(apps.map((a) => a.genre).filter(Boolean))].sort();
  $('#ocat').innerHTML = `<option value="">All categories</option>${cats.map((c) => `<option ${c === S.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}`;
  $('#ocat').onchange = (e) => set({ category: e.target.value });
  if (S.category) apps = apps.filter((a) => a.genre === S.category);
  const head = `<p class="muted" style="margin-bottom:12px">${apps.length} candidates from the ${fmtDate(r.day)} crawl (${r.count} passed the demand gate before filters). Score = 30% demand · 25% weakness · 15% open field · 20% buildable · 10% pays. Revenue figures are estimates; grossing rank is the stronger signal.</p>`;
  if (!apps.length) { el.innerHTML = head + '<div class="empty">No candidates with these filters.</div>'; return; }
  let html;
  if (S.tab === 'cat' && !S.category) {
    const groups = {};
    for (const a of apps) (groups[a.genre || 'Other'] ||= []).push(a);
    html = Object.entries(groups).sort((x, y) => y[1][0].score - x[1][0].score)
      .map(([c, list]) => `<div class="section"><h2>${esc(c)} <span class="pill">${list.length} candidates</span> <a href="#/opps?${new URLSearchParams({ ...S, category: c, tab: 'top' })}" style="font-size:13px;font-weight:500">See all →</a></h2><div class="grid g3">${list.slice(0, 3).map((a) => oppCard(a, S.country)).join('')}</div></div>`).join('');
  } else {
    html = `<div class="grid g3" id="oppGrid"></div><div class="controls" style="justify-content:center;margin-top:16px"><span class="muted" id="oppCount"></span><button class="ghost" id="oppMore" data-auto>Load more</button></div>`;
  }
  el.innerHTML = head + html;
  const byKey = new Map(apps.map((a) => [`${a.store}|${a.id}`, a]));
  const wire = (root) => root.querySelectorAll('[data-analyze]:not([data-wired])').forEach((b) => { b.dataset.wired = '1'; b.onclick = () => { const card = b.closest('.opp'); b.disabled = true; analyzeReviews(card, byKey.get(card.dataset.key), S.country); }; });
  const grid = $('#oppGrid');
  if (grid) {
    // Render 30 at a time; "Show 30 more" (or scrolling to the end) appends the next batch.
    let shown = 0;
    const more = () => {
      const next = apps.slice(shown, shown + 30);
      grid.insertAdjacentHTML('beforeend', next.map((a) => oppCard(a, S.country)).join(''));
      shown += next.length;
      wire(grid);
      $('#oppCount').textContent = `Showing ${shown} of ${apps.length}`;
      const mb = $('#oppMore');
      mb.hidden = shown >= apps.length;
      mb.classList.remove('loading'); mb.textContent = 'Load more';
      // Re-arm the observer: if the button is still in range after appending, load again.
      autoIO.unobserve(mb); autoIO.observe(mb);
    };
    $('#oppMore').onclick = more;
    more();
  } else wire(el);
}

// Infinite lists: any <button data-auto> is clicked automatically once it comes within ~1.5 screens of the
// viewport, so long lists keep loading as you scroll. The button stays as a manual fallback.
const autoIO = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const b = e.target;
    if (!e.isIntersecting || b.disabled || b.hidden || !b.isConnected || b.classList.contains('loading')) continue;
    b.classList.add('loading');
    b.textContent = 'Loading…';
    b.click();
  }
}, { rootMargin: '1500px 0px' });
new MutationObserver(() => {
  document.querySelectorAll('button[data-auto]:not([data-io])').forEach((b) => { b.dataset.io = '1'; autoIO.observe(b); });
}).observe(document.body, { childList: true, subtree: true });

// Broken store icons fall back to the letter tile.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.classList.contains('ico')) return;
  const d = document.createElement('div');
  d.className = img.className;
  d.textContent = (img.dataset.name || '?')[0];
  img.replaceWith(d);
}, true);

// ---------- boot ----------
(async () => {
  META = await api('/api/meta');
  if (META.mock) $('#banner').innerHTML = '<div class="banner warn">Demo data: fictional apps, no network calls. Run <span class="mono">npm start</span> for live data.</div>';
  route();
})();
