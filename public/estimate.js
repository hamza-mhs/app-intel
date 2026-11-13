// Estimation engine. Pure functions, used by both the browser (live sliders) and Node.
// Every number comes back as { low, mid, high } plus the method and inputs behind it.
// Nothing here is measured revenue. Treat outputs as order-of-magnitude ranges.

export const DEFAULT_ASSUMPTIONS = {
  // iOS: Apple publishes no install counts. Lifetime downloads ≈ ratings × this factor.
  // Common industry rules of thumb sit between ~1 rating per 50 and per 200 downloads; calibrate in the Verified tab.
  iosDownloadsPerRating: [40, 80, 160],
  // Share of NEW monthly downloads that become paying customers (trial→paid included).
  payConversion: [0.01, 0.025, 0.05],
  // Monthly churn of paying subscribers. Low-revenue case uses the highest churn.
  monthlyChurn: [0.2, 0.12, 0.07],
  // Apple/Google commission. 0.15 = small-business / subscription year 2+. Use 0.30 for big apps.
  storeCut: 0.15,
  // Used when IAP prices are unknown.
  defaultSubPrice: 9.99,
  // IAP prices above this are treated as yearly plans (divided by 12).
  yearlyThreshold: 20,
  // Ad-supported apps: daily active users per monthly download, and ad revenue per DAU per day (USD).
  adDauPerMonthlyDownload: [0.1, 0.3, 0.6],
  adArpdau: [0.005, 0.015, 0.04],
};

const DAY = 86_400_000;
const MONTH_DAYS = 30.44;
const S = [0, 1, 2]; // low, mid, high

const tri = (f) => ({ low: f(0), mid: f(1), high: f(2) });
const pct = (x) => `${+(x * 100).toFixed(1)}%`;
const clamp0 = (n) => (Number.isFinite(n) && n > 0 ? n : 0);

export function median(xs) {
  const a = xs.filter((x) => x > 0).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function ageDays(app, now) {
  const r = Date.parse(app.released);
  return Number.isFinite(r) ? Math.max(30, (now - r) / DAY) : null;
}

// ---------- Downloads ----------
export function estimateDownloads(app, A = DEFAULT_ASSUMPTIONS, hist = [], now = Date.now()) {
  const age = ageDays(app, now);
  const K = A.iosDownloadsPerRating;
  const inputs = { ageDays: age && Math.round(age) };

  // 1) Observed history beats every model.
  if (hist.length >= 2) {
    const a = hist[0];
    const b = hist[hist.length - 1];
    const span = (Date.parse(b.t) - Date.parse(a.t)) / DAY;
    if (span >= 3) {
      if (app.store === 'android' && a.installs && b.installs && b.installs >= a.installs) {
        const perDay = (b.installs - a.installs) / span;
        const m = perDay * MONTH_DAYS;
        return {
          low: m * 0.85, mid: m, high: m * 1.15,
          lifetime: { low: app.installs, mid: app.installs, high: app.installs },
          method: `Observed: Google Play install counter grew ${Math.round(b.installs - a.installs).toLocaleString()} over ${span.toFixed(0)} days (your snapshots).`,
          confidence: span >= 14 ? 'high' : 'medium',
          inputs: { ...inputs, spanDays: +span.toFixed(1), installsPerDay: Math.round(perDay) },
        };
      }
      if (app.store === 'ios' && a.ratingsCount != null && b.ratingsCount >= a.ratingsCount) {
        const perDay = (b.ratingsCount - a.ratingsCount) / span;
        const r = tri((s) => perDay * MONTH_DAYS * K[s]);
        return {
          ...r,
          lifetime: tri((s) => app.ratingsCount * K[s]),
          method: `Observed: ratings grew ${b.ratingsCount - a.ratingsCount} over ${span.toFixed(0)} days (your snapshots) × ${K.join('/')} downloads per rating.`,
          confidence: 'medium',
          inputs: { ...inputs, spanDays: +span.toFixed(1), ratingsPerDay: +perDay.toFixed(2) },
        };
      }
    }
  }

  // 2) Android: Google's own install counter + current review velocity.
  if (app.store === 'android') {
    const installs = app.installs || 0;
    const lifetime = { low: installs, mid: installs, high: installs };
    const v = app.reviewVelocity;
    const written = app.reviewsCount && app.reviewsCount < app.ratingsCount ? app.reviewsCount : null;
    const denom = written || app.ratingsCount;
    if (installs && denom && v?.perDay && v.sampleSize >= 20) {
      const perReview = installs / denom;
      const m = Math.min(v.perDay * MONTH_DAYS * perReview, installs);
      return {
        low: m * 0.5, mid: m, high: Math.min(m * (written ? 1.8 : 2.5), installs),
        lifetime,
        method: `Recent review rate (${v.perDay}/day over ${v.spanDays} days) × lifetime installs per ${written ? 'written review' : 'rating'} (${Math.round(perReview)}).`,
        confidence: 'medium',
        inputs: { ...inputs, installs, installsPerReview: Math.round(perReview), reviewsPerDay: v.perDay },
      };
    }
    if (installs && age) {
      const m = installs / (age / MONTH_DAYS);
      return {
        low: m * 0.3, mid: m, high: m * 1.5, lifetime,
        method: `Lifetime installs (${installs.toLocaleString()}) ÷ age (${Math.round(age / MONTH_DAYS)} months). Recent months may differ a lot.`,
        confidence: 'low',
        inputs: { ...inputs, installs },
      };
    }
    return { low: 0, mid: 0, high: 0, lifetime, method: 'No install data.', confidence: 'none', inputs };
  }

  // 3) iOS: ratings are the only public volume signal.
  const lifetime = tri((s) => (app.ratingsCount || 0) * K[s]);
  const cvDays = (now - Date.parse(app.currentVersionReleased)) / DAY;
  const cv = app.ratingsCurrentVersion;
  if (cv && cv < app.ratingsCount && cvDays >= 3 && cvDays <= 400) {
    const perDay = cv / cvDays;
    return {
      ...tri((s) => perDay * MONTH_DAYS * K[s]),
      lifetime,
      method: `${cv.toLocaleString()} ratings since the current version shipped ${Math.round(cvDays)} days ago (${perDay.toFixed(1)}/day) × ${K.join('/')} downloads per rating.`,
      confidence: 'low',
      inputs: { ...inputs, ratingsPerDay: +perDay.toFixed(2), downloadsPerRating: K },
    };
  }
  if (app.ratingsCount && age) {
    const perDay = app.ratingsCount / age;
    return {
      ...tri((s) => perDay * MONTH_DAYS * K[s] * [0.4, 1, 1.5][s]),
      lifetime,
      method: `Lifetime ratings (${app.ratingsCount.toLocaleString()}) ÷ age × ${K.join('/')} downloads per rating. Apple didn't reset ratings for this version, so there's no recent rate.`,
      confidence: 'low',
      inputs: { ...inputs, ratingsCount: app.ratingsCount, downloadsPerRating: K },
    };
  }
  return { low: 0, mid: 0, high: 0, lifetime, method: 'No ratings yet: too little signal.', confidence: 'none', inputs };
}

// ---------- Revenue / MRR ----------
export function pickPrice(app, A = DEFAULT_ASSUMPTIONS) {
  const p = (app.iapPrices || []).filter((x) => x > 0);
  let price;
  let source;
  if (app.store === 'android' && p.length === 2) {
    price = Math.sqrt(p[0] * p[1]); // geometric mean of Play's min–max IAP range
    source = `geometric mean of Play IAP range ${app.iapRange}`;
  } else if (p.length) {
    price = median(p);
    source = `median of ${p.length} listed IAP prices`;
  } else {
    price = A.defaultSubPrice;
    source = 'default price (IAP prices unknown)';
  }
  const yearly = price > A.yearlyThreshold;
  return { price, monthly: yearly ? price / 12 : price, yearly, source };
}

export function estimateRevenue(app, dl, A = DEFAULT_ASSUMPTIONS, now = Date.now()) {
  const cut = A.storeCut;
  const keep = 1 - cut;
  const notes = [];
  const age = ageDays(app, now) || 365;
  const ageMonths = age / MONTH_DAYS;
  const D = [dl.low, dl.mid, dl.high];

  const upfront = app.price > 0 ? tri((s) => D[s] * app.price * keep) : null;

  let mrr = null;
  let price = null;
  let subscribers = null;
  if (app.offersIAP !== false) {
    price = pickPrice(app, A);
    subscribers = tri((s) => {
      const c = A.monthlyChurn[s];
      const newPaying = D[s] * A.payConversion[s];
      return newPaying * (1 - Math.pow(1 - c, ageMonths)) / c;
    });
    mrr = tri((s) => [subscribers.low, subscribers.mid, subscribers.high][s] * price.monthly * keep);
    if (app.offersIAP == null) {
      notes.push('In-app purchase status unknown: assumed it has a subscription. Low case set to $0.');
      mrr.low = 0;
    }
  } else notes.push('No in-app purchases listed: no subscription revenue.');

  const ads = app.adSupported ? tri((s) => D[s] * A.adDauPerMonthlyDownload[s] * A.adArpdau[s] * MONTH_DAYS) : null;
  if (app.store === 'ios') notes.push('Apple does not disclose whether an app shows ads: ad revenue not estimated for iOS.');

  const sum = (s) => clamp0([mrr, upfront, ads].reduce((t, x) => t + (x ? [x.low, x.mid, x.high][s] : 0), 0));
  return {
    mrr,
    upfront,
    ads,
    monthly: tri(sum),
    subscribers,
    price,
    notes,
    method:
      `New payers = downloads × ${A.payConversion.map(pct).join('/')}; ` +
      `subscribers accumulate over ${Math.round(ageMonths)} months with ${A.monthlyChurn.map(pct).join('/')} monthly churn; ` +
      `MRR = subscribers × ${price ? '$' + price.monthly.toFixed(2) + '/mo' : 'price'} × ${(keep * 100).toFixed(0)}% after store cut.`,
  };
}

export function estimate(app, A = DEFAULT_ASSUMPTIONS, hist = [], now = Date.now()) {
  const downloads = estimateDownloads(app, A, hist, now);
  const revenue = estimateRevenue(app, downloads, A, now);
  return { downloads, revenue, confidence: downloads.confidence };
}

// ---------- Formatting ----------
export function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '–';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
  return String(Math.round(n));
}
export const fmtMoney = (n) => (n == null || !Number.isFinite(n) ? '–' : '$' + fmtNum(n));
export const fmtRange = (r, f = fmtNum) => (r ? `${f(r.low)} – ${f(r.high)}` : '–');
