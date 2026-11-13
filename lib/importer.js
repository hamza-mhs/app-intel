// AppGoblin bulk catalog import (CC BY 4.0, https://appgoblin.info).
// Default source: the free public GitHub files (no account needed), ~3.1M live apps:
//   live_store_apps.tsv.xz     names, category, developer id, price, IAP, ads, dates
//   store_apps_metrics.tsv.xz  installs, rating count  (same row order as live_store_apps)
// Only apps with traction are kept: ≥ IMPORT_MIN_RATINGS ratings or ≥ IMPORT_MIN_INSTALLS installs
// (defaults 10 / 1,000 → ~1.1M apps). Also accepts the full metrics file from appgoblin.info.
import fs from 'node:fs';
import { Readable } from 'node:stream';
import xz from 'xz-decompress';
import { db, upsertRow, tx, kvGet, kvSet } from './db.js';

const { XzReadableStream } = xz;
const BASE = process.env.APPGOBLIN_BASE || 'https://github.com/appgoblin-dev/appgoblin-data/raw/main/data';
const MIN_R = +(process.env.IMPORT_MIN_RATINGS ?? 10);
const MIN_I = +(process.env.IMPORT_MIN_INSTALLS ?? 1000);
let running = null;

// "health_and_fitness" → "Health & Fitness", "game_role_playing" → "Role Playing" (matches store genre names).
export function prettyCategory(c) {
  if (!c || c === '\\N') return null;
  return String(c).replace(/^game_/, '').split('_').map((w) => (w === 'and' ? '&' : w[0].toUpperCase() + w.slice(1))).join(' ');
}

async function lines(source) {
  let stream;
  if (/^https?:/.test(source)) {
    const res = await fetch(source, { redirect: 'follow' });
    if (!res.ok) throw new Error(`Download failed (${res.status}) for ${source}`);
    stream = res.body;
  } else stream = Readable.toWeb(fs.createReadStream(source));
  if (source.endsWith('.xz')) stream = new XzReadableStream(stream);
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let done = false;
  const queue = [];
  return async function next() {
    while (!queue.length && !done) {
      const r = await reader.read();
      if (r.value) buf += r.value;
      if (r.done) { done = true; if (buf) queue.push(buf); buf = ''; break; }
      const parts = buf.split('\n');
      buf = parts.pop();
      queue.push(...parts);
    }
    return queue.length ? queue.shift() : null;
  };
}

const num = (s) => (s == null || s === '' || s === '\\N' ? null : Number.isFinite(+s) ? +s : null);
const bool = (s) => (s == null || s === '' || s === '\\N' ? null : /^(t|true|1|yes)$/i.test(s) ? 1 : 0);
const str = (s) => (s && s !== '\\N' ? s : null);
const storeOf = (s, id) => (/^apple|ios|^2$/i.test(s) ? 'ios' : /google|android|^1$/i.test(s) ? 'android' : /^\d+$/.test(id) ? 'ios' : 'android');

export function importStatus() {
  const n = db.prepare("SELECT count(*) n FROM catalog WHERE source='appgoblin'").get().n;
  return { running: Boolean(running), imported: n, progress: kvGet('import_progress'), last: kvGet('import_last') };
}

const hash = (str) => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

// sources: { live, metrics } (URLs or paths). With both, metrics is read first into compact typed arrays
// (the xz decoder can't run two streams at once), then joined to live_store_apps by row index, with an
// id hash check on every row. With only one file (e.g. the full appgoblin.info metrics export), it's read alone.
export function importAppGoblin({ live = `${BASE}/live_store_apps.tsv.xz`, metrics = `${BASE}/store_apps_metrics.tsv.xz`, log = console.log } = {}) {
  if (running) return running;
  running = (async () => {
    const started = Date.now();
    let seen = 0, kept = 0, misaligned = 0;
    let mInst = null, mRat = null, mHash = null, mCount = 0;
    const header = (line) => Object.fromEntries(line.split('\t').map((h, i) => [h.trim(), i]));

    if (live && metrics) {
      kvSet('import_progress', 'downloading install & rating counts (1/2)…');
      const next = await lines(metrics);
      const M = header(await next());
      let cap = 4_000_000;
      mInst = new Float64Array(cap); mRat = new Float64Array(cap); mHash = new Uint32Array(cap);
      for (let l; (l = await next()) != null;) {
        if (!l) continue;
        const c = l.split('\t');
        if (mCount === cap) { cap *= 2; const g = (A, B) => { const n = new A(cap); n.set(B); return n; }; mInst = g(Float64Array, mInst); mRat = g(Float64Array, mRat); mHash = g(Uint32Array, mHash); }
        mInst[mCount] = num(c[M.installs] ?? c[M.total_installs]) ?? -1;
        mRat[mCount] = num(c[M.rating_count] ?? c[M.total_ratings]) ?? -1;
        mHash[mCount] = hash(c[M.store_id] || '');
        mCount++;
        if (mCount % 200000 === 0) { kvSet('import_progress', `reading counts: ${mCount.toLocaleString()} apps (1/2)`); await new Promise((r) => setImmediate(r)); }
      }
    }

    kvSet('import_progress', live ? 'downloading app names & categories (2/2)…' : 'reading file…');
    const next = await lines(live || metrics);
    const L = header(await next());
    let row = -1;
    let batch = [];
    // Write each batch in its own short, synchronous transaction. Never hold a transaction open
    // across an await: the crawl and API write to the same database meanwhile.
    const flush = () => { if (batch.length) { const b = batch; batch = []; tx(() => b.forEach(upsertRow)); } };
    try {
      for (let l; (l = await next()) != null;) {
        if (!l) continue;
        row++;
        const c = l.split('\t');
        const id = c[L.store_id];
        if (!id) continue;
        seen++;
        let installs, ratings, rating = null;
        if (mInst) {
          if (row < mCount && mHash[row] === hash(id)) { installs = mInst[row] < 0 ? null : mInst[row]; ratings = mRat[row] < 0 ? null : mRat[row]; }
          else { misaligned++; installs = ratings = null; }
        } else {
          installs = num(c[L.installs] ?? c[L.total_installs]);
          ratings = num(c[L.rating_count] ?? c[L.total_ratings]);
          rating = num(c[L.rating]);
        }
        if (!((ratings ?? 0) >= MIN_R || (installs ?? 0) >= MIN_I)) continue;
        batch.push({
          store: storeOf(c[L.store], id), id,
          name: str(c[L.app_name]), developer: null, developer_id: str(c[L.developer_id])?.replace(/\.0$/, '') ?? null,
          category: prettyCategory(c[L.app_category]), price: num(c[L.price]),
          ad_supported: bool(c[L.ad_supported]), iap: bool(c[L.in_app_purchases]),
          installs, ratings, rating, released: str(c[L.release_date]), updated: str(c[L.store_last_updated]), source: 'appgoblin',
        });
        kept++;
        if (batch.length >= 5000) {
          flush();
          if (kept % 20000 === 0) kvSet('import_progress', `importing: ${kept.toLocaleString()} apps with traction (of ${seen.toLocaleString()} read)`);
          await new Promise((r) => setImmediate(r)); // keep the server responsive
        }
      }
      flush();
    } catch (e) {
      kvSet('import_progress', `error: ${e.message}`);
      log(`AppGoblin import failed: ${e.message}`);
      throw e;
    }
    const msg = `done: ${kept.toLocaleString()} apps with traction imported (of ${seen.toLocaleString()}) in ${Math.round((Date.now() - started) / 1000)}s${misaligned ? `, ${misaligned} rows without counts` : ''}`;
    kvSet('import_progress', msg);
    kvSet('import_last', new Date().toISOString());
    log(`AppGoblin import ${msg}`);
  })().finally(() => (running = null));
  return running;
}
