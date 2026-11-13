// Sanity tests for opportunity scoring: weak incumbents beat strong ones; hard niches and big tech sink.
import assert from 'node:assert/strict';
import { scoreApp } from '../lib/opportunity.js';

const now = Date.parse('2026-11-01T00:00:00Z');
const ago = (d) => new Date(now - d * 864e5).toISOString();
const ctx = (rivals = 2) => ({ now, strongRivals: new Map([['ios|Utilities', rivals], ['ios|Social Networking', rivals]]), p20: new Map(), devCount: new Map() });
const base = { store: 'ios', id: '1', name: 'X', developer: 'Indie Co', genre: 'Utilities', price: 0, offersIAP: true, iapPrices: [9.99],
  ratingsCount: 40_000, rating: 4.8, released: ago(1500), updated: ago(10), ratingsCurrentVersion: 900, currentVersionReleased: ago(10), grossingRank: 15, liveUpdated: true };

const strong = scoreApp(base, ctx());
const weak = scoreApp({ ...base, rating: 3.6, updated: ago(400), currentVersionReleased: ago(400), ratingsCurrentVersion: 40_000 }, ctx());
assert.ok(weak.parts.weakness > strong.parts.weakness, 'weak incumbent should score higher weakness');
assert.ok(weak.angles.some((a) => a.k === 'quality') && weak.angles.some((a) => a.k === 'stale'), 'angles for weak app');
console.log('ok weak incumbent outranks strong on weakness', weak.score, '>', strong.score);

const social = scoreApp({ ...base, genre: 'Social Networking' }, ctx());
assert.ok(social.parts.buildability <= 20 && social.cautions.length, 'social is hard');
const bigtech = scoreApp({ ...base, developer: 'Meta Platforms, Inc.' }, ctx());
assert.ok(bigtech.parts.buildability < strong.parts.buildability, 'big tech penalised');
console.log('ok hard niches and big tech penalised', social.parts.buildability, bigtech.parts.buildability);

const crowded = scoreApp(base, ctx(15));
assert.equal(crowded.parts.competition, 0);
assert.ok(scoreApp(base, ctx(0)).angles.some((a) => a.k === 'rivals'));
console.log('ok competition scales with strong rivals');

const noDemand = scoreApp({ ...base, grossingRank: null, ratingsCount: 50, ratingsCurrentVersion: 50 }, ctx());
assert.ok(noDemand.parts.demand < 30, 'tiny app has low demand');
console.log('ok tiny app filtered by demand gate', noDemand.parts.demand);
const snapshotDate = scoreApp({ ...base, updated: ago(400), liveUpdated: false }, ctx());
assert.ok(!snapshotDate.angles.some((a) => a.k === 'stale'), 'bulk-snapshot dates must not count as stale');
console.log('ok stale only from live store dates');

const playGame = scoreApp({ ...base, store: 'android', genre: 'Simulation' }, ctx());
const flaggedGame = scoreApp({ ...base, genre: 'Lifestyle', isGame: true }, ctx());
const messenger = scoreApp({ ...base, genre: 'Communication' }, ctx());
assert.ok(playGame.parts.buildability <= 20 && flaggedGame.parts.buildability <= 20 && messenger.parts.buildability <= 20, 'games and messengers are hard niches');
console.log('ok Play game sub-genres and messengers penalised');
console.log('\nopportunity tests passed');
