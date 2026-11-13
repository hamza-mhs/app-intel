// "What to clone": a build plan for one product, assembled from evidence rather than guessed:
//  - the core feature set buyers in its category expect (a curated list per product family),
//  - features its own reviewers ask for or miss (extracted from reviews and complaints),
//  - what they hate (so the clone fixes it instead of copying it),
//  - the wedge (research play, category opening, top complaint theme) and a price anchor.
// The family lists are a starting checklist, not a spec: always confirm on the product's own site.

const F = (re, name, core, later, avoid) => ({ re, name, core, later, avoid });
export const FAMILIES = [
  F(/social media|post schedul|social schedul/i, 'Social media scheduling', ['Connect Instagram, Facebook, LinkedIn, X, TikTok via official APIs', 'Composer with per-network previews and media upload', 'Queue/calendar with scheduled publishing', 'Basic analytics (reach, engagement per post)'], ['AI caption help', 'Team approval workflow', 'Link-in-bio page', 'Bulk CSV upload'], ['Social listening / inbox at launch (expensive APIs)']),
  F(/landing[- ]page|website builder|site builder|page builder/i, 'Website & landing-page builder', ['Template-based visual editor (sections, not free-form pixels)', 'Custom domains + SSL', 'Forms that capture leads', 'Mobile-responsive output, SEO meta', 'Publishing + hosting on a CDN'], ['A/B testing', 'Popups', 'Analytics', 'Integrations with email tools'], ['A full CMS/e-commerce stack at launch']),
  F(/popup|cro\b|a\/b test|conversion|social[- ]proof/i, 'Popups, CRO & A/B testing', ['Popup/bar/slide-in builder with triggers (exit intent, scroll, delay)', 'Targeting rules (page, device, new vs returning)', 'Lightweight JS snippet', 'Lead capture to email tools', 'Impression/conversion stats'], ['A/B tests with significance', 'Social-proof notifications', 'Templates gallery'], ['Heavy scripts that slow sites (top complaint in this category)']),
  F(/link shorten|qr code|short link/i, 'Link shorteners & QR codes', ['Short links on custom domains', 'Click analytics (country, device, referrer)', 'Static + dynamic QR codes with styling', 'UTM builder', 'Link editing after publishing'], ['Teams + API', 'Link-in-bio page', 'Retargeting pixels'], ['Free unlimited plan without abuse controls (phishing risk)']),
  F(/cold (email|outreach)|outreach|sales engagement|email sequenc/i, 'Cold email & outreach', ['Connect Gmail/Outlook/SMTP inboxes', 'Sequences with steps, delays and personalisation variables', 'Inbox rotation + sending limits', 'Reply detection that stops the sequence', 'Basic analytics (opens, replies)'], ['Email warm-up', 'Unified reply inbox', 'Lead lists import + CRM sync'], ['Selling scraped contact data']),
  F(/link[- ]in[- ]bio|bio link|personal page/i, 'Link-in-bio', ['Mobile page with links, socials and embeds', 'Themes + custom domain', 'Click analytics', 'Email capture'], ['Selling digital products / tips', 'Scheduling links'], ['A full website builder']),
  F(/affiliate|referral|partner program/i, 'Affiliate & referral programs', ['Referral links + tracking (cookie + coupon)', 'Stripe/Shopify integration to attribute sales', 'Affiliate portal', 'Commission rules + payout reports'], ['Automatic payouts (PayPal/Wise)', 'Fraud checks', 'Marketplace of affiliates'], ['Holding affiliates’ money yourself (money transmission rules)']),
  F(/subscription management|saas spend|spend management|license management/i, 'SaaS spend management', ['Discover subscriptions (card/accounting feeds or email receipts)', 'Renewal calendar + alerts', 'Owner and seat tracking per tool', 'Cost dashboard'], ['Offboarding checklist', 'Usage via SSO logs'], ['Negotiation services at launch']),
  F(/expense|receipt/i, 'Expenses & receipts', ['Receipt capture (photo/email) with OCR', 'Categories + export to accounting tools', 'Mileage', 'Reports'], ['Approvals', 'Card feeds'], ['Issuing cards (regulated)']),
  F(/okr|goal|1:1|one-on-one|performance review/i, 'OKRs, goals & 1:1s', ['Goals with key results and check-ins', '1:1 agendas with shared notes and action items', 'Slack/Teams reminders', 'Templates'], ['Performance reviews', 'Engagement surveys'], ['A full HRIS']),
  F(/text expan|snippet|clipboard/i, 'Text expansion & clipboard', ['Snippets with shortcuts and variables', 'Works across apps (desktop) or in browser (extension)', 'Sync across devices', 'Shared team snippets'], ['Forms/fill-ins', 'AI snippets'], ['Keylogging-like permissions without a clear trust story']),
  F(/transactional (email|sms)|email api|sms api|messaging api/i, 'Transactional email & SMS APIs', ['Send API + SMTP relay', 'Domain authentication (SPF/DKIM/DMARC) setup', 'Logs, webhooks for bounces and opens', 'Templates'], ['Inbound parsing', 'Dedicated IPs'], ['Your own MTA fleet at launch: resell SES/Postmark with a better product']),
  F(/webinar|video meeting|video conferenc|virtual event/i, 'Video meetings & webinars', ['Registration page + reminders (built on a video API like Daily/LiveKit)', 'Live room with screen share and chat', 'Recordings and replays', 'Attendee export'], ['Polls/Q&A', 'Evergreen/automated webinars', 'CRM sync'], ['Your own media servers']),
  F(/screenshot|annotat|screen capture/i, 'Screenshots & annotation', ['Capture area/window/full page', 'Annotate (arrows, blur, text)', 'Instant share link', 'History'], ['Scrolling capture', 'Team folders', 'Integrations (Jira, Slack)'], []),
  F(/sms marketing|whatsapp|text messag/i, 'SMS & WhatsApp marketing', ['Contacts + opt-in/consent handling', 'Campaigns and two-way inbox via Twilio/WhatsApp Cloud API', 'Templates + scheduling', 'Click/reply analytics'], ['Automations (abandoned cart, reminders)', 'Shopify integration'], ['Unregistered A2P sending (carrier blocks)']),
  F(/receptionist|phone agent|voice agent|answering service|call answer/i, 'AI receptionists & phone agents', ['Phone number + AI voice agent answering FAQs (Twilio + a realtime voice model)', 'Booking/lead capture into calendar or CRM', 'Call transcripts + summaries by email', 'Human transfer'], ['Outbound reminders', 'Multi-language'], ['Building your own speech models']),
  F(/error track|logging|log management|observab|apm/i, 'Logging & error tracking', ['SDKs for 2-3 popular stacks', 'Error grouping + stack traces', 'Alerts (email, Slack)', 'Search + retention'], ['Performance traces', 'Release tracking'], ['General observability breadth']),
  F(/resume|cv\\b|job search|job application|cover letter/i, 'Job search & resumes', ['Resume builder with ATS-friendly templates + PDF export', 'Tailor resume to a job post (AI)', 'Application tracker', 'Cover letter generator'], ['Chrome extension to save jobs', 'Interview practice'], ['Auto-applying spam (gets accounts banned)']),
  F(/schedul(ing|er)|booking|appointment|calendly/i, 'Scheduling & booking', ['Booking page with availability rules (working hours, buffers, min notice)', 'Google + Outlook calendar sync with conflict checking', 'Event types (length, location, questions)', 'Email confirmations + reminders, reschedule/cancel links', 'Time-zone handling', 'Stripe deposits / paid bookings'], ['Round-robin and team pages', 'Routing forms', 'SMS/WhatsApp reminders', 'Embeds + API/webhooks'], ['Full CRM', 'Video conferencing of your own']),
  F(/calendar|time management|daily plan|auto-?schedul/i, 'Calendar & planning', ['Unified calendar across Google/Outlook accounts', 'Task list with drag-to-calendar time blocking', 'Daily planning view', 'Calendar-to-calendar busy sync'], ['Auto-scheduling of tasks', 'Focus-time protection', 'Integrations (Todoist, Linear, Notion)'], ['Building your own calendar server']),
  F(/form builder|forms?\b(?!.*e-?sign)/i, 'Form builder', ['Drag-and-drop form editor with common field types', 'Conditional logic', 'Hosted form link + embed snippet', 'Submissions table, CSV export, email notifications', 'Spam protection'], ['Payments in forms (Stripe)', 'File uploads', 'Integrations (Sheets, Zapier, webhooks)', 'Multi-page + save-and-resume'], ['PDF/e-signature workflows at launch']),
  F(/survey|quiz|nps|feedback widget/i, 'Surveys, quizzes & NPS', ['Survey/quiz builder with question types', 'Branching logic', 'Share link, embed and in-app/website widget', 'Results dashboard with charts + CSV export'], ['NPS/CSAT automation by email', 'Scoring and outcome pages for quizzes', 'Integrations and webhooks'], ['Panel/respondent marketplace']),
  F(/email marketing|newsletter|mailing list|drip/i, 'Email marketing & newsletters', ['List + subscriber management with imports and double opt-in', 'Signup forms/landing page', 'Editor for campaigns (block or Markdown)', 'Sending via SES/Postmark with bounce + unsubscribe handling', 'Open/click stats'], ['Automations (welcome sequence, tags)', 'Paid newsletter subscriptions', 'Segments'], ['Your own SMTP infrastructure; deliverability is the hard part, rent it']),
  F(/live chat|chatbot|chat widget|customer messaging|conversational/i, 'Live chat & chatbots', ['Website chat widget with one-line install (plus WordPress/Shopify plugins)', 'Shared agent inbox with assignment and canned replies', 'Offline message capture to email', 'AI bot that answers from your FAQ/knowledge base, with human handoff', 'Visitor info (page, location, cart)'], ['Mobile agent apps', 'WhatsApp/Messenger/Instagram channels', 'Analytics (response time, CSAT)'], ['Per-resolution AI pricing (a top complaint): price AI flat or bring-your-own-key']),
  F(/cookie|consent|gdpr|ccpa|privacy banner/i, 'Cookie consent', ['Cookie banner with accept/reject/customise', 'Automatic cookie scanner + categorisation', 'Script blocking until consent', 'Consent log for audits', 'Google Consent Mode v2'], ['Geo-targeted rules (GDPR vs CCPA)', 'Privacy-policy generator', 'Multi-language'], ['Legal advice: ship templates, not guarantees']),
  F(/review widget|reviews? (app|display)|testimonial|ugc/i, 'Reviews & testimonials', ['Collect reviews by email/link after purchase', 'Display widgets (carousel, wall, badge)', 'Import from Google/Shopify/Trustpilot exports', 'Moderation'], ['Photo/video reviews', 'Google rich snippets', 'Incentives'], ['Fake-review features (legal risk)']),
  F(/accessibility|wcag|ada compliance/i, 'Accessibility', ['Automated WCAG scan with fix list', 'Monitoring + reports', 'Accessibility statement generator'], ['Manual audit marketplace', 'CI integration'], ['Overlay-only “instant compliance” claims (lawsuits target them)']),
  F(/widget|chat bubble|banner/i, 'Website widgets', ['Embeddable widget with one-line install', 'Dashboard to configure look and rules', 'Core job of the widget (chat inbox / consent banner + log / reviews display)', 'Per-domain billing'], ['AI answers from a knowledge base (chat)', 'Geo rules + Google Consent Mode v2 (consent)', 'Mobile apps for agents (chat)'], ['Bundling every widget type at once']),
  F(/recruit|applicant|ats\b|hiring/i, 'Recruiting & ATS', ['Job posts with a hosted careers page', 'Application form + resume upload', 'Kanban pipeline by stage', 'Email candidates from the app, notes and ratings', 'Job board syndication (free boards first)'], ['Interview scheduling', 'Scorecards', 'AI resume screening'], ['Payroll/HRIS']),
  F(/lead data|enrichment|prospect|b2b data|contact data/i, 'Lead data & enrichment', ['Enrich email/domain to company + person fields via licensed providers', 'CSV upload and bulk enrichment', 'Email verification', 'Credits-based pricing'], ['Chrome extension for LinkedIn', 'CRM sync'], ['Building your own scraped database (legal + data-quality risk)']),
  F(/transcri|dictation|speech|voice|meeting notes|note ?taker/i, 'Voice, transcription & meeting notes', ['Upload/record audio and transcribe (Whisper/Deepgram)', 'Speaker labels, timestamps, editing', 'Summaries + action items', 'Export (TXT/DOCX/SRT)'], ['Meeting bot for Zoom/Meet/Teams', 'Custom vocabulary', 'Search across recordings'], ['Training your own ASR model']),
  F(/crm\b|customer relationship|pipeline|sales pipeline/i, 'CRM', ['Contacts + companies with custom fields', 'Deal pipeline (kanban)', 'Email sync / BCC logging', 'Tasks and reminders', 'CSV import/export'], ['Email sequences', 'Reporting', 'Integrations (forms, calendars)'], ['Enterprise customisation; pick one vertical instead']),
  F(/invoice|invoicing|billing|quote|estimate|proposal/i, 'Invoicing, quotes & proposals', ['Clients + invoice/quote builder with PDF', 'Online payment links (Stripe/PayPal)', 'Recurring invoices and reminders', 'Taxes and multi-currency basics'], ['Proposal templates with e-sign acceptance', 'Expense tracking', 'Accounting export'], ['Full double-entry accounting (regulated, hard)']),
  F(/time track|timesheet|timer/i, 'Time tracking', ['One-click timer + manual entries', 'Projects/clients with hourly rates', 'Reports and CSV export', 'Browser extension'], ['Invoicing from tracked time', 'Team approvals', 'Idle detection'], ['Employee surveillance features (screenshots): reputational risk']),
  F(/project manage|task manage|kanban|to-?do|work management/i, 'Project & task management', ['Tasks with assignees, due dates, comments', 'List + board views', 'Notifications and @mentions', 'Templates'], ['Timeline/Gantt', 'Automations', 'Integrations (Slack, GitHub)'], ['Trying to match Asana/ClickUp breadth']),
  F(/help ?desk|customer support|ticket|support desk|knowledge base/i, 'Help desk & support', ['Shared inbox from email with ticket statuses', 'Assignment, internal notes, canned replies', 'Customer history', 'Knowledge base'], ['Live chat widget', 'SLAs and reporting', 'AI reply drafts'], ['Phone/call-center features at launch']),
  F(/analytic|dashboard|reporting|business intelligence|bi\b/i, 'Analytics & dashboards', ['Data connectors (start with 2-3 the niche uses)', 'Prebuilt dashboards for that niche', 'Scheduled email reports', 'Sharing links'], ['Custom metrics', 'Alerts', 'Multi-client agency view'], ['A general-purpose BI tool']),
  F(/seo|rank track|backlink|keyword/i, 'SEO tools', ['Rank tracking for keywords (licensed SERP API)', 'Site audit crawler (titles, links, speed)', 'Reports for clients'], ['Keyword research via data provider', 'Backlink monitoring'], ['Your own web-scale crawler/index']),
  F(/ai writ|copywrit|content generat|ai content/i, 'AI writing & content', ['Templates for the niche’s exact documents', 'Brand voice/profile', 'Editor with rewrite/expand', 'Export/publish to where the content lives'], ['Team workspaces', 'SEO scoring', 'Integrations (WordPress, Google Docs)'], ['A thin wrapper with no workflow (easy to copy, high churn)']),
  F(/e-?sign|signature|contract/i, 'E-signature & contracts', ['Upload PDF, place fields, send for signature', 'Audit trail + signed PDF', 'Templates', 'Reminders'], ['Bulk send', 'API', 'Contract repository + renewals'], ['Qualified/advanced signatures (regulated) at launch']),
  F(/screen record|video messag|loom/i, 'Screen & video messaging', ['Record screen + camera from browser/desktop', 'Instant share link with viewer page', 'Viewer analytics, comments', 'Trimming'], ['Transcripts + AI summaries', 'Team library', 'Branding'], ['Building a full video editor']),
  F(/status page|uptime|monitor/i, 'Uptime & status pages', ['HTTP/keyword/ping checks from several regions', 'Alerts (email, Slack, SMS)', 'Public status page with incidents', 'Response-time charts'], ['Cron/heartbeat monitoring', 'SSL/domain expiry', 'Subscriber notifications'], ['Full APM/observability']),
  F(/feedback|roadmap|feature request|changelog/i, 'Feedback, roadmap & changelog', ['Feedback board with voting', 'Public roadmap', 'Changelog with notifications', 'Widget + SSO for logged-in users'], ['Integrations (Linear, Jira, Intercom)', 'Prioritisation scoring'], ['Becoming a full product-analytics suite']),
  F(/course|lms|learning|education|tutor/i, 'Courses & learning', ['Course builder (video, text, quizzes)', 'Student accounts + progress', 'Payments and coupons', 'Certificates'], ['Community/discussion', 'Drip schedules', 'Mobile-friendly player'], ['Video hosting infrastructure of your own (use Mux/Bunny)']),
  F(/community|membership|forum/i, 'Community & memberships', ['Spaces/posts/comments', 'Member profiles + notifications', 'Paid tiers via Stripe', 'Events'], ['Courses', 'Mobile app', 'Integrations'], ['Building your own payments/ledger']),
  F(/password|vpn|security|antivirus|identity/i, 'Security', ['Narrow, auditable core feature', 'Strong encryption done with proven libraries', 'Clear trust page (audits, data handling)'], ['Team sharing', 'Browser extension'], ['Rolling your own crypto; trust is the product, so start narrow']),
  F(/file shar|transfer|storage|backup/i, 'File sharing & backup', ['Upload + share links with expiry/password', 'Large-file resumable uploads (S3 multipart)', 'Download tracking'], ['Branded portals', 'Client request links', 'Scheduled backups'], ['Competing with Dropbox on storage price']),
  F(/document|pdf|ocr|extract/i, 'Documents & PDF', ['Upload → process (convert, extract, OCR) → download', 'Batch jobs', 'API'], ['Templates', 'Integrations (Drive, Zapier)'], ['A full PDF editor at launch']),
  F(/hr\b|human resources|employee|onboarding|payroll|leave/i, 'HR', ['Employee directory', 'Time-off requests + approvals', 'Onboarding checklists', 'Document storage'], ['Performance reviews', 'Shift scheduling'], ['Payroll (regulated, country-specific)']),
  F(/e-?commerce|store|shop|inventory|order/i, 'Commerce tools', ['Integration with the store platform (Shopify/WooCommerce API)', 'The one workflow the niche hates doing by hand', 'Dashboard + email alerts'], ['Multi-store', 'Reports'], ['Payments, POS, shipping labels (hard niches)']),
  F(/automation|workflow|integration|ipaas/i, 'Automation & integrations', ['Triggers/actions for the 5-10 apps the niche uses most', 'Visual workflow builder', 'Run history + error retries'], ['Templates', 'Webhooks + code steps'], ['Competing with Zapier on breadth; win one vertical']),
  F(/note|wiki|docs\b|knowledge|writing/i, 'Notes, docs & wikis', ['Fast editor (Markdown/blocks)', 'Search', 'Sharing + permissions', 'Import from the incumbent'], ['Offline/sync', 'Templates', 'AI search'], ['Real-time multiplayer at launch unless it is the wedge']),
  F(/password|auth|login|sso/i, 'Auth', ['Hosted login + SDKs', 'Social + passwordless', 'User management dashboard'], ['SSO/SAML', 'MFA'], ['Enterprise compliance at launch']),
];

const ASK = /\b(wish|would (be|love)|please add|missing|lacks?|no (way|option) to|doesn'?t (support|have|allow|let)|does not (support|have|allow)|can'?t|cannot|unable to|should (have|add|support|allow)|needs? (a|an|to|better)|if only|feature request|not possible to)\b/i;
const THEME_FIX = {
  pricing: 'Simple, predictable pricing (flat tiers, no surprise renewals, a real free or cheap tier).',
  bugs: 'Reliability first: fewer features, each one solid and tested.',
  support: 'Fast human support; publish response times.',
  features: 'Ship the features reviewers keep asking for (below).',
  ux: 'A setup that takes minutes: onboarding checklist, sensible defaults, cleaner UI.',
  spam: 'No dark patterns: one-click cancel, no auto-renew traps, no spam after uninstall.',
};

function requested(reviews) {
  const out = [];
  const seen = new Set();
  for (const r of reviews) {
    if (r.stars != null && r.stars >= 4) continue;
    for (const s of String(r.text || '').split(/(?<=[.!?])\s+|\n+/)) {
      const t = s.trim();
      if (t.length < 25 || t.length > 240 || !ASK.test(t)) continue;
      const k = t.toLowerCase().replace(/[^a-z ]/g, '').slice(0, 45);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ text: t, origin: r.origin || null, url: r.url || null, stars: r.stars ?? null });
      if (out.length >= 10) return out;
    }
  }
  return out;
}

// The product's own name and description are more specific than broad categories ("Website widgets (reviews,
// chat bubbles, cookie banners…)"), so they are checked first.
export function familyFor(p) {
  const own = `${p.name || ''} ${p.description || ''}`;
  return FAMILIES.find((f) => f.re.test(own)) || FAMILIES.find((f) => f.re.test(p.category || '')) || null;
}

export function clonePlan(p, reviews = [], { categoryNote = null } = {}) {
  const fam = familyFor(p);
  const ex = p.extra || {};
  const themes = (p.themes || []).filter((t) => t.k !== 'praise' && THEME_FIX[t.k]).sort((a, b) => b.n - a.n);
  const wedge = [];
  if (ex.idea) wedge.push({ k: 'research', t: ex.idea });
  for (const t of themes.slice(0, 3)) wedge.push({ k: t.k, t: `${THEME_FIX[t.k]} (${t.n} critical review${t.n === 1 ? '' : 's'} mention ${t.label.toLowerCase()})` });
  if (categoryNote?.opening) wedge.push({ k: 'category', t: categoryNote.opening });
  if (!wedge.length) wedge.push({ k: 'segment', t: 'No dominant complaint collected yet: pick one customer segment the product serves poorly (a vertical, a country, a price point) and build only for it.' });

  // Price anchor: undercut the entry plan, or match it with a better wedge.
  let price = null;
  if (p.price_min) price = `They start at $${p.price_min}/mo. Launch around $${Math.max(5, Math.round(p.price_min * 0.6))}/mo for the core, or match their price with the wedge as the reason to switch.`;
  else if (p.pricing) price = `Their pricing: ${String(p.pricing).slice(0, 160)}. Undercut the entry tier or offer a flat plan.`;
  else if (p.mrr) price = `Verified $${Math.round(p.mrr).toLocaleString()} MRR proves willingness to pay; check their pricing page before setting yours.`;

  const weeks = ex.buildWeeks ? +ex.buildWeeks : fam ? (fam.core.length <= 4 ? 4 : 6) : null;
  const avoid = [...(fam?.avoid || [])];
  if (themes.some((t) => t.k === 'bugs')) avoid.push('Feature bloat: reviewers already complain the incumbent is unreliable.');
  return {
    family: fam?.name || null,
    core: fam?.core || [],
    later: fam?.later || [],
    avoid,
    requested: requested(reviews),
    complaints: themes.map((t) => ({ label: t.label, n: t.n, example: t.example })),
    wedge,
    price,
    mvpWeeks: weeks,
    alternatives: ex.alternatives || [],
    note: fam ? null : 'No feature checklist for this category yet: list the 4–6 things on its pricing page’s cheapest plan; that is the MVP.',
  };
}
