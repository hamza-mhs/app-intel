import { db, upsertRow, recordRanks } from './db.js';
// Demo data for `npm run demo` (MOCK=1). Fictional apps with realistic shapes, so the UI can be
// explored without network access. Every demo screen shows a "Demo data" banner.
const NAMES = [
  ['Habit Garden', 'Leafy Labs', 'Health & Fitness'], ['Snapnote AI', 'Northwind Apps', 'Productivity'],
  ['Calm Tide', 'Saltwater Studio', 'Health & Fitness'], ['Budget Otter', 'Otterly Finance', 'Finance'],
  ['Pixel Pals', 'Moonbeam Games', 'Games'], ['Lingo Lift', 'Polyglot Inc', 'Education'],
  ['Scan Sprout', 'Paperless Co', 'Business'], ['Fit Forge', 'Ironclad Apps', 'Health & Fitness'],
  ['Dream Diary', 'Night Owl Labs', 'Lifestyle'], ['Plant Pal', 'Greenhouse Dev', 'Lifestyle'],
  ['Focus Fox', 'Quiet Hours', 'Productivity'], ['Recipe Rocket', 'Kitchen Sync', 'Food & Drink'],
  ['Story Spark', 'Inkwell Studio', 'Books'], ['Trail Mate', 'Summit Software', 'Navigation'],
  ['Cleaner Pro', 'Utility Works', 'Utilities'], ['Mood Map', 'Feelwell', 'Health & Fitness'],
  ['Word Weave', 'Moonbeam Games', 'Games'], ['Invoice Ink', 'Paperless Co', 'Business'],
  ['Sleep Sloth', 'Night Owl Labs', 'Health & Fitness'], ['Photo Phoenix', 'Brightframe', 'Photo & Video'],
  ['Chess Sprint', 'Knightly', 'Games'], ['Fast Track', 'Ironclad Apps', 'Health & Fitness'],
  ['Read Ready', 'Inkwell Studio', 'Education'], ['Gym Ghost', 'Ironclad Apps', 'Health & Fitness'],
  ['Voice Vault', 'Northwind Apps', 'Productivity'],
];

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const DAY = 86_400_000;

function mkApp(i, store) {
  const r = rng(i * 97 + (store === 'ios' ? 1 : 2));
  const [name, developer, genre] = NAMES[i % NAMES.length];
  const ageDays = 120 + Math.floor(r() * 2400);
  const scale = Math.pow(10, 2.5 + r() * 3.2) * (1 + (NAMES.length - i) / 8);
  const ratingsCount = Math.round(scale);
  const sub = r() > 0.25;
  const prices = sub ? [4.99, 9.99, 39.99, 59.99].slice(0, 2 + Math.floor(r() * 3)) : [];
  const now = Date.now();
  const cvDays = 5 + Math.floor(r() * 50);
  const base = {
    store,
    id: store === 'ios' ? String(1_400_000_000 + i * 7919) : `com.demo.${name.toLowerCase().replace(/\W+/g, '')}`,
    name, developer,
    developerId: store === 'ios' ? String(900000 + (developer.length * 31)) : developer.replace(/\W/g, ''),
    icon: null,
    url: '#',
    genre,
    price: !sub && r() > 0.7 ? 2.99 : 0,
    currency: 'USD',
    rating: +(3.6 + r() * 1.3).toFixed(2),
    ratingsCount,
    released: new Date(now - ageDays * DAY).toISOString(),
    updated: new Date(now - cvDays * DAY).toISOString(),
    version: `${1 + Math.floor(r() * 6)}.${Math.floor(r() * 10)}.${Math.floor(r() * 10)}`,
    website: `https://${developer.toLowerCase().replace(/\W+/g, '')}.example`,
    description: `${name} is a demo app used to preview the dashboard. All numbers on this screen are fictional.`,
    screenshots: [],
    offersIAP: sub,
    iapPrices: prices,
    demo: true,
  };
  base.free = !base.price;
  if (store === 'ios') {
    Object.assign(base, {
      ratingsCurrentVersion: r() > 0.3 ? Math.round(ratingsCount * (0.02 + r() * 0.08)) : ratingsCount,
      currentVersionReleased: new Date(now - cvDays * DAY).toISOString(),
      installs: null,
    });
  } else {
    const installs = Math.round(ratingsCount * (40 + r() * 120));
    const buckets = [1e3, 5e3, 1e4, 5e4, 1e5, 5e5, 1e6, 5e6, 1e7, 5e7, 1e8];
    const b = buckets.filter((x) => x <= installs).pop() || 100;
    Object.assign(base, {
      installs,
      installsText: `${b.toLocaleString()}+`,
      reviewsCount: Math.round(ratingsCount * 0.3),
      adSupported: r() > 0.6,
      iapRange: prices.length ? `$${prices[0]} - $${prices[prices.length - 1]} per item` : null,
      iapPrices: prices.length ? [prices[0], prices[prices.length - 1]] : [],
      histogram: { 1: Math.round(ratingsCount * 0.08), 2: Math.round(ratingsCount * 0.04), 3: Math.round(ratingsCount * 0.08), 4: Math.round(ratingsCount * 0.2), 5: Math.round(ratingsCount * 0.6) },
    });
  }
  return base;
}

const TEXTS = [
  [5, 'Love it', 'Exactly what I needed, simple and fast.'],
  [2, 'Paywall everywhere', 'Every useful feature needs the subscription now. Too expensive for what it does.'],
  [4, 'Great but', 'Great app, wish it synced with my calendar.'],
  [1, 'Crashes', 'Crashes every time I open the stats tab after the update.'],
  [5, 'Worth paying for', 'Happily pay for this, the yearly plan is fair.'],
  [3, 'Too many ads', 'Ads after every action. Would pay once to remove them.'],
  [2, 'Cancelled', 'Cancelled my subscription, the price went up again.'],
  [4, 'Solid', 'Does the job. Missing a widget.'],
];

function mkReviews(app, n) {
  const r = rng(app.name.length * 13);
  const perDay = 0.5 + r() * 12;
  return Array.from({ length: n }, (_, k) => {
    const [score, title, text] = TEXTS[Math.floor(r() * TEXTS.length)];
    return { author: `user${Math.floor(r() * 9999)}`, score, title, text, date: new Date(Date.now() - (k / perDay) * DAY).toISOString(), version: app.version };
  });
}

function velocity(revs) {
  const ts = revs.map((x) => Date.parse(x.date));
  const span = Math.max(1, (Math.max(...ts) - Math.min(...ts)) / DAY);
  return { sampleSize: revs.length, spanDays: +span.toFixed(1), perDay: +(revs.length / span).toFixed(3) };
}

const CATS_IOS = ['Health & Fitness', 'Productivity', 'Finance', 'Games', 'Education', 'Lifestyle', 'Photo & Video', 'Utilities', 'Business', 'Food & Drink'];
const CATS_PLAY = ['HEALTH_AND_FITNESS', 'PRODUCTIVITY', 'FINANCE', 'GAME_PUZZLE', 'EDUCATION', 'LIFESTYLE', 'PHOTOGRAPHY', 'TOOLS', 'BUSINESS', 'FOOD_AND_DRINK'];
const W1 = ['Habit', 'Calm', 'Budget', 'Pixel', 'Focus', 'Sleep', 'Fit', 'Scan', 'Word', 'Plant', 'Mood', 'Trail', 'Recipe', 'Photo', 'Chess', 'Note', 'Voice', 'Story', 'Lingo', 'Dream'];
const W2 = ['Garden', 'Tide', 'Otter', 'Pals', 'Fox', 'Sloth', 'Forge', 'Sprout', 'Weave', 'Pal', 'Map', 'Mate', 'Rocket', 'Phoenix', 'Sprint', 'Vault', 'Spark', 'Lift', 'Diary', 'Kit'];

export const mock = {
  seedCatalog() {
    if (db.prepare("SELECT count(*) n FROM catalog WHERE source='demo'").get().n) return;
    const r = rng(42);
    db.exec('BEGIN');
    for (let i = 0; i < 4000; i++) {
      const store = i % 2 ? 'android' : 'ios';
      const ratings = Math.round(Math.pow(10, 1 + r() * 5));
      upsertRow({
        store, id: store === 'ios' ? String(1500000000 + i) : `com.demo.app${i}`,
        name: `${W1[Math.floor(r() * 20)]} ${W2[Math.floor(r() * 20)]}${r() > 0.7 ? ' Pro' : ''}`,
        developer: `Demo Dev ${Math.floor(r() * 300)}`, category: (store === 'ios' ? CATS_IOS : CATS_PLAY)[Math.floor(r() * 10)],
        price: r() > 0.9 ? 2.99 : 0, ad_supported: store === 'android' ? (r() > 0.5 ? 1 : 0) : null, iap: r() > 0.4 ? 1 : 0,
        installs: store === 'android' ? ratings * Math.round(30 + r() * 120) : null, ratings, rating: +(3 + r() * 2).toFixed(1),
        released: new Date(Date.now() - r() * 3000 * DAY).toISOString().slice(0, 10),
        updated: new Date(Date.now() - r() * 400 * DAY).toISOString().slice(0, 10), source: 'demo',
      });
    }
    db.exec('COMMIT');
  },
  seedRanks() {
    if (db.prepare('SELECT count(*) n FROM chart_ranks').get().n) return;
    const r = rng(7);
    for (const store of ['ios', 'android']) {
      const cats = store === 'ios' ? ['', ...CATS_IOS] : ['', ...CATS_PLAY];
      const pool = db.prepare("SELECT id, category FROM catalog WHERE store=? AND source='demo' ORDER BY ratings DESC").all(store);
      for (const category of cats) {
        const apps = pool.filter((a) => !category || a.category === category).slice(0, 80).map((a) => a.id);
        for (const chart of ['grossing', 'free', 'paid']) {
          const base = apps.slice().sort(() => r() - 0.5).slice(0, 60);
          for (const [ago, shuffle] of [[14, 0.5], [7, 0.3], [0, 0]]) {
            const ids = ago ? base.slice().sort(() => r() - shuffle).slice(0, 50) : base.slice(0, 60);
            recordRanks({ day: new Date(Date.now() - ago * DAY).toISOString().slice(0, 10), store, country: 'us', chart, category, ids });
          }
        }
      }
    }
  },
  reviews(store, id, n) {
    return mkReviews(this.app(store, id), n).map((x, k) => ({ ...x, thumbsUp: store === 'android' ? (k * 37) % 90 : undefined }));
  },
  instagram(handle) {
    const r = rng(handle.length * 31);
    const media = Array.from({ length: 18 }, (_, k) => {
      const reel = r() > 0.45;
      return { id: `m${k}`, caption: ['New feature drop: streak freezes are here.', 'POV: you finally stuck to a habit for 30 days', '3 tiny habits that changed my mornings', 'We hit 1M downloads. Thank you.', 'Day in the life of our founder', 'Which would you pick? Comment below'][k % 6],
        type: reel ? 'Reel' : k % 4 ? 'Post' : 'Carousel', url: '#', date: new Date(Date.now() - k * 2.3 * DAY).toISOString(),
        likes: Math.round((reel ? 4000 : 900) * (0.3 + r() * 2)), comments: Math.round(40 + r() * 400), views: reel ? Math.round(30000 + r() * 400000) : null };
    });
    const avg = media.reduce((s, m) => s + m.likes + m.comments, 0) / media.length;
    return { configured: true, demo: true, username: handle.replace(/^@/, ''), name: 'Demo brand', followers: 184000, following: 210, posts: 642, bio: 'Demo account', media,
      stats: { avgEngagement: avg, engagementRate: avg / 184000, postsPerWeek: 3.0, reelShare: media.filter((m) => m.type === 'Reel').length / media.length } };
  },
  chart({ store, chart }) {
    const offset = { free: 0, paid: 7, grossing: 3 }[chart] || 0;
    const apps = Array.from({ length: NAMES.length }, (_, i) => mkApp((i + offset) % NAMES.length, store))
      .map((a, i) => ({ ...a, rank: i + 1, chart }));
    return { apps, notes: ['Demo data: fictional apps.'] };
  },
  search(q, store) {
    const all = Array.from({ length: NAMES.length }, (_, i) => mkApp(i, store));
    const hit = all.filter((a) => (a.name + a.developer + a.genre).toLowerCase().includes(q.toLowerCase()));
    return hit.length ? hit : all.slice(0, 8);
  },
  app(store, id) {
    const all = Array.from({ length: NAMES.length }, (_, i) => mkApp(i, store));
    const a = all.find((x) => x.id === id) || all[0];
    const reviews = mkReviews(a, store === 'ios' ? 150 : 150);
    return { ...a, reviews, reviewVelocity: velocity(reviews), similar: store === 'android' ? all.filter((x) => x.genre === a.genre && x.id !== a.id).slice(0, 8) : undefined };
  },
  developer(store, devId) {
    return Array.from({ length: NAMES.length }, (_, i) => mkApp(i, store)).filter((a) => a.developerId === devId);
  },
  socials({ name }) {
    return {
      site: 'https://demo.example',
      links: {
        instagram: { handle: 'demoapp', url: 'https://instagram.com/demoapp' },
        tiktok: { handle: 'demoapp', url: 'https://tiktok.com/@demoapp' },
        x: { handle: 'demoapp', url: 'https://x.com/demoapp' },
        youtube: { handle: '@demoapp', url: 'https://youtube.com/@demoapp' },
      },
      youtube: { value: { channelId: 'UCdemo', videos: [
        { title: `${name}: 60-second tour`, url: '#', published: new Date(Date.now() - 3 * DAY).toISOString(), views: 18400 },
        { title: 'How we hit 100K users', url: '#', published: new Date(Date.now() - 17 * DAY).toISOString(), views: 52100 },
        { title: 'Version 4 is here', url: '#', published: new Date(Date.now() - 40 * DAY).toISOString(), views: 9200 },
      ] } },
      bluesky: null,
      hackerNews: { value: [{ title: `Show HN: ${name}`, points: 142, comments: 61, date: new Date(Date.now() - 200 * DAY).toISOString(), url: '#' }] },
      reddit: { error: 'Demo: Reddit not called' },
    };
  },
  ads(q) {
    const mk = (k, d, reach, plats) => ({
      id: `demo${k}`, page: q || 'Demo brand', pageId: '123', body: ['Stop guessing. Start tracking in 30 seconds.', 'Join 1M people who sleep better.', 'Your budget, finally simple. Try free for 7 days.', 'The app therapists recommend to clients.'][k % 4],
      title: 'Try it free', caption: 'apps.apple.com', started: new Date(Date.now() - d * DAY).toISOString(), stopped: null,
      daysRunning: d, platforms: plats, reach, snapshot: '#', variants: 1 + (k % 3),
    });
    const ads = [mk(0, 142, 820000, ['facebook', 'instagram']), mk(1, 61, 240000, ['instagram']), mk(2, 33, 96000, ['facebook', 'instagram', 'audience_network']), mk(3, 9, 18000, ['instagram']), mk(4, 4, 6000, ['facebook'])];
    const reach = ads.reduce((s, a) => s + a.reach, 0);
    return {
      configured: true, demo: true, countries: ['DE', 'FR', 'GB'], ads,
      summary: {
        total: ads.length, advertisers: [{ page: q || 'Demo brand', pageId: '123', ads: ads.length, reach, longest: 142 }], euReach: reach,
        platforms: { facebook: 3, instagram: 4, audience_network: 1 }, longestRunning: ads.slice(0, 3),
        spendGuessEUR: { low: (reach * 1.2 * 3) / 1000, mid: (reach * 1.8 * 7) / 1000, high: (reach * 2.5 * 14) / 1000 },
        spendMethod: 'Demo numbers.',
      },
    };
  },
  trustmrr() {
    return Array.from({ length: 10 }, (_, i) => {
      const a = mkApp(i, 'ios');
      const g = rng(i * 7919 + 5); g(); const mrr = Math.round(300 + g() * 9000);
      return { name: a.name, slug: `demo-${i}`, url: '#', category: a.genre, paymentProvider: i % 2 ? 'revenuecat' : 'stripe', website: `https://apps.apple.com/us/app/id${a.id}`, iosId: a.id, revenue: { mrr, last30Days: mrr * 0.95, total: mrr * 14 }, growth30d: Math.round(g() * 60 - 10), list: i < 5 ? 'Fastest growing' : 'Recently added', description: 'Demo entry' };
    });
  },
};
