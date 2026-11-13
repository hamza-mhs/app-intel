// Instagram posts & reels of ANY business/creator account via Meta's official Business Discovery API (free).
// Requirements: your own Instagram professional account linked to a Facebook Page, a Meta app, and a
// user access token with instagram_basic + pages_show_list (+ business_management if asked).
//   IG_USER_ID = your IG professional account id, IG_TOKEN = that token (META_TOKEN is used if unset).
// Limits: personal (non-professional) and age-gated accounts return nothing.
import { getJSON } from './http.js';

const VER = process.env.META_API_VERSION || 'v25.0';
const MEDIA = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count,view_count';

export const igConfigured = () => Boolean(process.env.IG_USER_ID && (process.env.IG_TOKEN || process.env.META_TOKEN));

export async function igProfile(username) {
  if (!igConfigured()) return { configured: false };
  const handle = String(username).replace(/^@/, '').trim();
  const fields = `business_discovery.username(${handle}){username,name,biography,website,followers_count,follows_count,media_count,profile_picture_url,media.limit(30){${MEDIA}}}`;
  const url = `https://graph.facebook.com/${VER}/${process.env.IG_USER_ID}?fields=${encodeURIComponent(fields)}&access_token=${process.env.IG_TOKEN || process.env.META_TOKEN}`;
  let j;
  try {
    j = await getJSON(url, { ttl: 3 * 3600_000 });
  } catch (e) {
    let msg = e.message;
    try { msg = JSON.parse(e.body).error.message; } catch {}
    return { configured: true, error: msg };
  }
  const p = j.business_discovery || {};
  const media = (p.media?.data || []).map((m) => ({
    id: m.id,
    caption: m.caption || '',
    type: m.media_product_type === 'REELS' ? 'Reel' : m.media_type === 'CAROUSEL_ALBUM' ? 'Carousel' : m.media_type === 'VIDEO' ? 'Video' : 'Post',
    url: m.permalink,
    date: m.timestamp,
    likes: m.like_count ?? null,
    comments: m.comments_count ?? null,
    views: m.view_count ?? null,
  }));
  const eng = media.filter((m) => m.likes != null);
  const avgEng = eng.length ? eng.reduce((s, m) => s + m.likes + (m.comments || 0), 0) / eng.length : null;
  const days = media.length > 1 ? (Date.parse(media[0].date) - Date.parse(media[media.length - 1].date)) / 864e5 : null;
  return {
    configured: true,
    username: p.username, name: p.name, bio: p.biography, website: p.website,
    followers: p.followers_count, following: p.follows_count, posts: p.media_count, avatar: p.profile_picture_url,
    media,
    stats: {
      avgEngagement: avgEng,
      engagementRate: avgEng && p.followers_count ? avgEng / p.followers_count : null,
      postsPerWeek: days ? +((media.length / days) * 7).toFixed(1) : null,
      reelShare: media.length ? media.filter((m) => m.type === 'Reel').length / media.length : null,
    },
  };
}
