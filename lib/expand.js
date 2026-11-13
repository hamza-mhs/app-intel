// Expansion crawl: grow the catalog beyond chart positions by following leads from charted apps.
//  1. Keyword searches on both stores (~180 niche terms; iOS returns up to 200 per term).
//  2. Other apps by every developer who has a charted app.
//  3. Google Play "similar apps" for each top-50 app.
//  4. Google Play detail pages (install counts) for discovered apps, capped per run.
// Each lead is marked done for 30 days, so later runs only process new leads.
// iOS apps with fewer than MIN_IOS_RATINGS ratings are skipped (no traction).
import * as ios from './ios.js';
import * as android from './android.js';
import { upsertApps, expandDue, expandMark, latestChartLeads, missingDetails, kvSet } from './db.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN_IOS_RATINGS = +process.env.EXPAND_MIN_RATINGS || 20;
const IOS_GAP = 3_500; // ~17 req/min, under Apple's ~20/min
const PLAY_GAP = 900;

export const KEYWORDS = [
  // productivity & utilities
  'habit tracker', 'to do list', 'planner', 'calendar', 'notes', 'journal', 'diary', 'reminder', 'focus timer', 'pomodoro',
  'pdf scanner', 'document scanner', 'pdf editor', 'esign', 'fax', 'invoice', 'receipt scanner', 'time tracker', 'password manager', 'vpn',
  'cleaner', 'storage cleaner', 'battery', 'wifi analyzer', 'qr code', 'barcode scanner', 'calculator', 'unit converter', 'translator', 'keyboard',
  'widget', 'wallpaper', 'icon changer', 'launcher', 'ringtone', 'file manager', 'screen recorder', 'remote control', 'tv remote', 'printer',
  'screen time', 'app blocker', 'digital detox', 'website blocker', 'parental control', 'location sharing', 'family locator', 'phone tracker', 'call recorder', 'second phone number',
  // AI & writing
  'ai chat', 'ai assistant', 'ai photo', 'ai headshot', 'ai art', 'ai video', 'ai writer', 'homework helper', 'math solver', 'essay writer',
  'transcription', 'voice recorder', 'text to speech', 'speech to text', 'ai tutor', 'resume builder', 'email app', 'grammar',
  // health & fitness
  'workout', 'home workout', 'running', 'step counter', 'cycling', 'yoga', 'pilates', 'walking', 'gym log', 'calisthenics',
  'calorie counter', 'intermittent fasting', 'meal planner', 'water tracker', 'weight loss', 'macro tracker', 'diet', 'recipes', 'keto', 'grocery list',
  'sleep tracker', 'sleep sounds', 'white noise', 'meditation', 'breathing', 'anxiety', 'therapy', 'mood tracker', 'period tracker', 'pregnancy',
  'baby tracker', 'blood pressure', 'heart rate', 'glucose', 'medication reminder', 'posture', 'eye exercise', 'quit smoking', 'sobriety', 'skin care',
  // lifestyle & hobbies
  'astrology', 'horoscope', 'tarot', 'manifestation', 'affirmations', 'bible', 'quran', 'prayer times', 'plant identifier', 'plant care',
  'bird identifier', 'rock identifier', 'coin identifier', 'mushroom identifier', 'insect identifier', 'fishing', 'hunting', 'golf', 'tennis', 'chess',
  'dog training', 'pet care', 'cat', 'aquarium', 'gardening', 'home design', 'interior design', 'paint color', 'tattoo', 'hairstyle',
  'outfit', 'wardrobe', 'thrift', 'couponing', 'cashback', 'price tracker', 'budget', 'expense tracker', 'bill reminder', 'subscription tracker',
  // education
  'language learning', 'learn english', 'learn spanish', 'flashcards', 'vocabulary', 'reading', 'speed reading', 'typing', 'coding', 'learn piano',
  'learn guitar', 'tuner', 'metronome', 'drum', 'singing', 'karaoke', 'brain training', 'memory', 'kids learning', 'phonics',
  // photo & video & creator
  'photo editor', 'video editor', 'collage', 'background remover', 'face swap', 'filters', 'retouch', 'thumbnail maker', 'logo maker', 'flyer maker',
  'caption', 'reels editor', 'slideshow', 'gif maker', 'meme', 'font', 'teleprompter', 'podcast', 'audiobook', 'manga',
  // business & niche pro
  'crm', 'invoice maker', 'pos', 'inventory', 'appointment booking', 'timesheet', 'field service', 'real estate', 'mileage tracker', 'construction',
  'truck driver', 'pilot', 'nurse', 'medical calculator', 'electrician', 'ham radio', 'stock alerts', 'crypto tracker', 'sports betting', 'fantasy football',
  'weather radar', 'tide', 'hunting map', 'offline maps', 'hiking', 'camping', 'rv', 'flight tracker', 'travel planner', 'packing list',
];

export async function expand({ country = 'us', stores = ['ios', 'android'], log = console.log, progress = (m) => kvSet('crawl_progress', m) } = {}) {
  const stat = { keywords: 0, devs: 0, similar: 0, details: 0, apps: 0 };
  const add = (apps) => {
    const keep = apps.filter((a) => a.store !== 'ios' || (a.ratingsCount || 0) >= MIN_IOS_RATINGS);
    upsertApps(keep);
    stat.apps += keep.length;
  };
  const step = async (key, fn, gap) => {
    if (!expandDue(key)) return;
    try { add(await fn()); expandMark(key); } catch (e) { if (!/404|not found/i.test(e.message)) log(`expand ${key}: ${e.message}`); expandMark(key); }
    await sleep(gap);
  };

  const runIos = async () => {
    for (const [i, kw] of KEYWORDS.entries()) {
      progress(`expanding · iOS search ${i + 1}/${KEYWORDS.length} “${kw}” · +${stat.apps} apps`);
      await step(`ios:${country}:kw:${kw}`, () => ios.search(kw, country, 200), IOS_GAP); stat.keywords++;
    }
    const { devs } = latestChartLeads('ios', country);
    for (const [i, dev] of devs.slice(0, +process.env.EXPAND_MAX_DEVS || 600).entries()) {
      progress(`expanding · iOS developers ${i + 1}/${Math.min(devs.length, 600)} · +${stat.apps} apps`);
      await step(`ios:${country}:dev:${dev}`, () => ios.byDeveloper(dev, country, 200), IOS_GAP); stat.devs++;
    }
  };

  const runPlay = async () => {
    for (const kw of KEYWORDS) await step(`gp:${country}:kw:${kw}`, () => android.quickSearch(kw, country, 100), PLAY_GAP);
    const { apps, devs } = latestChartLeads('android', country);
    for (const id of apps.slice(0, 1500)) { await step(`gp:${country}:sim:${id}`, () => android.similarTo(id, country), PLAY_GAP); stat.similar++; }
    for (const dev of devs.slice(0, 800)) await step(`gp:${country}:dev:${dev}`, () => android.devApps(dev, country), PLAY_GAP);
    // Install counts for discovered Play apps (detail page each), capped per run.
    const ids = missingDetails('android', +process.env.EXPAND_MAX_DETAILS || 2500);
    for (const id of ids) {
      try { upsertApps([android.normalize(await android.detailsFor(id, country))]); stat.details++; } catch {}
      await sleep(700);
    }
  };

  await Promise.all([stores.includes('ios') && runIos(), stores.includes('android') && runPlay()].filter(Boolean));
  log(`expand finished (${country}): ${stat.apps} app rows from ${stat.keywords} iOS keywords, ${stat.devs} iOS developers, ${stat.similar} Play similar lists, ${stat.details} Play details`);
  return stat;
}
