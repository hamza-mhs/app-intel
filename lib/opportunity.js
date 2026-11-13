// "Worth building" scoring: proven demand + a beatable incumbent + a buildable niche.
// Inputs are only what the daily crawl and catalog know (chart ranks, ratings, update dates,
// IAP/ads flags, our revenue estimate). Review-based angles are added on demand in the UI.
import { db, LATEST } from './db.js';
import { estimate } from '../public/estimate.js';

const DAY = 864e5;
const clamp = (x, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
const log10 = (x) => Math.log10(Math.max(1, x));

// Buildability by category: network effects, licensed content, inventory or regulation make a niche hard
// for a small team regardless of how weak the incumbent is.
const HARD = /social|dating|communication|messag|music|shopping|navigation|travel|news|entertainment|books|comics|finance|medical|auto|house|events|game|casino|kids|family|sports/i;
// Google Play labels games by sub-genre only ("Simulation", "Casual"…), so match those names exactly.
const PLAY_GAME = /^(action|adventure|arcade|board|card|casino|casual|educational|puzzle|racing|role playing|simulation|strategy|trivia|word)$/i;
const GOOD = /utilit|tools|productiv|health|fitness|lifestyle|education|photo|video|graphics|design|art|business|food|drink|weather|reference|personaliz|developer|parenting|beauty/i;
const HARD_NOTE = {
  social: 'needs network effects', dating: 'needs network effects', communication: 'needs network effects', messag: 'needs network effects', music: 'needs content licensing', shopping: 'needs inventory/marketplace',
  navigation: 'needs map data', travel: 'needs inventory/partners', news: 'needs content', entertainment: 'needs content', books: 'needs content',
  comics: 'needs content', finance: 'regulated money handling', medical: 'regulated health claims', game: 'game dev is a different craft',
  casino: 'gambling regulation', sports: 'needs data/licensing',
};
const BIG = /\b(meta|facebook|instagram|whatsapp|google|alphabet|microsoft|apple|amazon|bytedance|tiktok|spotify|netflix|snap|x corp|twitter|tencent|disney|uber|airbnb|adobe|linkedin|pinterest|reddit|paypal|samsung|yahoo|zoom|canva|duolingo|openai|anthropic|telegram|discord|roblox|epic games|king|supercell|playrix|zynga|electronic arts|activision|niantic|tinder|match group|bumble)\b/i;

function buildability(category, developer, devAppCount, isGame) {
  const c = String(category || '');
  const hard = isGame || HARD.test(c) || PLAY_GAME.test(c);
  let score = hard ? 20 : GOOD.test(c) ? 90 : 60;
  const notes = [];
  if (isGame || PLAY_GAME.test(c)) notes.push('Hard niche: game dev is a different craft');
  else if (HARD.test(c)) {
    const k = Object.keys(HARD_NOTE).find((x) => c.toLowerCase().includes(x));
    notes.push(`Hard niche: ${HARD_NOTE[k] || 'structural barriers'}`);
  }
  if (BIG.test(developer || '')) { score -= 50; notes.push('Big-tech publisher: brand and budget moat'); }
  else if (devAppCount >= 8) { score -= 20; notes.push(`Large publisher (${devAppCount} apps in charts)`); }
  return { score: clamp(score), notes };
}

export function scoreApp(a, ctx) {
  const now = ctx.now || Date.now();
  const e = estimate(a);
  const rev = e.revenue.monthly.mid;
  // Demand: grossing rank (strongest public revenue signal), our revenue estimate, audience size.
  const rankScore = a.grossingRank ? clamp(100 * (1 - Math.log(a.grossingRank) / Math.log(250))) : 0;
  const revScore = clamp(((log10(rev) - 3) / 3) * 100); // $1K → 0, $1M → 100
  const audScore = clamp(((log10(a.ratingsCount) - 2) / 4) * 100); // 100 → 0, 1M → 100
  const demand = 0.7 * Math.max(rankScore, revScore) + 0.3 * audScore;
  // Weakness: rating gap, staleness, ad load.
  const ratingGap = a.rating ? clamp(((4.7 - a.rating) / 1.2) * 100) : 40;
  // Only trust update dates fetched live from the store; the bulk catalog's dates can be a year old.
  const daysStale = a.updated && a.liveUpdated ? (now - Date.parse(a.updated)) / DAY : null;
  const stale = daysStale == null ? 30 : clamp(((daysStale - 60) / 300) * 100);
  const weakness = clamp(0.6 * ratingGap + 0.4 * stale + (a.adSupported ? 15 : 0));
  // Competition: strong rivals (≥4.5★, ≥10K ratings) in the same category's top-50 grossing.
  const rivals = ctx.strongRivals.get(`${a.store}|${a.genre}`) ?? 0;
  const competition = clamp(100 * (1 - Math.min(rivals, 15) / 15));
  const build = buildability(a.genre, a.developer, ctx.devCount.get(`${a.store}|${a.developer}`) || 0, a.isGame);
  const monetization = a.offersIAP ? 85 : a.price > 0 ? 65 : a.adSupported ? 40 : a.offersIAP === false ? 20 : 50;
  const total = 0.3 * demand + 0.25 * weakness + 0.15 * competition + 0.2 * build.score + 0.1 * monetization;

  const angles = [];
  if (a.rating && a.rating < 4.3) angles.push({ k: 'quality', t: `Users are unhappy (★${a.rating.toFixed(1)} from ${Math.round(a.ratingsCount).toLocaleString()} ratings): a better-built, better-designed app is the wedge.` });
  if (daysStale > 180) angles.push({ k: 'stale', t: `Not updated in ${Math.round(daysStale / 30)} months: a modern, actively maintained version.` });
  if (a.adSupported) angles.push({ k: 'ads', t: 'Monetizes with ads: an ad-free version with a fair subscription or one-time price.' });
  if (a.grossingRank && a.grossingRank <= 50 && a.ratingsCount < (ctx.p20.get(`${a.store}|${a.genre}`) || 0)) angles.push({ k: 'hidden', t: `Grossing #${a.grossingRank} with a small audience: people in this niche pay.` });
  if (rivals <= 3) angles.push({ k: 'rivals', t: `Only ${rivals} strong rival${rivals === 1 ? '' : 's'} in the category's top-50 grossing.` });
  if (ctx.otherStore && !ctx.otherStore(a)) angles.push({ k: 'platform', t: `No matching ${a.store === 'ios' ? 'Google Play' : 'App Store'} app found in your data: possible platform gap (verify by search).` });
  if (!angles.length) angles.push({ k: 'improve', t: 'Strong product: compete on a narrower segment, better onboarding or lower price rather than head-on.' });

  return {
    ...a, est: { revenue: e.revenue.monthly, mrr: e.revenue.mrr, downloads: { low: e.downloads.low, mid: e.downloads.mid, high: e.downloads.high }, confidence: e.confidence },
    score: Math.round(total),
    parts: { demand: Math.round(demand), weakness: Math.round(weakness), competition: Math.round(competition), buildability: Math.round(build.score), monetization },
    rivals, daysStale: daysStale == null ? null : Math.round(daysStale), angles, cautions: build.notes,
  };
}

// Candidates: everything in the latest crawl's grossing and free charts (all categories) for one store/country.
export function opportunities({ store = 'both', country = 'us', minDemand = 30 } = {}) {
  const stores = store === 'both' ? ['ios', 'android'] : [store];
  const out = [];
  let day = null;
  for (const st of stores) {
    const rows = db.prepare(`WITH ${LATEST}
      SELECT r.chart, r.category AS chart_category, r.rank, r.day AS chart_day, c.* FROM chart_ranks r
      JOIN latest l ON l.store=r.store AND l.country=r.country AND l.chart=r.chart AND l.category=r.category AND l.day=r.day
      JOIN catalog c ON c.store=r.store AND c.id=r.id
      WHERE r.chart IN ('grossing','free')`).all({ $store: st, $country: country });
    if (!rows.length) continue;
    for (const r of rows) if (!day || r.chart_day > day) day = r.chart_day;
    // Merge per app: best grossing rank anywhere; category = the app's own category.
    const apps = new Map();
    for (const r of rows) {
      const a = apps.get(r.id) || {
        store: st, id: r.id, name: r.name, developer: r.developer || '', developerId: r.developer_id, genre: r.category || r.chart_category,
        price: r.price || 0, offersIAP: r.iap == null ? null : !!r.iap, adSupported: !!r.ad_supported, installs: r.installs,
        ratingsCount: r.ratings || 0, rating: r.rating, released: r.released, updated: r.updated, icon: r.icon, iapPrices: [], grossingRank: null, freeRank: null,
        liveUpdated: Boolean(r.live_at), isGame: false,
      };
      if (/^GAME/.test(r.chart_category) || r.chart_category === '6014' || /\bgames?\b/i.test(r.name || '')) a.isGame = true;
      if (r.chart === 'grossing' && (!a.grossingRank || r.rank < a.grossingRank)) a.grossingRank = r.rank;
      if (r.chart === 'free' && (!a.freeRank || r.rank < a.freeRank)) a.freeRank = r.rank;
      apps.set(r.id, a);
    }
    const list = [...apps.values()];
    // Context: strong rivals and ratings 20th percentile per category (top-50 grossing), publisher size.
    const strongRivals = new Map(), p20 = new Map(), devCount = new Map();
    const byCat = {};
    for (const a of list) {
      (byCat[`${st}|${a.genre}`] ||= []).push(a);
      devCount.set(`${st}|${a.developer}`, (devCount.get(`${st}|${a.developer}`) || 0) + 1);
    }
    for (const [k, arr] of Object.entries(byCat)) {
      const top = arr.filter((a) => a.grossingRank && a.grossingRank <= 50);
      strongRivals.set(k, top.filter((a) => a.rating >= 4.5 && a.ratingsCount >= 10_000).length);
      const rs = top.map((a) => a.ratingsCount).filter(Boolean).sort((x, y) => x - y);
      p20.set(k, rs[Math.floor(rs.length * 0.2)] || 0);
    }
    const other = st === 'ios' ? 'android' : 'ios';
    const hasOther = db.prepare(`SELECT 1 FROM catalog WHERE store=? AND name COLLATE NOCASE >= ? AND name COLLATE NOCASE < ? LIMIT 1`);
    const otherStore = (a) => {
      const base = String(a.name || '').split(/[:\-–|]/)[0].trim();
      return base.length < 3 ? true : Boolean(hasOther.get(other, base, base + '￿'));
    };
    const ctx = { strongRivals, p20, devCount, otherStore };
    for (const a of list) {
      const s = scoreApp(a, ctx);
      if (s.parts.demand >= minDemand) out.push(s);
    }
  }
  out.sort((x, y) => y.score - x.score);
  return { day, country, count: out.length, apps: out };
}
