// Parser + scoring tests using markup captured from the live sources on 2 Nov 2026.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.SAAS_SOURCES = 'research,zap,yc,trustmrr,hn,ph,atl,shopify,wp';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-test-'));
const S = await import('../lib/saas/sources.js');
const store = await import('../lib/saas/store.js');
const { scoreProduct } = await import('../lib/saas/score.js');
let n = 0;
const t = (name, fn) => { fn(); n++; console.log('ok', name); };

const shopifyApp = `<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"SoftwareApplication","name":"Klaviyo: Email Marketing \\u0026 SMS","description":"Klaviyo is a leading email and sms marketing app for Shopify.","image":["https://cdn.shopify.com/app-store/listing_images/x/icon/a.png"],"operatingSystem":"Shopify","brand":"Klaviyo","aggregateRating":{"@type":"AggregateRating","ratingValue":4.7,"ratingCount":3427}}</script></head><body>
<a class="x" href="https://apps.shopify.com/categories/marketing-and-conversion-marketing-email-marketing?surface_detail=klaviyo-email-marketing&amp;surface_type=app_details">
  Email marketing
</a>
<dd><a class="y" href="https://apps.shopify.com/partners/klaviyo">
        Klaviyo
</a></dd>
<p class="tw-col-span-full">
        Launched
      </p>
      <p class="tw-col-span-full sm:tw-col-span-3 tw-text-fg-secondary tw-text-body-md">
        September 20, 2012
          · <a href="#">Changelog</a></p>
<p data-test-id="name" class="tw-pb-sm">
        Free
      </p>
<span data-test-id="price" class="tw-text-heading-2xl">
              Free to install
            </span>
<p data-test-id="name" class="tw-pb-sm">SMS</p><span data-test-id="price" class="x">$15/month</span>
<p data-test-id="name" class="tw-pb-sm">Email</p><span data-test-id="price" class="x">$20/month</span>
<a class="tw-text-fg-primary tw-body-md" aria-label="3,000 total reviews" href="/klaviyo-email-marketing/reviews?ratings%5B%5D=5">3.0K</a>
<a class="tw-text-fg-primary tw-body-md" aria-label="37 total reviews" href="/klaviyo-email-marketing/reviews?ratings%5B%5D=2">37</a>
<a class="tw-text-fg-primary tw-body-md" aria-label="269 total reviews" href="/klaviyo-email-marketing/reviews?ratings%5B%5D=1">269</a>
</body></html>`;

const shopifyReviews = `<div data-merchant-review="" data-review-content-id="2415136" class="tw-flex"> <div class="tw-order-2"> <div class="tw-flex tw-items-center"> <div class="tw-flex tw-relative tw-space-x-0.5 tw-w-[88px] tw-h-md" aria-label="1 out of 5 stars" role="img"> </div> <div class="tw-text-body-xs tw-text-fg-tertiary"> November 1, 2026 </div> </div> <div class="tw-text-body-md tw-text-fg-secondary" data-truncate-review=""> <div data-truncate-content-copy="" class="tw-mb-xs"> <p class="tw-break-words">Don't install their app unless you want to be harassed by them for the rest of your life!!! It is impossible to get rid of them; they turn into an immediate SPAM generator!</p> <p class="tw-break-words">I installed their app to evaluate. It did not meet my needs for the price, so I cancelled and uninstalled the app.</p></div> </div> </div> <div class="tw-order-1"> <div class="tw-text-heading-xs"> <span class="tw-overflow-hidden tw-text-ellipsis tw-whitespace-nowrap" title="toycargeek"> toycargeek </span> </div> <div>United States</div> <div>About 16 hours using the app</div> </div> <div class="tw-order-last" data-merchant-review-reply=""> <p>Thank you for the feedback</p> </div> </div>
<div data-merchant-review="" data-review-content-id="2415100" class="tw-flex"><div aria-label="5 out of 5 stars" role="img"></div><div class="tw-text-body-xs tw-text-fg-tertiary"> October 30, 2026 </div><p class="tw-break-words">Easy to use!!! Amazing experience!</p><span class="tw-overflow-hidden x" title="BNBB Power"> BNBB </span></div>`;

const wpPlugin = { name: 'Elementor Website Builder &#8211; more than just a page builder', slug: 'elementor', author: '<a href="https://profiles.wordpress.org/elemntor/">Elementor</a>', rating: 90, ratings: { 1: 690, 2: 121, 3: 121, 4: 233, 5: 6157 }, num_ratings: 7322, support_threads: 70, support_threads_resolved: 48, active_installs: 10000000, last_updated: '2026-10-13 12:48pm GMT', added: '2016-05-30', homepage: 'https://elementor.com/', short_description: 'The Elementor Website Builder has it all', tags: { ai: 'AI', 'drag-and-drop': 'drag-and-drop' }, icons: { '2x': 'https://ps.w.org/elementor/assets/icon-256x256.gif' } };

const wpFeed = `<rss><channel><item>
					<guid>https://wordpress.org/support/topic/so-much-bloat/</guid>
					<title>so much bloat (2 stars)</title>
					<link>https://wordpress.org/support/topic/so-much-bloat/</link>
					<pubDate>Thu, 29 Oct 2026 15:22:48 +0000</pubDate>
					<dc:creator>johnfreel</dc:creator>
					<description>
						<![CDATA[
						<p>
							Replies: 1						</p>
						<p>Rating: 2 stars</p>
<p class="wp-block-paragraph">this plugin has so many performance issues and create so many problems under the hood&#8230;</p>
						]]>
					</description>
				</item></channel></rss>`;

const atlAddon = { _links: { alternate: { href: '/apps/1210933/draw-io-diagrams?tab=overview' } }, _embedded: { categories: [{ name: 'Charts & diagramming' }], distribution: { downloads: 687702, totalInstalls: 60222, totalUsers: -1 }, logo: { _links: { highRes: { href: 'https://marketplace.atlassian.com/x.png' } } }, reviews: { averageStars: 4.807788, count: 1207 }, vendor: { name: 'Seibert' } }, name: 'draw.io Diagrams', key: 'com.mxgraph.confluence.plugins.diagramly', summary: 'Create secure diagrams' };

t('Shopify app page', () => {
  const p = S.parseShopifyApp(shopifyApp, 'klaviyo-email-marketing');
  assert.equal(p.name, 'Klaviyo: Email Marketing & SMS');
  assert.equal(p.rating, 4.7); assert.equal(p.reviews, 3427);
  assert.equal(p.category, 'Email marketing'); assert.equal(p.developer, 'Klaviyo');
  assert.equal(p.launched, '2012-09-20');
  assert.equal(p.price_min, 15); assert.equal(p.model, 'subscription'); assert.equal(p.free_plan, 1);
  assert.deepEqual(p.stars, { 5: 3000, 2: 37, 1: 269 });
  assert.match(p.pricing, /SMS: \$15\/month/);
});
t('Shopify reviews', () => {
  const r = S.parseShopifyReviews(shopifyReviews, 1);
  assert.equal(r.length, 2);
  assert.equal(r[0].stars, 1); assert.equal(r[0].date, '2026-11-01'); assert.equal(r[0].author, 'toycargeek');
  assert.match(r[0].text, /SPAM generator/); assert.ok(!/Thank you for the feedback/.test(r[0].text), 'developer reply excluded');
  assert.equal(r[1].stars, 5);
});
t('WordPress plugin', () => {
  const p = S.mapWpPlugin(wpPlugin);
  assert.equal(p.name, 'Elementor Website Builder – more than just a page builder');
  assert.equal(p.rating, 4.5); assert.equal(p.installs, 10000000); assert.equal(p.developer, 'Elementor');
  assert.equal(p.updated, '2026-10-13'); assert.ok(Math.abs(p.extra.unresolvedShare - 22 / 70) < 1e-9);
});
t('WordPress review feed', () => {
  const [r] = S.parseWpFeed(wpFeed);
  assert.equal(r.stars, 2); assert.equal(r.date, '2026-10-29'); assert.match(r.text, /^so much bloat\. this plugin has so many performance issues/);
});
t('Atlassian addon', () => {
  const p = S.mapAtlassian(atlAddon);
  assert.equal(p.rating, 4.8); assert.equal(p.reviews, 1207); assert.equal(p.installs, 60222);
  assert.equal(p.url, 'https://marketplace.atlassian.com/apps/1210933/draw-io-diagrams');
});
t('Price parsing', () => {
  assert.deepEqual(S.parsePlans(['$199/year']), { price_min: 16.58, model: 'subscription', free_plan: 0 });
  assert.deepEqual(S.parsePlans(['Free to install', 'Free plan available']), { price_min: null, model: 'free', free_plan: 1 });
  assert.equal(S.parsePlans(['$49 one-time charge']).model, 'one-time');
  assert.equal(S.parsePlans(['$11/seat/mo (Pro, annual)']).price_min, 11);
  assert.equal(S.parsePlans(['$5/mo Basic single app (yearly)']).price_min, 5);
  assert.equal(S.parsePlans(['Full $9.99/mo billed yearly; Highlights Lite $5.59/mo']).price_min, 9.99);
  assert.equal(S.parsePlans(['Team $8.50/seat/mo yearly (5-seat min)']).price_min, 8.5);
});
t('Store + scoring pipeline', () => {
  store.saveProducts([S.parseShopifyApp(shopifyApp, 'klaviyo-email-marketing'), S.mapWpPlugin(wpPlugin), S.mapAtlassian(atlAddon)]);
  store.saveReviews('shopify:klaviyo-email-marketing', S.parseShopifyReviews(shopifyReviews, null));
  const k = store.getProduct('shopify:klaviyo-email-marketing');
  assert.ok(k.score > 0 && k.pillars.demand === 5, JSON.stringify(k.pillars));
  assert.ok(k.themes.some((x) => x.k === 'spam'), 'spam theme detected from the 1★ review');
  const list = store.listProducts({ sort: 'score' });
  assert.equal(list.total, 3);
  assert.equal(store.suggest('kla')[0].name, 'Klaviyo: Email Marketing & SMS');
});
t('Gate: a weak incumbent in an easy niche passes; a payments app does not', () => {
  const weak = scoreProduct({ source: 'shopify', name: 'Countdown Timer Bar', category: 'Countdown timer', reviews: 800, rating: 3.6, stars: { 1: 150, 2: 50, 3: 50, 4: 100, 5: 450 }, price_min: 9.99, model: 'subscription' },
    Array.from({ length: 12 }, (_, i) => ({ stars: 1, text: i % 2 ? 'Way too expensive, charged after cancel' : 'Constant bugs, support never replies' })));
  assert.equal(weak.verdict, 'strong', JSON.stringify(weak.pillars));
  const pay = scoreProduct({ source: 'shopify', name: 'Payments Gateway Pro', category: 'Payment gateway', reviews: 800, rating: 3.6, stars: { 1: 150, 2: 50, 3: 50, 4: 100, 5: 450 }, price_min: 30, model: 'subscription' }, []);
  assert.equal(pay.pillars.build, 2);
  assert.notEqual(pay.verdict, 'strong');
});
t('YC company mapping, filter and resumable checkpoints', () => {
  const stripe = { id: 240, name: 'Stripe', slug: 'stripe', website: 'http://stripe.com', one_liner: 'Economic infrastructure for the internet.', team_size: 7000, industry: 'Fintech', subindustry: 'Fintech', launched_at: 1326790584, tags: ['Banking as a Service', 'Fintech', 'SaaS'], batch: 'Summer 2009', status: 'Active', nonprofit: false, url: 'https://www.ycombinator.com/companies/stripe', small_logo_thumb_url: 'https://x/a.png' };
  const p = S.mapYc(stripe);
  assert.equal(p.key, 'yc:240'); assert.equal(p.extra.tier, 'giant'); assert.equal(p.model, 'subscription'); assert.equal(p.launched, '2012-01-17');
  assert.ok(S.keepYc(stripe));
  assert.ok(!S.keepYc({ ...stripe, status: 'Inactive' }), 'dead companies skipped');
  assert.ok(!S.keepYc({ ...stripe, subindustry: 'Healthcare -> Drug Discovery and Delivery', tags: [] }), 'deep tech skipped');
  store.saveProducts([p]);
  const s = store.getProduct('yc:240');
  assert.equal(s.pillars.defensibility, 1); assert.ok(s.pillars.switch <= 3); assert.notEqual(s.verdict, 'strong', 'no reviews or revenue: cannot be strong');
  S.checkpoints.set('atl', { offset: 1000 }); assert.deepEqual(S.checkpoints.get('atl'), { offset: 1000 });
  S.checkpoints.set('atl', null); assert.equal(S.checkpoints.get('atl'), null);
});
t('Open-source repos are not SaaS launches', () => {
  for (const u of ['https://github.com/foo/bar', 'https://gitlab.com/x/y', 'https://foo.github.io/', 'https://huggingface.co/spaces/a/b']) assert.ok(S.OSS_HOST.test(u), u);
  for (const u of ['https://linear.app', 'https://notgithub.com.example.org/x', 'https://www.cal.com/']) assert.ok(!S.OSS_HOST.test(u), u);
  assert.deepEqual([...store.ENABLED].sort(), ['atl', 'hn', 'ph', 'research', 'shopify', 'trustmrr', 'wp', 'yc', 'zap']);
});
const L = await import('../lib/saas/listings.js');
const { clonePlan, familyFor } = await import('../lib/saas/plan.js');
t('Domains: product sites, not directories; company sub-products kept apart', () => {
  assert.equal(store.domainOf('https://www.tidio.com/?utm_source=app_store'), 'tidio.com');
  assert.equal(store.domainOf('https://www.zoho.com/crm/'), 'zoho.com/crm');
  assert.equal(store.domainOf('https://app.postiz.com/en/'), 'postiz.com');
  assert.equal(store.domainOf('https://github.com/x/y'), null);
  assert.equal(store.domainOf('https://apps.shopify.com/tidio-chat'), null);
  assert.ok(store.sameSite('tidio.com', 'tidio.com') && store.sameSite('zoho.com', 'zoho.com/crm') && !store.sameSite('zoho.com/books', 'zoho.com/crm'));
});
t('Store listing matching needs the same website and name', () => {
  const p = { name: 'Tidio', domain: 'tidio.com' };
  assert.ok(L.isMatch(p, { name: 'Tidio', website: 'https://www.tidio.com/', developer: 'TIDIO POLAND SP Z O O' }));
  assert.ok(L.isMatch(p, { name: 'Tidio – Live Chat &amp; AI Chatbots', website: 'http://www.tidio.com' }));
  assert.ok(!L.isMatch(p, { name: 'Tidio', website: null }), 'no website, no match');
  assert.ok(!L.isMatch(p, { name: 'Smartsupp', website: 'https://www.smartsupp.com/' }));
  const crm = { name: 'Zoho CRM', domain: 'zoho.com/crm' };
  assert.ok(!L.isMatch(crm, { name: 'Zoho Books', website: 'https://www.zoho.com/' }), 'sibling product rejected');
  assert.ok(L.isMatch(crm, { name: 'Zoho CRM - Sales & Marketing', website: 'https://www.zoho.com/' }));
});
t('Research, YC, Zapier and store listings for one company merge into one row', () => {
  store.saveProducts([
    { key: 'research:900', source: 'research', name: 'Acmeflow', url: 'https://acmeflow.io', category: 'Form builders', description: 'Forms', extra: { verdict: 'clone', why: 'Pricey', idea: 'Cheaper forms for clinics', buildWeeks: 4, evidence: 'sourced', tier: 'indie' } },
    { key: 'yc:900', source: 'yc', name: 'Acmeflow', website: 'https://www.acmeflow.io/', extra: { batch: 'W24', teamSize: 12, tier: 'indie' } },
    { key: 'trustmrr:acme', source: 'trustmrr', name: 'Acmeflow', website: 'https://acmeflow.io', mrr: 12000 },
    S.mapZapApp({ slug: 'acmeflow', name: 'Acmeflow', description: 'Forms', externalUrl: 'https://acmeflow.io', partnerTier: 'SILVER', logo: { mainUrl: 'https://cdn/x.png' } }, { category: 'Forms & Surveys', rank: 2 }),
    { key: 'ios:1', source: 'ios', name: 'Acmeflow Forms', url: 'https://apps.apple.com/app/id1', website: 'https://acmeflow.io', rating: 3.1, reviews: 400, domain: 'acmeflow.io' },
  ]);
  store.saveReviews('ios:1', Array.from({ length: 12 }, (_, i) => ({ rid: 'r' + i, stars: 1, text: i % 2 ? 'Way too expensive, I wish it had conditional logic.' : 'Keeps crashing, support never replies.', origin: 'App Store' })));
  const list = store.listProducts({ q: 'Acmeflow' });
  assert.equal(list.total, 1, 'one row for the company');
  const p = list.rows[0];
  assert.equal(p.key, 'research:900');
  assert.equal(p.mrr, 12000); assert.equal(p.extra.batch, 'W24'); assert.equal(p.extra.zapTier, 'SILVER');
  assert.equal(p.reviews, 400); assert.equal(p.rating, 3.1);
  assert.ok(p.neg >= 12, 'negative reviews from the App Store listing count');
  assert.deepEqual(new Set(p.twins.map((x) => x.source)), new Set(['yc', 'trustmrr', 'zap', 'ios']));
  assert.equal(store.getReviews('research:900').length, 12);
  assert.equal(store.listProducts({ rverdict: 'clone', q: 'Acme' }).total, 1);
  assert.equal(store.listProducts({ source: 'yc', q: 'Acme' }).total, 1, 'filter by a twin source finds the merged row');
  assert.equal(store.listProducts({ revenue: '1', q: 'Acme' }).total, 1);
  assert.equal(store.getProduct('yc:900').key, 'research:900', 'a twin key opens the merged product');
});
t('Zapier category + app pages', () => {
  const nd = (pp) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: pp } })}</script>`;
  const c = S.parseZapCategory(nd({ categoryTitle: 'Customer Support', totalApps: 193, apps: [{ slug: 'zendesk', name: 'Zendesk', description: 'Help desk', externalUrl: 'https://www.zendesk.com/', partnerTier: 'PLATINUM', logo: { mainUrl: 'https://cdn/z.png' } }], appCategories: [] }));
  const z = S.mapZapApp(c.apps[0], { category: 'Help Desk', rank: 1 });
  assert.equal(z.key, 'zap:zendesk'); assert.equal(z.website, 'https://www.zendesk.com/'); assert.equal(z.extra.tier, 'giant'); assert.equal(z.extra.catRank, 1);
  const a = S.parseZapApp(nd({ oneAppPage: { appDetails: { app: { slug: 'tidio', name: 'Tidio', description: 'Live chat', externalUrl: 'https://www.tidiochat.com/', partnerTier: 'GOLD' }, appCategories: [{ slug: 'customer-support', title: 'Customer Support' }], topAlternatives: [] } } }));
  assert.equal(a.name, 'Tidio'); assert.equal(a.category, 'Customer Support'); assert.equal(a.extra.zapTier, 'GOLD');
});
t('Clone plan: category features, requested features, wedge, price', () => {
  const p = store.getProduct('research:900');
  p.price_min = 25;
  const plan = clonePlan(p, store.getReviews('research:900'), { categoryNote: { opening: 'Vertical forms for clinics' } });
  assert.equal(plan.family, 'Form builder');
  assert.ok(plan.core.some((x) => /conditional logic/i.test(x)));
  assert.ok(plan.requested.some((r) => /conditional logic/.test(r.text)), JSON.stringify(plan.requested));
  assert.equal(plan.wedge[0].t, 'Cheaper forms for clinics');
  assert.ok(plan.wedge.some((w) => w.k === 'pricing'));
  assert.match(plan.price, /\$15\/mo/);
  assert.equal(plan.mvpWeeks, 4);
  assert.equal(familyFor({ category: 'Link shorteners & QR codes' }).name, 'Link shorteners & QR codes');
  assert.equal(familyFor({ category: 'Underwater basket weaving' }), null);
});
console.log(`\n${n} SaaS tests passed`);
