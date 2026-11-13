// SaaS mode + App ideas: views over the Idea Hunter research export (data/idea-hunter/).
// Registered into app.js's router via registerResearch(ctx).

export function registerResearch(ctx) {
  const { api, esc, $, go, loading, fmtDate, view, renderBrandBits } = ctx;

  const fav = (url, name, lg) => {
    let host = '';
    try { host = new URL(url).hostname; } catch {}
    const cls = `ico${lg ? ' lg' : ''}`;
    return host
      ? `<img class="${cls}" src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128" alt="" loading="lazy" data-name="${esc(name || '?')}">`
      : `<div class="${cls}">${esc((name || '?')[0])}</div>`;
  };
  const pill = (t, cls = '') => (t ? `<span class="pill ${cls}">${esc(t)}</span>` : '');
  const VERDICT = { clone: 'high', gap: 'medium', watch: '', avoid: 'low', strong: 'high', validate: 'medium', reject: 'low', pass: 'high', miss: 'low' };
  const vpill = (v) => pill(v === 'clone' ? 'worth cloning' : v, VERDICT[v] ?? '');
  const ext = (url, label) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(label || 'source')} ↗</a>` : '');
  const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const qs = (o) => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null)));
  const sel = (name, opts, cur) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const bars = (rows) => `<div class="parts">${rows.map(([l, v, max = 5, tip = '']) => `<div class="part" title="${esc(tip)}"><span>${esc(l)}</span><span class="track"><i style="width:${Math.max(0, Math.min(100, (v / max) * 100))}%"></i></span><span>${v ?? '–'}</span></div>`).join('')}</div>`;
  const list = (s) => String(s || '').split(/\s*;\s*/).filter(Boolean);
  const missing = () => `<div class="empty">No research data found. Copy your Idea Hunter export's <span class="mono">data</span> folder contents into <span class="mono">data/idea-hunter/</span> (it should contain <span class="mono">saas_database/</span>, <span class="mono">saas_track/</span>, <span class="mono">startups/</span>…).</div>`;

  // Live filter forms: update the URL without re-rendering the whole view, then refresh results.
  function liveForm(form, state, refresh, route) {
    let t;
    const apply = (delay) => {
      clearTimeout(t);
      t = setTimeout(() => {
        for (const [k, v] of new FormData(form)) state[k] = v;
        form.querySelectorAll('input[type=checkbox]').forEach((c) => (state[c.name] = c.checked ? c.value : ''));
        state.page = 1;
        history.replaceState(null, '', `#/${route}?${qs(state)}`);
        refresh();
      }, delay);
    };
    form.onsubmit = (e) => e.preventDefault();
    form.addEventListener('input', (e) => apply(e.target.type === 'search' || e.target.type === 'text' ? 250 : 0));
  }

  function complaintsHTML(cs, max = 99) {
    if (!cs?.length) return '<p class="dim" style="font-size:12px">No sourced complaints (review pages blocked or none exist): the verdict reflects the business model only.</p>';
    return `<ul class="angles">${cs.slice(0, max).map((c) => `<li>${esc(c.text)} <span class="dim" style="font-size:12px">${[c.date, c.count].filter(Boolean).map(esc).join(' · ')}${c.src ? ` · ${ext(c.src, host(c.src) || 'source')}` : ''}</span></li>`).join('')}${cs.length > max ? `<li class="dim">+${cs.length - max} more on the product page</li>` : ''}</ul>`;
  }

  function productCard(p) {
    return `<div class="card opp">
      <div style="display:flex;gap:12px;align-items:flex-start">${fav(p.url, p.name)}
        <div style="min-width:0;flex:1"><a class="t" href="#/s-product/${p._id}" style="font-weight:700;color:var(--text)">${esc(p.name)}</a>
          <div class="muted" style="font-size:12px">${esc(p.cat)}</div>
          <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${vpill(p.verdict)}${pill(p.tier)}${p.evidence === 'sourced' ? pill(`${p._n} complaints`, '') : pill('no reviews', '')}</div></div></div>
      <p class="muted" style="font-size:13px;margin-top:10px">${esc(p.desc)}${p.customer ? ` · <span class="dim">for ${esc(p.customer)}</span>` : ''}</p>
      <div class="facts">
        <div><div class="kicker">Price</div><b>${esc(p.price || '–')}</b></div>
        <div><div class="kicker">Revenue</div><b style="font-size:12px">${esc(p.revenue || '–')}</b></div>
        <div><div class="kicker">MVP</div><b>${p.build ? `${p.build} wk` : '–'}</b></div>
        <div><div class="kicker">Model</div><b style="font-size:12px">${esc(p.model || '–')}</b></div>
      </div>
      ${p.why ? `<div class="kicker" style="margin-top:12px">Why</div><p style="font-size:13px;margin-top:4px">${esc(p.why)}</p>` : ''}
      ${p.idea ? `<div class="kicker" style="margin-top:10px">The play</div><p style="font-size:13px;margin-top:4px">${esc(p.idea)}</p>` : ''}
      <div class="kicker" style="margin-top:10px">What customers complain about</div>${complaintsHTML(p.complaints, 3)}
      <div class="controls" style="margin-top:12px"><a class="chip" href="#/s-product/${p._id}">Details →</a>${p.url ? `<a class="chip" href="${esc(p.url)}" target="_blank" rel="noopener">Website ↗</a>` : ''}<a class="chip" href="#/brand?${qs({ name: p.name, website: p.url })}">Ads & socials →</a></div>
    </div>`;
  }

  // ---------- Worth cloning / Products ----------
  async function viewProducts(parts, q, mode) {
    const isClone = mode === 'clone';
    const route = isClone ? 's-research' : 's-products';
    const S = isClone ? { verdict: 'clone,gap', evidence: 'sourced', sort: 'best', ...q } : { sort: 'best', ...q };
    const f = await api('/api/saas/facets');
    if (!f.categories.length) { view.innerHTML = missing(); return; }
    view.innerHTML = `
      <div class="view-head"><div><h1>${isClone ? 'Research: worth cloning' : 'Research database'}</h1><p>${isClone ? 'Products that make money and whose customers complain about something fixable (clone), or that leave a sub-need open for a micro-SaaS (gap). Review-backed first.' : 'Every product in your SaaS Database, with verdicts and customer complaints.'}</p></div></div>
      <form id="pf" class="controls" style="margin-bottom:14px">
        <input class="input" type="search" name="q" placeholder="Search products, complaints, ideas…" value="${esc(S.q || '')}" style="min-width:240px">
        <select name="cat"><option value="">All categories</option>${f.categories.map(([c, n]) => `<option value="${esc(c)}" ${c === S.cat ? 'selected' : ''}>${esc(c)} (${n})</option>`).join('')}</select>
        ${sel('verdict', [['', 'Any verdict'], ['clone,gap', 'Clone + gap'], ['clone', 'Worth cloning'], ['gap', 'Gap (add-on / slice)'], ['watch', 'Watch'], ['avoid', 'Avoid']], S.verdict)}
        ${sel('tier', [['', 'Any size'], ['indie', 'Indie'], ['established', 'Established'], ['giant', 'Giant']], S.tier)}
        ${sel('evidence', [['', 'Any evidence'], ['sourced', 'Review-backed'], ['listed', 'Catalogued only']], S.evidence)}
        ${sel('maxBuild', [['', 'Any build time'], ['4', 'MVP ≤ 4 weeks'], ['6', '≤ 6 weeks'], ['8', '≤ 8 weeks']], S.maxBuild)}
        <label class="muted"><input type="checkbox" name="price" value="1" ${S.price === '1' ? 'checked' : ''}> Has price</label>
        <label class="muted"><input type="checkbox" name="revenue" value="1" ${S.revenue === '1' ? 'checked' : ''}> Has public revenue</label>
        ${sel('sort', [['best', 'Sort: best evidence'], ['complaints', 'Most complaints'], ['build', 'Fastest to build'], ['tier', 'Smallest companies first'], ['name', 'Name']], S.sort)}
      </form><div id="pr">${loading()}</div>`;
    const el = $('#pr');
    let seq = 0;
    const refresh = async (append) => {
      const my = ++seq;
      const r = await api(`/api/saas/products?${qs({ ...S, limit: isClone ? 30 : 50 })}`);
      if (my !== seq || !$('#pr')) return;
      const head = `<p class="muted" style="margin-bottom:12px">${r.total.toLocaleString()} products${isClone ? '' : ''}. Showing ${Math.min(r.total, r.page * r.limit)}.</p>`;
      const more = r.page * r.limit < r.total ? `<div class="controls" style="justify-content:center;margin-top:16px"><button class="ghost" id="pmore" data-auto>Load more</button></div>` : '';
      const body = isClone
        ? r.rows.map(productCard).join('')
        : r.rows.map((p) => `<tr data-href="#/s-product/${p._id}"><td><div class="appcell">${fav(p.url, p.name)}<div><b>${esc(p.name)}</b><small>${esc(p.desc).slice(0, 80)}</small></div></div></td><td class="muted" style="white-space:normal;max-width:220px">${esc(p.cat)}</td><td>${vpill(p.verdict)}</td><td>${pill(p.tier)}</td><td class="num">${p._n || '–'}</td><td style="white-space:normal;max-width:140px">${esc(p.price || '–')}</td><td style="white-space:normal;max-width:180px;font-size:12px">${esc(p.revenue || '–')}</td><td class="num">${p.build ? p.build + ' wk' : '–'}</td></tr>`).join('');
      if (!append) {
        el.innerHTML = head + (r.rows.length ? (isClone ? `<div class="grid g3" id="pgrid">${body}</div>` : `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Verdict</th><th>Size</th><th class="num">Complaints</th><th>Price</th><th>Revenue</th><th class="num">MVP</th></tr></thead><tbody id="pgrid">${body}</tbody></table></div>`) : '<div class="empty">No products match.</div>') + more;
      } else {
        $('#pgrid').insertAdjacentHTML('beforeend', body);
        $('#pmore')?.parentElement.remove();
        el.insertAdjacentHTML('beforeend', more);
        el.querySelector('p.muted').textContent = `${r.total.toLocaleString()} products. Showing ${Math.min(r.total, r.page * r.limit)}.`;
      }
      el.querySelectorAll('tr[data-href]').forEach((tr) => (tr.onclick = () => go(tr.dataset.href)));
      const m = $('#pmore');
      if (m) m.onclick = () => { S.page = (+S.page || 1) + 1; refresh(true); };
    };
    liveForm($('#pf'), S, () => refresh(false), route);
    refresh(false);
  }

  async function viewProduct(parts) {
    view.innerHTML = loading();
    const r = await api(`/api/saas/product/${encodeURIComponent(parts[1])}`);
    const p = r.product;
    view.innerHTML = `
      <div class="apphead">${fav(p.url, p.name, true)}
        <div><div class="kicker">SaaS · ${esc(p.cat)}</div><h1>${esc(p.name)}</h1>
          <div class="meta">${vpill(p.verdict)}${pill(p.tier)}${pill(p.evidence === 'sourced' ? 'review-backed' : 'catalogued only')}${p.url ? ext(p.url, host(p.url)) : ''}</div></div>
        <div class="actions"><a class="chip" href="#/brand?${qs({ name: p.name, website: p.url })}">Ads & socials →</a></div></div>
      <div class="grid g4">
        <div class="card kpi"><div class="kicker">Entry price</div><div class="v" style="font-size:20px">${esc(p.price || '–')}</div><div class="r">${p.price_src ? ext(p.price_src, 'pricing page') : ''}</div></div>
        <div class="card kpi hero"><div class="kicker">Public revenue</div><div class="v" style="font-size:20px">${esc(p.revenue || '–')}</div><div class="r">${p.revenue_src ? ext(p.revenue_src, host(p.revenue_src)) : 'not disclosed'}</div></div>
        <div class="card kpi"><div class="kicker">Solo MVP</div><div class="v">${p.build ? p.build + ' wk' : '–'}</div><div class="r">${esc(p.model || '')}</div></div>
        <div class="card kpi"><div class="kicker">Customer</div><div class="v" style="font-size:15px;font-weight:600">${esc(p.customer || '–')}</div></div>
      </div>
      <div class="grid g2 section">
        <div class="card"><h3>Verdict: ${esc(p.verdict)}</h3><p style="font-size:14px">${esc(p.why || '')}</p>${p.idea ? `<div class="kicker" style="margin-top:12px">The play</div><p style="margin-top:4px">${esc(p.idea)}</p>` : ''}${p.pattern ? `<div class="kicker" style="margin-top:12px">Dominant complaint</div><p style="margin-top:4px">${esc(p.pattern)}</p>` : ''}<p class="muted" style="margin-top:12px;font-size:13px">${esc(p.desc)}</p></div>
        <div class="card"><h3>What customers complain about <span class="pill">${p.complaints?.length || 0}</span></h3>${complaintsHTML(p.complaints)}</div>
      </div>
      ${r.problems.length ? `<div class="section"><h2>Problem statements that name it</h2><div class="grid g2">${r.problems.map(problemCard).join('')}</div></div>` : ''}
      ${r.categoryNote ? `<div class="section card"><h3>${esc(p.cat)}: how the market splits</h3><p class="muted">${esc(r.categoryNote.how_segments_coexist || '')}</p>${r.categoryNote.pattern ? `<div class="kicker" style="margin-top:10px">Common complaint</div><p>${esc(r.categoryNote.pattern)}</p>` : ''}${r.categoryNote.opening ? `<div class="kicker" style="margin-top:10px">Opening</div><p>${esc(r.categoryNote.opening)}</p>` : ''}</div>` : ''}
      <div class="section"><h2>Others in ${esc(p.cat)} <a href="#/s-products?${qs({ cat: p.cat })}" style="font-size:13px;font-weight:500">See all →</a></h2><div class="table-wrap"><table><thead><tr><th>Product</th><th>Verdict</th><th>Size</th><th>Price</th><th>Revenue</th></tr></thead><tbody>${r.peers.map((x) => `<tr data-href="#/s-product/${x._id}"><td><div class="appcell">${fav(x.url, x.name)}<div><b>${esc(x.name)}</b><small>${esc(x.desc).slice(0, 70)}</small></div></div></td><td>${vpill(x.verdict)}</td><td>${pill(x.tier)}</td><td>${esc(x.price || '–')}</td><td style="font-size:12px">${esc(x.revenue || '–')}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="section"><h2>Brand: socials & ads</h2><div id="brandBits">${p.url ? loading('Reading the website and ad library…') : '<div class="empty">No website on record.</div>'}</div></div>`;
    view.querySelectorAll('tr[data-href]').forEach((tr) => (tr.onclick = () => go(tr.dataset.href)));
    if (p.url) renderBrandBits($('#brandBits'), { name: p.name, adQuery: p.name, website: p.url });
  }

  // ---------- Problems ----------
  function problemCard(p) {
    return `<div class="card">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><h3 style="margin:0">${esc(p.title)}</h3><div style="display:flex;gap:4px;flex:none">${pill(p.strength, { strong: 'high', moderate: 'medium', thin: 'low' }[p.strength])}${pill(p.angle)}</div></div>
      <p class="muted" style="font-size:13px;margin-top:6px"><b>Who:</b> ${esc(p.who)}</p>
      <p style="font-size:13px;margin-top:6px"><b>Pain:</b> ${esc(p.pain)}</p>
      <p style="font-size:13px;margin-top:6px"><b>Why unsolved:</b> ${esc(p.why_unsolved)}</p>
      <div class="kicker" style="margin-top:10px">The play</div><p style="font-size:13px;margin-top:4px">${esc(p.play)}</p>
      <div class="facts" style="grid-template-columns:repeat(3,1fr)"><div><div class="kicker">Channel</div><span style="font-size:12px">${esc(p.channel || '–')}</span></div><div><div class="kicker">Recurring because</div><span style="font-size:12px">${esc(p.recurring || '–')}</span></div><div><div class="kicker">MVP</div><b>${p.build_weeks ? p.build_weeks + ' wk' : '–'}</b></div></div>
      ${p.currentLinks?.length ? `<div class="kicker" style="margin-top:10px">Current tools</div><div class="chips" style="margin-top:4px">${p.currentLinks.map((c) => (c.id != null ? `<a class="chip" href="#/s-product/${c.id}">${esc(c.name)}</a>` : `<span class="chip dim">${esc(c.name)}</span>`)).join('')}</div>` : ''}
      ${p.evidence?.length ? `<details class="method"><summary>Evidence (${p.evidence.length})</summary><ul>${p.evidence.map((e) => `<li>${esc(e.text)} ${e.date ? `<span class="dim">${esc(e.date)}</span>` : ''} ${ext(e.src, host(e.src))}</li>`).join('')}</ul></details>` : ''}
    </div>`;
  }

  async function viewProblems(_, q) {
    const S = { ...q };
    view.innerHTML = `<div class="view-head"><div><h1>Problem statements</h1><p>Evidence-backed problems from the SaaS Database: who has it, why current tools fail, and the micro-SaaS that would solve it.</p></div></div>
      <form id="qf" class="controls" style="margin-bottom:14px"><input class="input" type="search" name="q" placeholder="Search problems…" value="${esc(S.q || '')}" style="min-width:240px">
      ${sel('strength', [['', 'Any strength'], ['strong', 'Strong (3+ sources incl. money)'], ['moderate', 'Moderate'], ['thin', 'Thin']], S.strength)}
      ${sel('angle', [['', 'Any angle'], ['better', 'Better'], ['package', 'Package'], ['market', 'Market'], ['automate', 'Automate']], S.angle)}</form><div id="qr">${loading()}</div>`;
    const refresh = async () => {
      const r = await api(`/api/saas/problems?${qs(S)}`);
      const el = $('#qr');
      if (!el) return;
      el.innerHTML = r.rows.length ? `<p class="muted" style="margin-bottom:12px">${r.rows.length} problems, strongest evidence first.</p><div class="grid g2">${r.rows.map(problemCard).join('')}</div>` : missing();
    };
    liveForm($('#qf'), S, refresh, 's-problems');
    refresh();
  }

  // ---------- SaaS ideas (daily scan) ----------
  const SAAS_PILLARS = [['demand', 4], ['pain', 4], ['switch', 3], ['build', 3], ['recurring', 2], ['distribution', 2], ['monetization', 1], ['defensibility', 1]];
  async function viewSaasIdeas(_, q) {
    const S = { verdict: '', ...q };
    const { rows } = await api('/api/saas/ideas');
    if (!rows.length) { view.innerHTML = missing(); return; }
    const counts = rows.reduce((m, r) => ((m[r.verdict] = (m[r.verdict] || 0) + 1), m), {});
    const show = rows.filter((r) => !S.verdict || r.verdict === S.verdict);
    view.innerHTML = `<div class="view-head"><div><h1>SaaS ideas</h1><p>Opportunities from the daily SaaS scan. Score = (4·demand + 4·pain + 3·switch + 3·build + 2·recurring + 2·distribution + monetization + defensibility − 20) ÷ 80. A high score never overrides a failed gate.</p></div></div>
      <div class="controls" style="margin-bottom:14px"><div class="seg" id="iv">${[['', `All ${rows.length}`], ['strong', `Strong ${counts.strong || 0}`], ['validate', `Validate ${counts.validate || 0}`], ['reject', `Reject ${counts.reject || 0}`]].map(([v, l]) => `<button data-v="${v}" class="${S.verdict === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="grid g2">${show.map((i) => `<div class="card opp">
        <div style="display:flex;gap:12px;align-items:flex-start"><div style="flex:1;min-width:0"><h3 style="margin:0">${esc(i.idea)}</h3><div class="muted" style="font-size:12px;margin-top:4px">${esc(i.category)}</div><div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${vpill(i.verdict)}${pill(`wtp ${i.wtp}`, { strong: 'high', moderate: 'medium', weak: 'low' }[i.wtp])}${pill(i.confidence ? `${i.confidence} confidence` : '')}</div></div>
          <div class="score ${{ strong: 'high', validate: 'medium' }[i.verdict] || 'low'}" title="Colour follows the gate verdict: a high score never overrides a failed gate">${i.score}</div></div>
        <p style="font-size:13px;margin-top:10px">${esc(i.pitch)}</p>
        ${bars(SAAS_PILLARS.map(([k, w]) => [`${k} ×${w}`, i[k]]))}
        <div class="facts"><div><div class="kicker">Price</div><b>${i.price ? '$' + i.price + '/mo' : '–'}</b><div class="dim" style="font-size:11px">${esc(i.pricing_model || '')}</div></div><div><div class="kicker">MVP</div><b>${i.build_weeks ? i.build_weeks + ' wk' : '–'}</b></div><div><div class="kicker">Channel</div><span style="font-size:12px">${esc(i.channel_type || '–')}</span></div><div><div class="kicker">Seen</div><span style="font-size:12px">${esc(i.first_seen || '')}</span></div></div>
        <div class="kicker" style="margin-top:12px">Verdict reason</div><p style="font-size:13px;margin-top:4px">${esc(i.verdict_reason)}</p>
        <details class="method"><summary>Segment, wedge, competitors, risks</summary>
          <p><b>Segment.</b> ${esc(i.segment)}</p><p><b>Problem.</b> ${esc(i.problem)}</p><p><b>Wedge.</b> ${esc(i.wedge)}</p><p><b>Workarounds.</b> ${esc(i.workarounds)}</p>
          <p><b>Competitors.</b></p><ul>${list(i.competitors).map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          <p><b>MVP.</b> ${esc(i.mvp)}</p><p><b>Channels.</b> ${esc(i.channels)}</p><p><b>Risks.</b> ${esc(i.risks)}</p><p><b>Kill if.</b> ${esc(i.kill_if)}</p>
        </details>
        ${i.evidence?.length ? `<details class="method"><summary>Evidence (${i.evidence.length})</summary><ul>${i.evidence.map((e) => `<li>${pill(e.kind)} ${esc(e.what)} <span class="dim">${esc(e.date || '')}</span> ${ext(e.url, host(e.url))}</li>`).join('')}</ul></details>` : ''}
      </div>`).join('')}</div>`;
    $('#iv').onclick = (e) => e.target.dataset.v != null && go(`#/s-ideas?${qs({ verdict: e.target.dataset.v })}`);
  }

  // ---------- Categories ----------
  async function viewCategories() {
    const r = await api('/api/saas/categories');
    if (!r.catalogue.length) { view.innerHTML = missing(); return; }
    view.innerHTML = `<div class="view-head"><div><h1>SaaS categories</h1><p>${r.catalogue.length} categories from the SaaS Database, ranked by how many products are worth cloning or leave a gap. Click a row for how the market splits and where the opening is.</p></div></div>
      <div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Products</th><th class="num">Clone</th><th class="num">Gap</th><th class="num">Avoid</th><th class="num">Complaints</th><th class="num">Public revenue</th><th></th></tr></thead><tbody>
      ${r.catalogue.map((c, i) => `<tr data-i="${i}"><td style="white-space:normal"><b>${esc(c.cat)}</b></td><td class="num">${c.total}</td><td class="num">${c.clone || 0}</td><td class="num">${c.gap || 0}</td><td class="num">${c.avoid || 0}</td><td class="num">${c.complaints}</td><td class="num">${c.withRevenue}</td><td><a class="chip" href="#/s-clone?${qs({ cat: c.cat, verdict: 'clone,gap', evidence: '' })}" onclick="event.stopPropagation()">Open →</a></td></tr>
        <tr class="note" data-for="${i}" hidden style="cursor:default"><td colspan="8" style="white-space:normal;background:var(--panel-2)">${c.note ? `<p class="muted"><b>How the market splits.</b> ${esc(c.note.how_segments_coexist || '')}</p>${c.note.pattern ? `<p style="margin-top:6px"><b>Common complaint.</b> ${esc(c.note.pattern)}</p>` : ''}${c.note.opening ? `<p style="margin-top:6px"><b>Opening.</b> ${esc(c.note.opening)}</p>` : ''}` : '<span class="dim">No category note.</span>'}</td></tr>`).join('')}
      </tbody></table></div>
      ${r.researched.length ? `<div class="section"><h2>Researched by the daily scan <span class="pill">${r.researched.length}</span></h2><div class="grid g2">${r.researched.map((c) => `<div class="card"><h3>${esc(c.category)}</h3><p class="muted" style="font-size:13px">${esc(c.customer)}</p>
        <p style="font-size:13px;margin-top:8px"><b>Assessment.</b> ${esc(c.assessment)}</p>
        <details class="method"><summary>Competitors, pricing, frustrations, sub-niches</summary><p><b>Competitors.</b> ${esc(c.competitors)}</p><p><b>Pricing pattern.</b> ${esc(c.pricing_pattern)}</p><p><b>Frustrations.</b> ${esc(c.frustrations)}</p><p><b>Sub-niches.</b> ${esc(c.subniches)}</p><p><b>Evidence quality.</b> ${esc(c.evidence_quality)}</p><p class="dim">Last checked ${esc(c.last_checked || '')}</p></details></div>`).join('')}</div></div>` : ''}`;
    view.querySelectorAll('tr[data-i]').forEach((tr) => (tr.onclick = () => { const n = view.querySelector(`tr[data-for="${tr.dataset.i}"]`); n.hidden = !n.hidden; }));
  }

  // ---------- Complaints & avoid ----------
  async function viewComplaints(_, q) {
    const { rows } = await api('/api/saas/complaints');
    if (!rows.length) { view.innerHTML = missing(); return; }
    const S = { q: '', ...q };
    view.innerHTML = `<div class="view-head"><div><h1>Complaint clusters</h1><p>Repeated, independent complaints about specific competitors, from the daily SaaS scan.</p></div></div>
      <form id="cf2" class="controls" style="margin-bottom:14px"><input class="input" type="search" name="q" placeholder="Filter by competitor or theme…" value="${esc(S.q)}" style="min-width:260px"></form><div id="cr"></div>`;
    const draw = () => {
      const t = S.q.toLowerCase();
      const show = rows.filter((r) => !t || `${r.competitor} ${r.cluster} ${r.summary}`.toLowerCase().includes(t)).sort((a, b) => (b.independent_reports || 0) - (a.independent_reports || 0));
      $('#cr').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Competitor</th><th>Cluster</th><th class="num">Reports</th><th>Dates</th><th>Still current</th><th>Sources</th></tr></thead><tbody>${show.map((r) => `<tr style="cursor:default"><td><b>${esc(r.competitor)}</b></td><td style="white-space:normal;min-width:280px"><b style="font-weight:600">${esc(r.cluster)}</b><div class="muted" style="font-size:12px;margin-top:2px">${esc(r.summary)}</div></td><td class="num">${r.independent_reports ?? '–'}</td><td class="muted">${esc(r.dates || '')}</td><td>${pill(r.still_current, r.still_current === 'yes' ? 'high' : '')}</td><td style="white-space:normal">${String(r.sources || '').split(/\s+/).filter(Boolean).map((u) => ext(u, host(u))).join('<br>')}</td></tr>`).join('')}</tbody></table></div>`;
    };
    liveForm($('#cf2'), S, draw, 's-complaints');
    draw();
  }

  async function viewAvoid() {
    const { rows } = await api('/api/saas/avoid');
    if (!rows.length) { view.innerHTML = missing(); return; }
    view.innerHTML = `<div class="view-head"><div><h1>Markets to avoid</h1><p>${rows.length} markets the scans rejected, with the reason. Useful before falling for an idea.</p></div></div>
      <div class="grid g2">${rows.map((r) => `<div class="card tight"><b>${esc(r.market)}</b><p class="muted" style="font-size:13px;margin-top:4px">${esc(r.why)}</p></div>`).join('')}</div>`;
  }

  // ---------- Startups ----------
  async function viewStartups(_, q) {
    const S = { ...q };
    view.innerHTML = `<div class="view-head"><div><h1>Funded startups</h1><p>YC 2025–2026 batches and other VC-backed companies. Individually judged rows carry a play: clone smaller, sell to their users, or go vertical.</p></div></div>
      <form id="sf" class="controls" style="margin-bottom:14px"><input class="input" type="search" name="q" placeholder="Search startups…" value="${esc(S.q || '')}" style="min-width:220px">
      ${sel('fit', [['', 'Any fit'], ['likely', 'Solo fit: likely'], ['possible', 'Possible'], ['unlikely', 'Unlikely']], S.fit)}
      ${sel('angle', [['', 'Any play'], ['any', 'Has a play'], ['clone-smaller', 'Clone smaller'], ['sell-to', 'Sell to its users'], ['vertical', 'Vertical version'], ['skip', 'Skip']], S.angle)}
      ${sel('source', [['', 'YC + other funds'], ['yc', 'YC'], ['vc', 'Other funds']], S.source)}
      <select name="batch" id="sbatch"><option value="">Any batch</option></select>
      <label class="muted"><input type="checkbox" name="ai" value="1" ${S.ai === '1' ? 'checked' : ''}> AI only</label></form><div id="sr">${loading()}</div>`;
    let seq = 0;
    const card = (s) => `<div class="card opp">
      <div style="display:flex;gap:12px;align-items:flex-start">${fav(s.url, s.name)}<div style="flex:1;min-width:0"><b>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" style="color:var(--text)">${esc(s.name)} ↗</a>` : esc(s.name)}</b>
        <div class="muted" style="font-size:12px">${esc([s.batch, s.round !== 'YC' ? s.round : '', s.amount, s.region].filter(Boolean).join(' · '))}</div>
        <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${pill(s.fit === 'likely' ? 'solo fit: likely' : s.fit, { likely: 'high', possible: 'medium', unlikely: 'low' }[s.fit])}${s.angle ? pill(s.angle, s.angle === 'skip' ? 'low' : 'high') : ''}${s.ai ? pill('AI') : ''}${s.status && s.status !== 'Active' ? pill(s.status, 'low') : ''}</div></div></div>
      <p style="font-size:13px;margin-top:10px">${esc(s.one_liner || '')}</p>
      ${s.idea ? `<div class="kicker" style="margin-top:10px">The play</div><p style="font-size:13px;margin-top:4px">${esc(s.idea)}</p>` : ''}
      ${s.why ? `<p class="muted" style="font-size:12px;margin-top:6px">${esc(s.why)}</p>` : ''}
      <div class="dim" style="font-size:12px;margin-top:8px">${esc((s.investors || []).join(', '))}${s.industry ? ` · ${esc(s.industry)}` : ''}${s.judged ? '' : ' · fit auto-tagged'} ${s.src ? ext(s.src, 'source') : ''}</div>
    </div>`;
    const refresh = async (append) => {
      const my = ++seq;
      const r = await api(`/api/saas/startups?${qs({ ...S, limit: 60 })}`);
      if (my !== seq || !$('#sr')) return;
      const b = $('#sbatch');
      if (b.options.length === 1) b.insertAdjacentHTML('beforeend', r.batches.map((x) => `<option ${x === S.batch ? 'selected' : ''}>${esc(x)}</option>`).join(''));
      const more = r.page * r.limit < r.total ? `<div class="controls" style="justify-content:center;margin-top:16px"><button class="ghost" id="smore" data-auto>Load more</button></div>` : '';
      if (!append) $('#sr').innerHTML = `<p class="muted" style="margin-bottom:12px" id="scount"></p><div class="grid g3" id="sgrid">${r.rows.map(card).join('')}</div>${more}`;
      else { $('#sgrid').insertAdjacentHTML('beforeend', r.rows.map(card).join('')); $('#smore')?.parentElement.remove(); $('#sr').insertAdjacentHTML('beforeend', more); }
      $('#scount').textContent = `${r.total.toLocaleString()} startups · showing ${Math.min(r.total, r.page * r.limit)}`;
      const m = $('#smore');
      if (m) m.onclick = () => { S.page = (+S.page || 1) + 1; refresh(true); };
    };
    liveForm($('#sf'), S, () => refresh(false), 's-startups');
    refresh(false);
  }

  // ---------- App ideas (apps track) ----------
  const APP_PILLARS = [['demand', 'Demand'], ['pain', 'Pain'], ['build', 'Build'], ['content', 'Content'], ['search', 'Search'], ['recurring_s', 'Recurring']];
  async function viewAppIdeas(_, q) {
    const S = { status: '', tab: 'ideas', ...q };
    const r = await api('/api/apps/ideas');
    if (!r.ideas.length) { view.innerHTML = missing(); return; }
    const counts = r.ideas.reduce((m, i) => ((m[i.computed] = (m[i.computed] || 0) + 1), m), {});
    const set = (k, v) => go(`#/appideas?${qs({ ...S, [k]: v })}`);
    const tabs = `<div class="seg" id="atab">${[['ideas', `Ideas ${r.ideas.length}`], ['trends', `Trends ${r.trends.length}`], ['stories', `Builder stories ${r.stories.length}`], ['sources', 'Sources']].map(([v, l]) => `<button data-v="${v}" class="${S.tab === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    let body = '';
    if (S.tab === 'ideas') {
      const show = r.ideas.filter((i) => !S.status || i.computed === S.status);
      body = `<div class="seg" id="ast" style="margin-bottom:14px">${[['', 'All'], ['pass', `Pass ${counts.pass || 0}`], ['watch', `Watch ${counts.watch || 0}`], ['miss', `Miss ${counts.miss || 0}`]].map(([v, l]) => `<button data-v="${v}" class="${S.status === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="grid g2">${show.map((i) => `<div class="card opp">
        <div style="display:flex;gap:12px;align-items:flex-start"><div style="flex:1;min-width:0"><h3 style="margin:0">${esc(i.idea)}</h3><div class="muted" style="font-size:12px;margin-top:4px">${esc(i.who)}</div>
          <div style="margin-top:6px;display:flex;gap:4px;flex-wrap:wrap">${vpill(i.computed)}${pill(i.type)}${pill(`wtp ${i.wtp}`, { strong: 'high', moderate: 'medium', weak: 'low' }[i.wtp])}${pill(i.origin)}</div></div>
          <div class="score ${i.computed === 'pass' ? 'high' : i.computed === 'watch' ? 'medium' : 'low'}" title="Sum of six pillars (max 30)">${i.pillarSum}</div></div>
        <p style="font-size:13px;margin-top:10px">${esc(i.problem)}</p>
        ${bars(APP_PILLARS.map(([k, l]) => [l, i[k]]))}
        <div class="facts"><div><div class="kicker">Test price</div><b>${i.price ? '$' + i.price + '/mo' : '–'}</b></div><div><div class="kicker">Users for $2K/mo</div><b>${i.usersFor2k ? i.usersFor2k.toLocaleString() : '–'}</b></div><div><div class="kicker">Recurring</div><span style="font-size:12px">${esc(i.recurring || '–')}</span></div><div><div class="kicker">Seen</div><span style="font-size:12px">${esc(i.first_seen || '')}</span></div></div>
        ${i.wedge ? `<div class="kicker" style="margin-top:12px">Wedge</div><p style="font-size:13px;margin-top:4px">${esc(i.wedge)}</p>` : ''}
        <details class="method"><summary>Competitors, channel, content, next step</summary><p><b>Competitors.</b> ${esc(i.competitors)}</p><p><b>Channel.</b> ${esc(i.channel)}</p><p><b>Content angle.</b> ${esc(i.content_angle)}</p><p><b>First post.</b> ${esc(i.first_post)}</p><p><b>SEO seeds.</b> ${esc(i.seo_seeds)}</p><p><b>Next step.</b> ${esc(i.next_step)}</p><p><b>Kill if.</b> ${esc(i.kill_if)}</p>${i.risk ? `<p><b>Risk.</b> ${esc(i.risk)}</p>` : ''}${i.url ? `<p>${ext(i.url, host(i.url))}</p>` : ''}</details>
        <div class="controls" style="margin-top:10px"><a class="chip" href="#/search?${qs({ q: (i.competitors || '').split(/[,(;]/)[0].trim() || i.idea })}">Look up competitors →</a></div>
      </div>`).join('')}</div>`;
    } else if (S.tab === 'trends') {
      body = `<div class="grid g2">${r.trends.map((t) => `<div class="card"><div style="display:flex;gap:6px;flex-wrap:wrap">${pill(t.platform)}${pill(t.kind, t.kind === 'lasting' ? 'high' : '')}<span class="dim" style="font-size:12px">${esc(t.date || '')}</span></div><h3 style="margin-top:8px">${esc(t.trend)}</h3><p style="font-size:13px">${esc(t.what)}</p>${t.gap ? `<p class="muted" style="font-size:13px;margin-top:6px"><b>Gap.</b> ${esc(t.gap)}</p>` : ''}<p style="margin-top:6px">${ext(t.url, host(t.url))}</p></div>`).join('')}</div>`;
    } else if (S.tab === 'stories') {
      body = `<div class="grid g2">${r.stories.map((s) => `<div class="card">${pill(s.outcome, s.outcome === 'success' ? 'high' : 'low')}<h3 style="margin-top:8px">${esc(s.name)}</h3><p style="font-size:13px"><b>${esc(s.headline)}</b></p><p class="muted" style="font-size:13px;margin-top:6px">${esc(s.lesson)}</p><p style="margin-top:6px">${ext(s.url, host(s.url))}</p></div>`).join('')}</div>`;
    } else {
      body = `<div class="table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th>Note</th></tr></thead><tbody>${r.sources.map((s) => `<tr style="cursor:default"><td>${s.url ? ext(s.url, s.source) : esc(s.source)}</td><td>${pill(s.status)}</td><td class="muted" style="white-space:normal">${esc(s.note)}</td></tr>`).join('')}</tbody></table></div>`;
    }
    view.innerHTML = `<div class="view-head"><div><h1>App ideas</h1><p>Scored mobile-app ideas from your daily apps scan. Status: pass = every pillar ≥3 and a wedge; watch = one pillar at 2 or no wedge; miss = the rest.</p></div></div>
      <div class="controls" style="margin-bottom:14px">${tabs}</div>${body}`;
    $('#atab').onclick = (e) => e.target.dataset.v && set('tab', e.target.dataset.v);
    const st = $('#ast');
    if (st) st.onclick = (e) => e.target.dataset.v != null && set('status', e.target.dataset.v);
  }

  // ================= Live SaaS catalog (unified across sources) =================
  const SRC = { shopify: 'Shopify app', wp: 'WordPress plugin', atl: 'Atlassian app', trustmrr: 'TrustMRR', hn: 'Show HN', ph: 'Product Hunt', yc: 'Y Combinator', zap: 'Zapier', research: 'Your research', ios: 'App Store', gp: 'Google Play' };
  const SV = { strong: 'high', validate: 'medium', reject: 'low' };
  const num = (n) => (n == null ? '–' : n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e4 ? 0 : 1) + 'K' : String(Math.round(n)));
  const itemHref = (p) => `#/s-item?key=${encodeURIComponent(p.key)}`;
  const pIcon = (p, lg) => (p.icon ? `<img class="ico${lg ? ' lg' : ''}" src="${esc(p.icon)}" alt="" loading="lazy" data-name="${esc(p.name || '?')}">` : fav(p.website || p.url, p.name, lg));
  const PILLARS = [['demand', 4], ['pain', 4], ['switch', 3], ['build', 3], ['recurring', 2], ['distribution', 2], ['monetization', 1], ['defensibility', 1]];
  const priceText = (p) => (p.price_min ? `$${p.price_min}/mo` : p.pricing ? String(p.pricing) : p.free_plan ? 'Free' : '');
  const revText = (p) => (p.mrr ? `$${num(p.mrr)} MRR` : p.revenue_text || '');
  const srcBadges = (p) => [p.source, ...(p.twins || []).map((t) => t.source)].filter((v, i, a) => a.indexOf(v) === i && SRC[v]).map((s) => `<span class="pill" style="font-size:10px">${esc(SRC[s])}</span>`).join(' ');
  const demandFact = (p) => (p.installs ? ['Installs', num(p.installs)] : p.extra?.teamSize ? ['Team size', num(p.extra.teamSize)] : p.extra?.points ? ['HN points', num(p.extra.points)] : p.extra?.votes ? ['Votes', num(p.extra.votes)] : p.extra?.zapTier ? ['Zapier partner', p.extra.zapTier.toLowerCase()] : ['Installs', '–']);
  const facts = (p) => `<div class="facts">
      <div><div class="kicker">Rating</div><b>${p.rating ? '★' + (+p.rating).toFixed(1) : '–'}</b><div class="dim" style="font-size:11px">${p.reviews ? num(p.reviews) + ' ratings' : ''}</div></div>
      <div><div class="kicker">${demandFact(p)[0]}</div><b>${esc(demandFact(p)[1])}</b></div>
      <div><div class="kicker">Price</div><b style="font-size:12px">${esc(priceText(p).slice(0, 26) || '–')}</b><div class="dim" style="font-size:11px">${esc(p.model || '')}</div></div>
      <div><div class="kicker">Revenue</div><b style="font-size:12px">${esc(revText(p).slice(0, 40) || '–')}</b></div>
    </div>`;

  function liveCard(p) {
    const neg = (p.themes || []).filter((t) => t.k !== 'praise').sort((a, b) => b.n - a.n).slice(0, 3);
    return `<div class="card opp">
      <div style="display:flex;gap:12px;align-items:flex-start">${pIcon(p)}
        <div style="min-width:0;flex:1"><a class="t" href="${itemHref(p)}" style="font-weight:700;color:var(--text)">${esc(p.name)}</a>
          <div class="muted" style="font-size:12px">${esc(p.category || '')}</div>
          <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${pill(p.verdict, SV[p.verdict])}${p.extra?.verdict ? pill('research: ' + (p.extra.verdict === 'clone' ? 'worth cloning' : p.extra.verdict), VERDICT[p.extra.verdict]) : ''}${pill(p.extra?.tier)}${p.neg ? pill(`${p.neg} complaints`, 'low') : ''}</div></div>
        <div class="score ${SV[p.verdict] || 'low'}" title="SaaS-track score; colour follows the gate verdict">${p.score ?? '–'}</div></div>
      ${p.description ? `<p class="muted" style="font-size:13px;margin-top:10px">${esc(String(p.description).slice(0, 180))}</p>` : ''}
      ${p.pillars ? bars(PILLARS.map(([k, w]) => [`${k} ×${w}`, p.pillars[k]])) : ''}
      ${facts(p)}
      ${neg.length ? `<div class="kicker" style="margin-top:12px">What critical reviews say</div><div class="chips" style="margin-top:6px">${neg.map((t) => `<span class="chip">${esc(t.label)} · ${t.n}</span>`).join('')}</div>` : ''}
      <div class="kicker" style="margin-top:12px">How to beat it</div><ul class="angles">${(p.angles || []).slice(0, 3).map((a) => `<li>${esc(a.t)}</li>`).join('')}</ul>
      <div class="controls" style="margin-top:12px"><a class="chip" href="${itemHref(p)}">Clone plan & reviews →</a>${p.website ? `<a class="chip" href="${esc(p.website)}" target="_blank" rel="noopener">Website ↗</a>` : ''}</div>
    </div>`;
  }

  async function viewLive(_, q, mode) {
    const isCards = mode === 'clone';
    const route = isCards ? 's-clone' : 's-all';
    const S = isCards ? { verdict: 'strong,validate', sort: 'score', ...q } : { sort: 'score', ...q };
    S.page = 1;
    const f = await api('/api/s2/facets');
    view.innerHTML = `
      <div class="view-head"><div><h1>${isCards ? 'Worth cloning' : 'All SaaS'}</h1><p>${f.total.toLocaleString()} SaaS products (your research merged with ${f.sources.length - 1} live sources; the same company from several sources is shown once). ${isCards ? 'Strong and validate verdicts first: proven demand, real pain, a reason to switch and a buildable product.' : 'Scored on your SaaS pillars, with complaints, price and revenue.'} <a href="#/s-sources">Sources & sync →</a></p></div></div>
      <form id="lf" class="controls" style="margin-bottom:14px">
        <input class="input" type="search" name="q" placeholder="Search name, category, idea, complaint…" value="${esc(S.q || '')}" style="min-width:230px">
        <select name="cat"><option value="">All categories</option>${f.categories.map((c) => `<option ${c.category === S.cat ? 'selected' : ''} value="${esc(c.category)}">${esc(c.category)} (${c.n})</option>`).join('')}</select>
        <select name="source"><option value="">All sources</option>${f.sources.map((x) => `<option value="${x.source}" ${S.source === x.source ? 'selected' : ''}>${esc(SRC[x.source] || x.source)} (${x.n.toLocaleString()})</option>`).join('')}</select>
        ${sel('verdict', [['', 'Any score verdict'], ['strong,validate', 'Strong + validate'], ['strong', 'Strong'], ['validate', 'Validate'], ['reject', 'Reject']], S.verdict)}
        ${sel('rverdict', [['', 'Any research verdict'], ['clone,gap', 'Research: clone + gap'], ['clone', 'Research: worth cloning'], ['gap', 'Research: gap'], ['watch', 'Research: watch'], ['avoid', 'Research: avoid']], S.rverdict)}
        ${sel('tier', [['', 'Any size'], ['indie', 'Indie'], ['established', 'Established'], ['giant', 'Giant']], S.tier)}
        ${sel('evidence', [['', 'Any complaints'], ['reviews', 'Has 3+ complaints/negative reviews'], ['none', 'No complaints collected']], S.evidence)}
        ${sel('maxBuild', [['', 'Any build time'], ['4', 'MVP ≤ 4 weeks'], ['6', '≤ 6 weeks'], ['8', '≤ 8 weeks']], S.maxBuild)}
        <label class="muted"><input type="checkbox" name="paid" value="1" ${S.paid === '1' ? 'checked' : ''}> Has price</label>
        <label class="muted"><input type="checkbox" name="revenue" value="1" ${S.revenue === '1' ? 'checked' : ''}> Has revenue</label>
        <label class="muted"><input type="checkbox" name="hard" value="1" ${S.hard === '1' ? 'checked' : ''}> Include hard niches</label>
        ${sel('sort', [['score', 'Sort: score'], ['complaints', 'Most complaints'], ['mrr', 'Highest MRR'], ['reviews', 'Most ratings'], ['build', 'Fastest to build'], ['tier', 'Smallest companies first'], ['rating_low', 'Lowest rated'], ['newest', 'Newest'], ['name', 'Name']], S.sort)}
      </form><div id="lr">${loading()}</div>`;
    const el = $('#lr');
    let seq = 0;
    const row = (p) => `<tr data-href="${itemHref(p)}">
      <td><div class="appcell">${pIcon(p)}<div><b>${esc(p.name)}</b><small>${esc(String(p.description || '').slice(0, 70))}</small><div style="margin-top:3px">${srcBadges(p)}</div></div></div></td>
      <td class="muted" style="white-space:normal;max-width:190px">${esc(p.category || '')}</td>
      <td class="num"><b>${p.score ?? '–'}</b></td>
      <td>${pill(p.verdict, SV[p.verdict])}${p.extra?.verdict ? `<div style="margin-top:3px">${vpill(p.extra.verdict)}</div>` : ''}</td>
      <td>${pill(p.extra?.tier)}</td>
      <td class="num">${p.neg || '–'}</td>
      <td class="num">${p.rating ? '★' + (+p.rating).toFixed(1) : '–'}<div class="dim" style="font-size:11px">${p.reviews ? num(p.reviews) : ''}</div></td>
      <td style="white-space:normal;max-width:150px;font-size:12px">${esc(priceText(p).slice(0, 60) || '–')}</td>
      <td style="white-space:normal;max-width:160px;font-size:12px">${esc(revText(p).slice(0, 60) || '–')}</td>
      <td class="num">${p.extra?.buildWeeks ? p.extra.buildWeeks + ' wk' : '–'}</td></tr>`;
    const refresh = async (append) => {
      const my = ++seq;
      const r = await api(`/api/s2/list?${qs({ ...S, limit: isCards ? 48 : 100 })}`);
      if (my !== seq || !$('#lr')) return;
      const body = isCards ? r.rows.map(liveCard).join('') : r.rows.map(row).join('');
      const more = r.page * r.limit < r.total ? `<div class="controls" style="justify-content:center;margin-top:16px"><button class="ghost" id="lmore" data-auto>Load more (${(r.total - r.page * r.limit).toLocaleString()} left)</button></div>` : '';
      if (!append) {
        el.innerHTML = `<p class="muted" style="margin-bottom:12px" id="lcount"></p>` + (r.rows.length ? (isCards ? `<div class="grid g3" id="lgrid">${body}</div>` : `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th class="num">Score</th><th>Verdict</th><th>Size</th><th class="num" title="Negative reviews and complaints collected">Complaints</th><th class="num">Rating</th><th>Price</th><th>Revenue</th><th class="num">MVP</th></tr></thead><tbody id="lgrid">${body}</tbody></table></div>`) : '<div class="empty">Nothing matches. If the catalog is still syncing, check Sources.</div>') + more;
      } else {
        $('#lgrid').insertAdjacentHTML('beforeend', body);
        $('#lmore')?.parentElement.remove();
        el.insertAdjacentHTML('beforeend', more);
      }
      $('#lcount').textContent = `${r.total.toLocaleString()} products · showing ${Math.min(r.total, r.page * r.limit).toLocaleString()}`;
      el.querySelectorAll('tr[data-href]').forEach((tr) => (tr.onclick = () => go(tr.dataset.href)));
      const m = $('#lmore');
      if (m) m.onclick = () => { S.page = (+S.page || 1) + 1; refresh(true); };
    };
    liveForm($('#lf'), S, () => refresh(false), route);
    refresh(false);
  }

  function planHTML(plan, p) {
    const li = (arr, f = (x) => esc(x)) => `<ul class="angles">${arr.map((x) => `<li>${f(x)}</li>`).join('')}</ul>`;
    return `<div class="section"><h2>Clone plan${plan.family ? ` <span class="pill">${esc(plan.family)}</span>` : ''}${plan.mvpWeeks ? ` <span class="pill">MVP ≈ ${plan.mvpWeeks} wk</span>` : ''}</h2>
      <div class="grid g2">
        <div class="card"><h3>Build first (the MVP)</h3>${plan.core.length ? li(plan.core) : `<p class="muted">${esc(plan.note || '')}</p>`}
          ${plan.later.length ? `<div class="kicker" style="margin-top:12px">After launch</div>${li(plan.later)}` : ''}
          ${plan.avoid.length ? `<div class="kicker" style="margin-top:12px">Don't build</div>${li(plan.avoid)}` : ''}
          <p class="dim" style="font-size:12px;margin-top:10px">Core list is the category's table stakes. Confirm against ${p.website ? ext(p.website, host(p.website)) : 'its website'}'s cheapest plan.</p></div>
        <div class="card"><h3>Your edge</h3>${li(plan.wedge, (w) => esc(w.t))}
          ${plan.price ? `<div class="kicker" style="margin-top:12px">Pricing</div><p style="font-size:14px;margin-top:4px">${esc(plan.price)}</p>` : ''}
          ${plan.alternatives.length ? `<div class="kicker" style="margin-top:12px">Also competing</div><div class="chips" style="margin-top:4px">${plan.alternatives.map((a) => `<span class="chip">${esc(a)}</span>`).join('')}</div>` : ''}</div>
      </div>
      <div class="card" style="margin-top:14px"><h3>What its users ask for <span class="pill">${plan.requested.length}</span></h3>${plan.requested.length ? `<div class="list">${plan.requested.map((r) => `<div class="item"><div class="s" style="color:var(--text)">“${esc(r.text)}”</div><div class="s">${r.stars ? '★'.repeat(r.stars) + ' · ' : ''}${esc(r.origin || '')}${r.url ? ' · ' + ext(r.url, host(r.url)) : ''}</div></div>`).join('')}</div>` : '<p class="muted">No feature requests found in the reviews collected so far.</p>'}</div></div>`;
  }

  async function viewItem(_, q) {
    view.innerHTML = loading();
    const r = await api(`/api/s2/item?key=${encodeURIComponent(q.key || '')}&_=${Date.now()}`);
    const { product: p, reviews, plan } = r;
    const ex = p.extra || {};
    const st = p.stars;
    const totalStars = st ? [1, 2, 3, 4, 5].reduce((s, k) => s + (+st[k] || 0), 0) : 0;
    const hmax = st ? Math.max(1, ...[1, 2, 3, 4, 5].map((k) => +st[k] || 0)) : 1;
    const [dLabel, dVal] = demandFact(p);
    const listings = (p.listings || []).concat((p.twins || []).filter((t) => !['ios', 'gp', 'wp', 'shopify', 'atl'].includes(t.source)));
    const notMatched = !p.listings_at;
    view.innerHTML = `
      <div class="apphead">${pIcon(p, true)}
        <div><div class="kicker">${esc(p.category || SRC[p.source] || '')}</div><h1>${esc(p.name)}</h1>
          <div class="meta">${pill(p.verdict, SV[p.verdict])}${ex.verdict ? vpill(ex.verdict) : ''}${pill(ex.tier)}${pill(p.confidence ? p.confidence + ' data' : '')}${p.developer ? `<span>${esc(p.developer)}</span>` : ''}${p.launched ? `<span class="dim">since ${esc(p.launched)}</span>` : ''}</div></div>
        <div class="actions">${p.website ? `<a class="chip" href="${esc(p.website)}" target="_blank" rel="noopener">Website ↗</a>` : ''}<a class="chip" href="#/brand?${qs({ name: p.name, website: p.website || '' })}">Ads & socials →</a></div></div>
      <div class="grid g4">
        <div class="card kpi hero"><div class="kicker">Score (SaaS pillars)</div><div class="v">${p.score ?? '–'}</div><div class="r">${esc(p.verdict || '')} · auto-derived</div></div>
        <div class="card kpi"><div class="kicker">Rating</div><div class="v">${p.rating ? '★' + (+p.rating).toFixed(1) : '–'}</div><div class="r">${p.reviews ? p.reviews.toLocaleString() + ' ratings' + ((p.listings || []).length > 1 ? ' across stores' : '') : 'no store ratings found'}</div></div>
        <div class="card kpi"><div class="kicker">${esc(dLabel)}</div><div class="v">${esc(dVal)}</div><div class="r">${ex.batch ? 'YC ' + esc(ex.batch) : ex.comments ? ex.comments + ' comments' : ''}</div></div>
        <div class="card kpi"><div class="kicker">Revenue</div><div class="v" style="font-size:20px">${esc(revText(p) || '–')}</div><div class="r">${p.mrr ? 'verified (TrustMRR)' : p.revenue_text ? 'public figure' : 'not disclosed'}</div></div>
      </div>
      <div class="card section"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h3 style="margin:0">Found on</h3>
        <button class="ghost" id="matchNow">${notMatched ? 'Find store listings & reviews now' : 'Re-check listings & reviews'}</button></div>
        <div class="chips" style="margin-top:10px">${listings.length ? listings.map((l) => `<a class="chip" href="${esc(l.url || '#')}" target="_blank" rel="noopener">${esc(SRC[l.source] || l.source)}${l.reviews ? ` · ★${l.rating ?? '–'} (${num(l.reviews)})` : ''} ↗</a>`).join('') : `<span class="muted">${notMatched ? 'Not checked yet: the background pass looks up the App Store, Google Play, WordPress.org, Shopify and Hacker News for every product (research first).' : 'No store listings with this website. Reviews come from Hacker News and research only.'}</span>`}</div></div>
      ${ex.why || ex.idea || r.categoryNote ? `<div class="grid g2 section">
        ${ex.why || ex.idea ? `<div class="card"><h3>Research notes</h3>${ex.why ? `<p style="font-size:14px">${esc(ex.why)}</p>` : ''}${ex.idea ? `<div class="kicker" style="margin-top:12px">The play</div><p style="margin-top:4px">${esc(ex.idea)}</p>` : ''}${ex.customer ? `<div class="kicker" style="margin-top:12px">Customer</div><p style="margin-top:4px">${esc(ex.customer)}</p>` : ''}</div>` : ''}
        ${r.categoryNote ? `<div class="card"><h3>${esc(p.category)}: the market</h3><p class="muted">${esc(r.categoryNote.how_segments_coexist || '')}</p>${r.categoryNote.pattern ? `<div class="kicker" style="margin-top:10px">Common complaint</div><p>${esc(r.categoryNote.pattern)}</p>` : ''}</div>` : ''}</div>` : ''}
      <div id="planBox">${planHTML(plan, p)}</div>
      <div class="section" id="rvx"></div>
      <div class="grid g3 section">
        <div class="card"><h3>Pillars</h3>${p.pillars ? bars(PILLARS.map(([k, w]) => [`${k} ×${w}`, p.pillars[k]])) : '<p class="muted">Not scored yet.</p>'}
          <details class="method"><summary>How these are derived</summary><ul><li><b>Demand</b>: store ratings and installs, verified MRR, Zapier partner tier and category rank, YC team size, HN points.</li><li><b>Pain</b>: share of 1–2★ ratings, complaints and negative reviews.</li><li><b>Switch</b>: how much of the criticism is fixable (price, bugs, support, UX, dark patterns, missing features); research verdict for researched products.</li><li><b>Build</b>: category difficulty or the research MVP estimate.</li><li><b>Recurring / monetization</b>: pricing model, entry price, revenue.</li></ul><p>Gate: strong only if demand, pain, switch and build are all ≥3, monetization ≥3, and there is real evidence (ratings, 10+ reviews, revenue or a sourced research verdict).</p></details></div>
        <div class="card"><h3>Pricing & facts</h3><div class="list">${[['Pricing', p.pricing], ['Entry price', p.price_min ? '$' + p.price_min + '/mo' : p.free_plan ? 'Free plan' : null], ['Model', p.model], ['Launched', p.launched], ['Customer', ex.customer], ['YC batch', ex.batch], ['Zapier partner', ex.zapTier], ['MRR growth (30d)', ex.growthMRR30d != null ? Math.round(ex.growthMRR30d) + '%' : null]].filter((x) => x[1]).map(([k, v]) => `<div class="item" style="display:flex;justify-content:space-between;gap:10px;padding:6px 0"><span class="muted">${k}</span><span style="text-align:right">${esc(v)}</span></div>`).join('') || '<p class="muted">No pricing on record.</p>'}</div></div>
        <div class="card"><h3>Ratings</h3>${st && totalStars ? `<div class="bars">${[5, 4, 3, 2, 1].map((k) => `<div class="bar"><span>${k} ★</span><span class="track"><i style="width:${((+st[k] || 0) / hmax) * 100}%;background:${k <= 2 ? 'var(--bad)' : k === 3 ? 'var(--warn)' : 'var(--accent)'}"></i></span><span>${num(+st[k] || 0)}</span></div>`).join('')}</div>` : '<p class="muted">No star breakdown yet.</p>'}</div>
      </div>
      ${r.problems?.length ? `<div class="section"><h2>Problem statements that name it</h2><div class="grid g2">${r.problems.map(problemCard).join('')}</div></div>` : ''}
      ${r.peers?.length ? `<div class="section"><h2>Others in ${esc(p.category)} <a href="#/s-all?${qs({ cat: p.category })}" style="font-size:13px;font-weight:500">See all →</a></h2><div class="table-wrap"><table><thead><tr><th>Product</th><th class="num">Score</th><th>Verdict</th><th class="num">Complaints</th><th>Price</th><th>Revenue</th></tr></thead><tbody>${r.peers.map((x) => `<tr data-href="${itemHref(x)}"><td><div class="appcell">${pIcon(x)}<div><b>${esc(x.name)}</b><small>${esc(String(x.description || '').slice(0, 70))}</small></div></div></td><td class="num">${x.score ?? '–'}</td><td>${pill(x.verdict, SV[x.verdict])}</td><td class="num">${x.neg || '–'}</td><td style="font-size:12px">${esc(priceText(x).slice(0, 40) || '–')}</td><td style="font-size:12px">${esc(revText(x).slice(0, 40) || '–')}</td></tr>`).join('')}</tbody></table></div></div>` : ''}
      <div class="section"><h2>Brand: socials, ads & Hacker News</h2><div id="brandBits">${p.website ? loading() : '<div class="empty">No website on record.</div>'}</div></div>`;
    reviewExplorer($('#rvx'), reviews, p);
    view.querySelectorAll('tr[data-href]').forEach((tr) => (tr.onclick = () => go(tr.dataset.href)));
    $('#matchNow').onclick = async (e) => {
      e.target.disabled = true;
      e.target.innerHTML = '<span class="spin"></span>Searching App Store, Google Play, WordPress, Shopify, Hacker News… (about a minute)';
      try { await api(`/api/s2/match?key=${encodeURIComponent(p.key)}`, { method: 'POST' }); viewItem(_, q); }
      catch (err) { e.target.textContent = `Failed: ${err.message}`; }
    };
    if (p.website || p.name) renderBrandBits($('#brandBits'), { name: p.name, adQuery: p.name, website: p.website || '' });
  }

  function reviewExplorer(el, all, p) {
    const isNeg = (r) => (r.stars == null ? true : r.stars <= 2);
    const S = { tab: all.some(isNeg) ? 'negative' : 'all', q: '', src: '', shown: 15 };
    const groups = { all: () => true, negative: isNeg, neutral: (r) => r.stars === 3, positive: (r) => r.stars >= 4 };
    const BY_KEY = { research: 'Research', wp: 'WordPress.org', atl: 'Atlassian', shopify: 'Shopify App Store', ios: 'App Store', gp: 'Google Play', hn: 'Hacker News' };
    const originOf = (r) => r.origin || BY_KEY[String(r.key || '').split(':')[0]] || 'Store';
    const origins = [...new Set(all.map(originOf))];
    const draw = () => {
      const t = S.q.toLowerCase();
      const rows = all.filter(groups[S.tab]).filter((r) => !S.src || originOf(r) === S.src).filter((r) => !t || (r.text || '').toLowerCase().includes(t));
      const counts = Object.fromEntries(Object.entries(groups).map(([k, f]) => [k, all.filter(f).length]));
      el.innerHTML = `<h2>Reviews & complaints <span class="pill">${all.length} collected</span></h2>
        ${!all.length ? `<div class="empty">No reviews collected yet. Use “Find store listings & reviews now” above, or wait for the background pass.</div>` : `
        <div class="grid g2"><div class="card"><h3>Themes in critical reviews</h3><div class="list">${(p.themes || []).filter((x) => x.k !== 'praise').sort((a, b) => b.n - a.n).map((x) => `<div class="item"><div style="display:flex;justify-content:space-between"><span class="t">${esc(x.label)}</span><span class="muted">${x.n} · ${Math.round(x.share * 100)}%</span></div>${x.example ? `<div class="s">“${esc(x.example)}”</div>` : ''}</div>`).join('') || '<p class="muted">No dominant complaint theme.</p>'}</div></div>
        <div class="card"><div class="controls" style="margin-bottom:10px"><div class="seg" id="rvt">${Object.keys(groups).map((k) => `<button data-v="${k}" class="${S.tab === k ? 'on' : ''}">${k[0].toUpperCase() + k.slice(1)} ${counts[k]}</button>`).join('')}</div>
          ${origins.length > 1 ? `<select id="rvo"><option value="">All sources</option>${origins.map((o) => `<option ${S.src === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>` : ''}
          <input class="input" id="rvs" placeholder="Search reviews" value="${esc(S.q)}" style="flex:1;min-width:120px"></div>
          <div class="list">${rows.slice(0, S.shown).map((r) => `<div class="item"><div style="display:flex;justify-content:space-between;gap:8px"><span class="stars">${r.stars ? '★'.repeat(r.stars) + `<span style="color:var(--line-2)">${'★'.repeat(5 - r.stars)}</span>` : '<span class="pill low">complaint</span>'} <span class="pill" style="font-size:10px">${esc(originOf(r))}</span></span><span class="dim">${esc(r.date || '')}${r.author ? ' · ' + esc(r.author).slice(0, 40) : ''}</span></div><div class="s" style="color:var(--text)">${esc(r.text)}</div>${r.url ? `<div class="s">${ext(r.url, host(r.url))}</div>` : ''}</div>`).join('') || '<p class="muted">No reviews match.</p>'}</div>
          ${rows.length > S.shown ? `<button class="ghost wide" id="rvm" data-auto style="margin-top:10px">Show more (${rows.length - S.shown})</button>` : ''}</div></div>`}`;
      el.querySelector('#rvt')?.addEventListener('click', (e) => { if (e.target.dataset.v) { S.tab = e.target.dataset.v; S.shown = 15; draw(); } });
      const o = el.querySelector('#rvo');
      if (o) o.onchange = () => { S.src = o.value; draw(); };
      const inp = el.querySelector('#rvs');
      if (inp) inp.oninput = () => { S.q = inp.value; draw(); const n2 = el.querySelector('#rvs'); n2.focus(); n2.setSelectionRange(n2.value.length, n2.value.length); };
      el.querySelector('#rvm')?.addEventListener('click', () => { S.shown += 30; draw(); });
    };
    draw();
  }

  async function viewSources() {
    const r = await api('/api/s2/sources?_=' + Date.now());
    const ALL = [
      ['research', 'Your research (SaaS Database export)', 'data/idea-hunter'],
      ['trustmrr', 'TrustMRR · verified revenue', r.keys.trustmrr ? 'API key set: all startups' : 'Free feed (50). Add TRUSTMRR_API_KEY for all'],
      ['atl', 'Atlassian Marketplace · paid apps', 'Official REST API, weekly'],
      ['atl-reviews', 'Atlassian reviews', 'Most-reviewed first, monthly per app'],
      ['wp', 'WordPress.org plugins (≥2K installs)', 'Official API, weekly'],
      ['wp-reviews', 'WordPress reviews', 'Review RSS per plugin, monthly'],
      ['yc', 'Y Combinator · active software companies', 'yc-oss open dataset (rebuilt daily from YC\'s directory), every 3 days'],
      ['zap', 'Zapier app directory · ~10K SaaS in ~90 categories', 'Category pages weekly (most popular first), then every app page (~1.5 s each)'],
      ['zap-pages', 'Zapier · app pages (long tail)', 'Fills in apps beyond each category’s top list'],
      ['listings', 'Store listings & reviews finder', 'Matches each SaaS (research first) to its App Store, Google Play, WordPress.org and Shopify listings by website, plus critical Hacker News comments'],
      ['hn', 'Hacker News · Show HN product launches (≥80 points, 3 years; open-source repos excluded)', 'Algolia API, daily'],
      ['ph', 'Product Hunt · top launches (12 months)', r.keys.ph ? 'Token set' : 'Add PH_TOKEN (free) to enable'],
      ['shopify-sitemap', 'Shopify App Store · app list', 'Sitemap, weekly'],
      ['shopify', 'Shopify App Store · app pages', '~1.5 s per page; full pass ≈ 12 h, then every 21 days'],
      ['shopify-reviews', 'Shopify reviews (1★, 2★, 3★ and newest)', 'Most-reviewed first, monthly per app'],
    ];
    const on = new Set(r.enabled || []);
    const shown = ALL.filter(([k]) => !r.enabled || k === 'listings' || on.has(k.replace(/-.*$/, '')));
    const st = Object.fromEntries(r.states.map((s) => [s.source, s]));
    const cnt = (k) => r.counts[k.replace(/-.*$/, '')];
    view.innerHTML = `<div class="view-head"><div><h1>SaaS sources</h1><p>${r.running ? '<span class="spin"></span>Sync running in the background. ' : ''}${Object.values(r.counts).reduce((a, b) => a + b.n, 0).toLocaleString()} products · ${r.reviews.toLocaleString()} reviews collected. Sync runs on start and every 6 hours while the app is open.</p></div><button class="primary" id="ssync" ${r.running ? 'disabled' : ''}>Sync now</button></div>
      <div class="table-wrap"><table><thead><tr><th>Source</th><th class="num">Products</th><th>Status</th><th>Progress</th><th>Last success</th><th>Last error</th></tr></thead><tbody>
      ${shown.map(([k, label, note]) => { const s = st[k] || {}; const c = cnt(k); return `<tr style="cursor:default"><td style="white-space:normal;min-width:220px"><b>${esc(label)}</b><div class="dim" style="font-size:12px">${esc(note)}</div></td><td class="num">${k.includes('-') ? '' : c ? c.n.toLocaleString() : '–'}${k === 'shopify' && c ? `<div class="dim" style="font-size:11px">${c.detailed.toLocaleString()} detailed</div>` : ''}</td><td>${pill(s.status || 'not run', { ok: 'high', running: 'medium', error: 'low', off: '' }[s.status] || '')}</td><td class="muted" style="white-space:normal;max-width:320px">${esc(s.progress || '')}</td><td class="muted">${s.last_ok ? fmtDate(s.last_ok) : '–'}</td><td style="white-space:normal;max-width:260px" class="err">${esc(s.last_error || '')}${s.last_error_at ? `<div class="dim">${fmtDate(s.last_error_at)}</div>` : ''}</td></tr>`; }).join('')}
      </tbody></table></div>
      <p class="dim" style="margin-top:10px;font-size:12px">Not used on purpose: G2, Capterra and Trustpilot (they block automated access and their terms forbid it). Your research agents' findings from those sites are included through the research export.</p>`;
    $('#ssync').onclick = async () => { await api('/api/s2/sync', { method: 'POST' }); setTimeout(() => viewSources(), 1200); };
    if (r.running) setTimeout(() => { if (location.hash.startsWith('#/s-sources')) viewSources(); }, 10_000);
  }

  return {
    routes: {
      's-clone': (p, q) => viewLive(p, q, 'clone'),
      's-all': (p, q) => viewLive(p, q, 'all'),
      's-item': viewItem,
      's-sources': viewSources,
      // Research DB is merged into All SaaS; old links redirect.
      's-research': (p, q) => location.replace(`#/s-clone?${qs({ rverdict: 'clone,gap', ...q })}`),
      's-products': (p, q) => location.replace(`#/s-all?${qs({ ...q, rverdict: q.verdict || q.rverdict, verdict: '' })}`),
      's-product': (parts) => location.replace(`#/s-item?key=${encodeURIComponent('research:' + parts[1])}`),
      's-problems': viewProblems,
      's-ideas': viewSaasIdeas,
      's-cats': viewCategories,
      's-complaints': viewComplaints,
      's-avoid': viewAvoid,
      's-startups': viewStartups,
      appideas: viewAppIdeas,
    },
    fav,
  };
}
