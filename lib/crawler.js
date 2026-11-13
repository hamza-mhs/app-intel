// Daily discovery crawl: every category × free/paid/grossing × country, both stores, then an expansion pass.
// Records chart ranks (for rising / new / hidden earners) and keeps the catalog fresh.
// App Store and Google Play run in parallel (separate hosts, separate rate limits).
import * as ios from './ios.js';
import * as android from './android.js';
import { recordRanks, upsertApps, staleOrMissing, chartDoneOn, kvGet, kvSet } from './db.js';

// Charts that failed today are not retried until tomorrow (e.g. Play "paid" charts that the scraper can't parse).
const failKey = (day, j) => `crawl_failed:${day}:${j.store}:${j.country}:${j.chart}:${j.category}`;
const failedToday = (day, j) => kvGet(failKey(day, j)) != null;
const markFailed = (day, j, msg) => kvSet(failKey(day, j), msg.slice(0, 200));
import { expand } from './expand.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);
let running = null;

export const crawlConfig = () => ({
  countries: (process.env.CRAWL_COUNTRIES || 'us').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  stores: (process.env.CRAWL_STORES || 'ios,android').split(',').map((s) => s.trim()),
  charts: ['grossing', 'free', 'paid'],
  expand: process.env.CRAWL_EXPAND !== '0',
});

export function crawlStatus() {
  return { running: Boolean(running), progress: kvGet('crawl_progress'), lastRun: kvGet('crawl_last'), config: crawlConfig() };
}

export function crawl({ log = console.log, expandOnly = false } = {}) {
  if (running) return running;
  if (expandOnly) {
    running = (async () => {
      const { countries, stores } = crawlConfig();
      for (const country of countries) await expand({ country, stores, log });
      kvSet('crawl_progress', 'done · expansion done');
    })().finally(() => (running = null));
    return running;
  }
  running = (async () => {
    const { countries, stores, charts, expand: doExpand } = crawlConfig();
    const day = today();
    const iosCats = ['', ...Object.keys(ios.IOS_GENRES).filter(Boolean)]; // overall chart first
    const playCats = ['', ...android.PLAY_CATEGORIES.filter((c) => !['APPLICATION', 'ANDROID_WEAR', 'LIBRARIES_AND_DEMO', 'WATCH_FACE'].includes(c))];
    const jobsFor = (store) => countries.flatMap((country) => (store === 'ios' ? iosCats : playCats).flatMap((category) => charts.map((chart) => ({ store, country, category, chart }))));
    const prog = { ios: 0, android: 0 };
    const total = { ios: stores.includes('ios') ? jobsFor('ios').length : 0, android: stores.includes('android') ? jobsFor('android').length : 0 };
    let failed = 0, detailFetches = 0;
    const show = (j) => kvSet('crawl_progress', `charts · App Store ${prog.ios}/${total.ios} · Google Play ${prog.android}/${total.android} · now ${j.store} ${j.category || 'all'} ${j.chart}`);

    const runIos = async () => {
      for (const j of jobsFor('ios')) {
        if (chartDoneOn(day, j) || failedToday(day, j)) { prog.ios++; continue; } // resume after a restart
        show(j);
        try {
          const { apps } = await ios.chart({ chart: j.chart, country: j.country, genre: j.category, limit: 200 });
          upsertApps(apps);
          recordRanks({ day, ...j, ids: apps.map((a) => a.id) });
        } catch (e) { failed++; markFailed(day, j, e.message); log(`crawl: ios ${j.country} ${j.category || 'all'} ${j.chart} failed: ${e.message}`); }
        prog.ios++;
        await sleep(5_000); // RSS + up to 2 lookup calls per chart stays under ~20 req/min
      }
    };
    const runPlay = async () => {
      for (const j of jobsFor('android')) {
        if (chartDoneOn(day, j) || failedToday(day, j)) { prog.android++; continue; }
        show(j);
        try {
          const list = await android.listChart({ chart: j.chart, country: j.country, category: j.category, num: 100 });
          const ids = list.map((a) => a.appId);
          upsertApps(list.map((a) => android.normalize(a)));
          recordRanks({ day, ...j, ids });
          for (const id of staleOrMissing('android', ids).slice(0, +process.env.CRAWL_DETAILS_PER_CHART || 25)) {
            try { upsertApps([android.normalize(await android.detailsFor(id, j.country))]); detailFetches++; } catch {}
            await sleep(700);
          }
        } catch (e) { failed++; markFailed(day, j, e.message); log(`crawl: android ${j.country} ${j.category || 'all'} ${j.chart} failed: ${e.message}`); }
        prog.android++;
        await sleep(1_000);
      }
    };
    await Promise.all([stores.includes('ios') && runIos(), stores.includes('android') && runPlay()].filter(Boolean));
    kvSet('crawl_last', new Date().toISOString());
    const summary = `charts done: ${prog.ios + prog.android - failed}/${total.ios + total.android}, ${detailFetches} Play detail pages, ${failed} failed`;
    log(`crawl ${summary}`);
    if (doExpand) for (const country of countries) await expand({ country, stores, log });
    kvSet('crawl_progress', `done · ${summary}${doExpand ? ' · expansion done' : ''}`);
  })().finally(() => (running = null));
  return running;
}
