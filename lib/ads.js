// Meta Ad Library API (official, free). Requires identity confirmation at facebook.com/ID,
// a Meta developer app, and a user access token (set META_TOKEN).
// Coverage limits (Meta's rules, not ours): commercial ads are only returned if delivered in the
// EU/UK; spend and impressions exist only for political/issue ads. So "spend" below is our guess.
import { getJSON } from './http.js';

const VER = process.env.META_API_VERSION || 'v25.0';
const FIELDS = [
  'id', 'page_id', 'page_name', 'ad_creation_time', 'ad_delivery_start_time', 'ad_delivery_stop_time',
  'ad_creative_bodies', 'ad_creative_link_titles', 'ad_creative_link_descriptions', 'ad_creative_link_captions',
  'ad_snapshot_url', 'publisher_platforms', 'languages', 'eu_total_reach', 'target_ages', 'target_gender',
].join(',');
const COUNTRIES = (process.env.META_COUNTRIES || 'DE,FR,GB,NL,IT,ES,SE,PL').split(',').map((s) => s.trim());

export function adLinks(q, domain) {
  const enc = encodeURIComponent(q || '');
  return {
    meta: `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&q=${enc}&search_type=keyword_unordered&media_type=all`,
    google: domain
      ? `https://adstransparency.google.com/?region=anywhere&domain=${encodeURIComponent(domain)}`
      : 'https://adstransparency.google.com/?region=anywhere',
    tiktok: 'https://library.tiktok.com/ads',
    linkedin: `https://www.linkedin.com/ad-library/search?keyword=${enc}`,
  };
}

export async function metaAds({ q, pageId, status = 'ACTIVE', maxPages = 3 }) {
  const token = process.env.META_TOKEN;
  if (!token) return { configured: false };
  const p = new URLSearchParams({
    access_token: token,
    ad_type: 'ALL',
    ad_active_status: status,
    ad_reached_countries: JSON.stringify(COUNTRIES),
    fields: FIELDS,
    limit: '100',
  });
  if (pageId) p.set('search_page_ids', JSON.stringify([pageId]));
  else {
    p.set('search_terms', q);
    p.set('search_type', 'KEYWORD_UNORDERED');
  }
  let url = `https://graph.facebook.com/${VER}/ads_archive?${p}`;
  const ads = [];
  for (let i = 0; i < maxPages && url; i++) {
    let j;
    try {
      j = await getJSON(url, { ttl: 3_600_000 });
    } catch (e) {
      let msg = e.message;
      try {
        msg = JSON.parse(e.body).error.message;
      } catch {}
      return { configured: true, error: msg, ads };
    }
    ads.push(...(j.data || []));
    url = j.paging?.next || null;
  }
  return { configured: true, countries: COUNTRIES, ads: ads.map(shape), summary: summarize(ads) };
}

function days(a) {
  const start = Date.parse(a.ad_delivery_start_time);
  const end = a.ad_delivery_stop_time ? Date.parse(a.ad_delivery_stop_time) : Date.now();
  return Number.isFinite(start) ? Math.max(1, Math.round((end - start) / 86_400_000)) : null;
}

function shape(a) {
  return {
    id: a.id,
    page: a.page_name,
    pageId: a.page_id,
    body: a.ad_creative_bodies?.[0] || '',
    title: a.ad_creative_link_titles?.[0] || '',
    caption: a.ad_creative_link_captions?.[0] || '',
    started: a.ad_delivery_start_time,
    stopped: a.ad_delivery_stop_time || null,
    daysRunning: days(a),
    platforms: a.publisher_platforms || [],
    reach: a.eu_total_reach ?? null,
    snapshot: a.ad_snapshot_url,
    variants: a.ad_creative_bodies?.length || 1,
  };
}

// Spend guess = reach × frequency × CPM. Meta does not publish commercial spend; these are assumptions.
const FREQ = [1.2, 1.8, 2.5];
const CPM_EUR = [3, 7, 14];

function summarize(raw) {
  const ads = raw.map(shape);
  const byPage = {};
  for (const a of ads) {
    const k = a.page || a.pageId;
    byPage[k] ??= { page: a.page, pageId: a.pageId, ads: 0, reach: 0, longest: 0 };
    byPage[k].ads++;
    byPage[k].reach += a.reach || 0;
    byPage[k].longest = Math.max(byPage[k].longest, a.daysRunning || 0);
  }
  const reach = ads.reduce((s, a) => s + (a.reach || 0), 0);
  const platforms = {};
  ads.forEach((a) => a.platforms.forEach((p) => (platforms[p] = (platforms[p] || 0) + 1)));
  const spend = reach
    ? { low: (reach * FREQ[0] * CPM_EUR[0]) / 1000, mid: (reach * FREQ[1] * CPM_EUR[1]) / 1000, high: (reach * FREQ[2] * CPM_EUR[2]) / 1000 }
    : null;
  return {
    total: ads.length,
    advertisers: Object.values(byPage).sort((a, b) => b.ads - a.ads),
    euReach: reach,
    platforms,
    longestRunning: ads.slice().sort((a, b) => (b.daysRunning || 0) - (a.daysRunning || 0)).slice(0, 5),
    spendGuessEUR: spend,
    spendMethod: `EU/UK reach × frequency ${FREQ.join('/')} × CPM €${CPM_EUR.join('/')} (assumptions). Lifetime of the returned ads, EU/UK only.`,
  };
}
