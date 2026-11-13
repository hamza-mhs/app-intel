// Brand socials from free sources:
//  - Social links: scraped from the developer's own website (links in the HTML).
//  - YouTube: public channel RSS feed (no key)            youtube.com/feeds/videos.xml?channel_id=UC…
//  - Bluesky: public AppView API (no key)                 public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed
//  - Hacker News mentions: Algolia HN API (no key)        hn.algolia.com/api/v1/search
//  - Reddit mentions: public search.json (best effort; often rate-limited)
//  Instagram, TikTok, X, Facebook and LinkedIn have no free post API: we return the links only.
import { getText, getJSON, HOUR } from './http.js';

const PATTERNS = {
  instagram: /https?:\/\/(?:www\.)?instagram\.com\/(?!p\/|reel\/|explore\/|accounts\/)([A-Za-z0-9_.]{2,30})/i,
  tiktok: /https?:\/\/(?:www\.)?tiktok\.com\/@([A-Za-z0-9_.]{2,30})/i,
  x: /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/(?!intent|share|home|i\/)([A-Za-z0-9_]{1,15})/i,
  youtube: /https?:\/\/(?:www\.)?youtube\.com\/((?:channel\/UC[\w-]{22})|(?:@[\w.-]+)|(?:c\/[\w.-]+)|(?:user\/[\w.-]+))/i,
  facebook: /https?:\/\/(?:www\.)?facebook\.com\/(?!sharer|share|dialog|tr\b|plugins)([A-Za-z0-9_.-]{2,60})/i,
  linkedin: /https?:\/\/(?:www\.)?linkedin\.com\/(company\/[A-Za-z0-9_-]+)/i,
  threads: /https?:\/\/(?:www\.)?threads\.(?:net|com)\/@([A-Za-z0-9_.]+)/i,
  bluesky: /https?:\/\/bsky\.app\/profile\/([A-Za-z0-9_.:-]+)/i,
  discord: /https?:\/\/(?:www\.)?discord\.(?:gg|com\/invite)\/([A-Za-z0-9-]+)/i,
  reddit: /https?:\/\/(?:www\.)?reddit\.com\/(r\/[A-Za-z0-9_]+)/i,
};

const BASE = {
  instagram: 'https://instagram.com/', tiktok: 'https://tiktok.com/@', x: 'https://x.com/', youtube: 'https://youtube.com/',
  facebook: 'https://facebook.com/', linkedin: 'https://linkedin.com/', threads: 'https://threads.net/@',
  bluesky: 'https://bsky.app/profile/', discord: 'https://discord.gg/', reddit: 'https://reddit.com/',
};

export function normalizeSite(url) {
  if (!url) return null;
  try {
    const u = new URL(/^https?:/.test(url) ? url : `https://${url}`);
    return u.origin;
  } catch {
    return null;
  }
}

export async function findLinks(site) {
  const origin = normalizeSite(site);
  if (!origin) return { site: null, links: {}, error: 'No website' };
  try {
    const html = await getText(origin, { ttl: 24 * HOUR, timeout: 10_000 });
    const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]);
    const links = {};
    for (const [k, re] of Object.entries(PATTERNS)) {
      for (const h of hrefs) {
        const m = h.match(re);
        if (m) {
          links[k] = { handle: m[1], url: BASE[k] + m[1] };
          break;
        }
      }
    }
    return { site: origin, links };
  } catch (e) {
    return { site: origin, links: {}, error: `Could not read ${origin}: ${e.message}` };
  }
}

function xmlTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : null;
}

export async function youtube(handlePath) {
  let channelId = handlePath?.match(/channel\/(UC[\w-]{22})/)?.[1];
  if (!channelId && handlePath) {
    const page = await getText(`https://www.youtube.com/${handlePath}`, { ttl: 24 * HOUR });
    channelId =
      page.match(/"channelId":"(UC[\w-]{22})"/)?.[1] || page.match(/channel\/(UC[\w-]{22})/)?.[1] || null;
  }
  if (!channelId) return { error: 'Channel id not found' };
  const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`, { ttl: 3 * HOUR });
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].slice(0, 12).map(([, e]) => ({
    title: xmlTag(e, 'title'),
    url: e.match(/<link[^>]+href="([^"]+)"/)?.[1],
    published: xmlTag(e, 'published'),
    thumb: e.match(/<media:thumbnail[^>]+url="([^"]+)"/)?.[1],
    views: Number(e.match(/<media:statistics[^>]+views="(\d+)"/)?.[1] || 0) || null,
  }));
  return { channelId, videos };
}

export async function bluesky(handle) {
  const j = await getJSON(
    `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${encodeURIComponent(handle)}&limit=12`,
    { ttl: 3 * HOUR },
  );
  return {
    posts: (j.feed || []).map(({ post }) => ({
      text: post.record?.text,
      date: post.record?.createdAt,
      likes: post.likeCount,
      reposts: post.repostCount,
      replies: post.replyCount,
      url: `https://bsky.app/profile/${post.author?.handle}/post/${post.uri?.split('/').pop()}`,
    })),
  };
}

export async function hnMentions(q) {
  const j = await getJSON(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"${q}"`)}&tags=(story,comment)&hitsPerPage=15`,
    { ttl: 6 * HOUR },
  );
  return (j.hits || []).map((h) => ({
    title: h.title || h.story_title,
    text: (h.comment_text || '').replace(/<[^>]+>/g, ' ').slice(0, 240),
    points: h.points,
    comments: h.num_comments,
    date: h.created_at,
    url: `https://news.ycombinator.com/item?id=${h.objectID}`,
  }));
}

export async function redditMentions(q) {
  const j = await getJSON(`https://www.reddit.com/search.json?q=${encodeURIComponent(`"${q}"`)}&sort=new&limit=15`, {
    ttl: 6 * HOUR,
  });
  return (j.data?.children || []).map(({ data: d }) => ({
    title: d.title,
    sub: d.subreddit_name_prefixed,
    score: d.score,
    comments: d.num_comments,
    date: new Date(d.created_utc * 1000).toISOString(),
    url: `https://www.reddit.com${d.permalink}`,
  }));
}

const settle = (p) => p.then((value) => ({ value }), (e) => ({ error: e.message }));

export async function brandSocials({ website, name }) {
  const found = await findLinks(website);
  const L = found.links;
  const [yt, bs, hn, rd] = await Promise.all([
    L.youtube ? settle(youtube(L.youtube.handle)) : null,
    L.bluesky ? settle(bluesky(L.bluesky.handle)) : null,
    name ? settle(hnMentions(name)) : null,
    name ? settle(redditMentions(name)) : null,
  ]);
  return { ...found, youtube: yt, bluesky: bs, hackerNews: hn, reddit: rd };
}
