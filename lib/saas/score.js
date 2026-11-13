// Auto-scoring for SaaS products, using the SaaS track's eight pillars (1–5) and formula:
//   score = (4·demand + 4·pain + 3·switch + 3·build + 2·recurring + 2·distribution + monetization + defensibility − 20) ÷ 80 × 100
// Pillars are DERIVED from public signals (installs, review counts, star distribution, review themes,
// pricing, verified revenue), so they are a first read. Researched products keep their agent verdict too.
// Gate (as in the SaaS track): "strong" only if demand, pain, switch, build ≥ 3, payment evidence
// (monetization) ≥ 3, and recurring ≥ 3 when it is a subscription. "validate" = one core pillar at 2. Else "reject".

export const THEMES = [
  ['pricing', 'Pricing / paywall', /price|pric(ing|ey)|expensive|overpriced|subscription|charged|charge[sd]?|billing|refund|cost|fee|plan limit|upgrade to/i],
  ['bugs', 'Bugs / reliability', /bug|crash|broke|broken|doesn'?t work|not working|glitch|error|slow|conflict|down\b|outage|lost (data|orders)/i],
  ['support', 'Support', /support|no (reply|response)|customer service|ticket|ignored|never (got|heard)|unresponsive/i],
  ['features', 'Missing features', /wish|missing|please add|would be nice|feature request|lacks?|doesn'?t (have|support)|limited/i],
  ['ux', 'Hard to use', /confusing|complicated|hard to (use|set ?up)|clunky|not intuitive|learning curve|setup (was|is) (a )?nightmare/i],
  ['spam', 'Spam / dark patterns', /spam|harass|cancel(l?ation)?|uninstall|left (code|scripts)|hidden|auto-?renew|trap/i],
  ['praise', 'Praise', /love|amazing|great|best|perfect|excellent|helpful|easy to use/i],
];
const FIXABLE = new Set(['pricing', 'bugs', 'support', 'ux', 'spam', 'features']);

const clamp = (x) => Math.max(1, Math.min(5, Math.round(x)));
const steps = (v, cuts) => (v == null ? null : 1 + cuts.filter((c) => v >= c).length); // cuts ascending → 1..5

// Categories where a solo developer struggles: payments, regulated money, carrier/ERP integrations, hardware, marketplaces.
const HARD_CAT = /payment|pos\b|point of sale|accounting|tax|payroll|bank|lending|insurance|erp|shipping label|carrier|fulfil|dropship|marketplace|hardware|compliance|legal|health record|crypto/i;
const EASY_CAT = /widget|popup|banner|review|form|countdown|timer|badge|seo|image|social|faq|chat|email|sms|upsell|cross-sell|bundle|wishlist|announcement|translation|label|font|backup|report|analytics|scheduling|booking|calendar|survey|feedback|automation|notification|template|productivity|time track|invoice|quote/i;

export function scoreProduct(p, reviews = []) {
  const ex = p.extra || {};
  const notes = [];
  // ---------- review themes ----------
  const neg = reviews.filter((r) => r.stars != null && r.stars <= 2);
  const negOrAll = neg.length >= 3 ? neg : reviews.filter((r) => r.stars == null || r.stars <= 3);
  const themes = THEMES.map(([k, label, re]) => {
    const hits = (k === 'praise' ? reviews.filter((r) => (r.stars ?? 5) >= 4) : negOrAll).filter((r) => re.test(r.text || ''));
    return { k, label, n: hits.length, share: negOrAll.length ? hits.length / negOrAll.length : 0, example: hits[0]?.text?.slice(0, 220) || null };
  }).filter((t) => t.n > 0);

  // ---------- star distribution ----------
  const stars = p.stars || null;
  let lowShare = null;
  if (stars) {
    const tot = [1, 2, 3, 4, 5].reduce((s, k) => s + (+stars[k] || 0), 0);
    if (tot >= 10) lowShare = ((+stars[1] || 0) + (+stars[2] || 0)) / tot;
  } else if (reviews.length >= 10 && reviews.every((r) => r.stars != null)) {
    lowShare = neg.length / reviews.length;
  }

  // ---------- pillars ----------
  const demandSignals = [
    steps(p.installs, p.source === 'wp' ? [1e3, 1e4, 1e5, 1e6] : [100, 1e3, 1e4, 5e4]),
    steps(p.reviews, p.source === 'wp' ? [10, 50, 300, 2000] : [10, 80, 400, 2000]),
    steps(p.mrr, [100, 1e3, 1e4, 5e4]),
    steps(ex.points, [50, 150, 400, 900]),
    steps(ex.votes, [100, 300, 700, 1500]),
    steps(ex.teamSize, [5, 15, 60, 300]),
    ex.zapTier ? ({ PLATINUM: 5, GOLD: 4, SILVER: 3, BRONZE: 3 }[ex.zapTier] ?? 2) : null,
    ex.catRank ? (ex.catRank <= 3 ? 5 : ex.catRank <= 10 ? 4 : 3) : null,
    ex.tier ? { giant: 5, established: 4, indie: 3 }[ex.tier] : null,
    p.revenue_text ? 4 : null,
  ].filter((x) => x != null);
  const demand = demandSignals.length ? clamp(Math.max(...demandSignals)) : 2;

  let pain = lowShare == null ? null : steps(lowShare, [0.05, 0.1, 0.2, 0.35]);
  if (pain == null && p.rating) pain = steps(5 - p.rating, [0.4, 0.8, 1.3, 2]);
  if (ex.complaints) pain = Math.max(pain || 0, ex.complaints >= 3 ? 4 : 3);
  if (ex.unresolvedShare != null && ex.unresolvedShare > 0.5) pain = (pain || 2) + 1;
  pain = clamp(pain || 2);

  const fixable = themes.filter((t) => FIXABLE.has(t.k)).reduce((s, t) => s + t.share, 0);
  let sw;
  if (p.source === 'research') {
    // Research complaints are pre-selected problems, so their share says little; use the agents' verdict instead.
    sw = { clone: 4, gap: 3, watch: 2, avoid: 1 }[ex.verdict] ?? 3;
  } else {
    sw = negOrAll.length >= 3 ? steps(fixable, [0.15, 0.35, 0.6, 0.9]) : null;
    if (sw == null) sw = p.rating && p.reviews >= 20 ? (p.rating < 4 ? 4 : p.rating < 4.5 ? 3 : 2) : 3;
  }
  if (ex.tier === 'giant') sw = Math.min(sw, 3); // data lock-in and habit make giants hard to switch away from
  const switchP = clamp(sw);

  const catText = `${p.category || ''} ${p.name || ''} ${p.description || ''}`;
  const hardCat = HARD_CAT.test(catText);
  let build = hardCat ? 2 : EASY_CAT.test(catText) ? 4 : 3;
  // Research MVP weeks describe the suggested play; for a "gap" that is an add-on, so a hard category doesn't cap it.
  if (ex.buildWeeks) build = ex.buildWeeks <= 4 ? 5 : ex.buildWeeks <= 8 ? 4 : ex.buildWeeks <= 12 ? 3 : 2;
  if (hardCat && ex.verdict !== 'gap') build = Math.min(build, 2);
  if (ex.verdict === 'avoid') build = Math.min(build, 2);

  const recurring = p.model === 'subscription' || p.mrr ? 4 : p.model === 'one-time' ? 2 : p.model === 'free' ? 1 : 3;
  const distribution = { shopify: 4, atl: 4, wp: 3, trustmrr: 3, hn: 3, ph: 3, yc: 3, zap: 3, research: 3 }[p.source] || 3;
  const monetization = p.mrr ? (p.mrr >= 5000 ? 5 : 4) : p.price_min >= 20 ? 4 : p.price_min >= 5 ? 3 : p.free_plan && !p.price_min ? 2 : p.revenue_text ? 4 : 3;
  const defensibility = ex.tier === 'giant' ? 1 : demand >= 5 ? 2 : 3; // a crowded, giant-led market is harder to defend a clone in

  const pillars = { demand, pain, switch: switchP, build, recurring, distribution, monetization, defensibility };
  const score = Math.round(((4 * demand + 4 * pain + 3 * switchP + 3 * build + 2 * recurring + 2 * distribution + monetization + defensibility - 20) / 80) * 100);

  const core = [demand, pain, switchP, build];
  // Evidence needed before anything can be "strong": real rating volume, collected reviews, verified revenue,
  // or a review-backed research verdict. Thin data can at best be "validate".
  const evidence = (stars && p.reviews >= 30) || reviews.filter((r) => r.stars != null).length >= 10 || p.mrr > 0
    || (p.source === 'research' && ex.evidence === 'sourced' && (ex.verdict === 'clone' || ex.verdict === 'gap'));
  const gate = core.every((x) => x >= 3) && monetization >= 3 && (p.model !== 'subscription' || recurring >= 3);
  let verdict = gate && evidence ? 'strong' : (gate || (core.filter((x) => x < 3).length === 1 && core.every((x) => x >= 2))) ? 'validate' : 'reject';
  if (ex.verdict === 'avoid') verdict = 'reject';
  if (ex.verdict === 'watch' && verdict === 'strong') verdict = 'validate';
  if (ex.verdict === 'gap') notes.push('play: add-on or slice, not a full clone');

  // ---------- angles: how to beat it ----------
  const angles = [];
  const top = themes.filter((t) => t.k !== 'praise').sort((a, b) => b.n - a.n);
  const ANGLE = {
    pricing: 'Pricing is the top complaint: a flat, cheaper plan or a one-time unlock is the wedge.',
    bugs: 'Reliability complaints: a stable, well-tested alternative wins switchers.',
    support: 'Support complaints: fast, human support is a selling point on its own.',
    features: 'Feature requests pile up: build exactly what reviewers ask for.',
    ux: 'Users find it hard to use: a simpler setup and cleaner UI is the wedge.',
    spam: 'Dark patterns and cancellation pain: an honest, easy-to-leave alternative earns trust.',
  };
  for (const t of top.slice(0, 2)) if (ANGLE[t.k]) angles.push({ k: t.k, t: `${ANGLE[t.k]} (${t.n} of ${negOrAll.length} critical reviews)` });
  if (lowShare != null && lowShare >= 0.15 && p.reviews >= 30) angles.push({ k: 'unhappy', t: `${Math.round(lowShare * 100)}% of ratings are 1–2★ across ${p.reviews.toLocaleString()} reviews.` });
  if (p.price_min >= 20) angles.push({ k: 'price', t: `Starts at $${p.price_min}/mo: room for a cheaper, narrower tool.` });
  if (ex.unresolvedShare != null && ex.unresolvedShare > 0.5 && ex.supportThreads >= 5) angles.push({ k: 'support', t: `${Math.round(ex.unresolvedShare * 100)}% of recent support threads unresolved.` });
  if (p.updated && Date.now() - Date.parse(p.updated) > 365 * 864e5) angles.push({ k: 'stale', t: `Not updated since ${String(p.updated).slice(0, 10)}: a maintained alternative.` });
  if (ex.idea) angles[ex.verdict === 'gap' ? 'unshift' : 'push']({ k: 'research', t: `${ex.verdict === 'gap' ? 'The play (add-on, not a clone)' : 'Research idea'}: ${ex.idea}` });
  if (!angles.length) angles.push({ k: 'segment', t: 'No dominant complaint yet: compete on a narrower segment or price, or read its reviews first.' });

  const confidence = reviews.length >= 20 || (stars && p.reviews >= 50) || ex.complaints >= 2 ? 'medium' : demandSignals.length ? 'low' : 'thin';
  return { score, verdict, pillars, angles, themes, confidence, notes };
}
