// ── Config ─────────────────────────────────────────────────────────────────
export const CFG = {
  ocUrl:     'https://be408b7e-0fdc-4e2c-a227-52d97cd3c704.cfargotunnel.com',
  aiUrl:     'https://api.openai.com/v1/chat/completions',
  aiKey:     '',
  aiModel:   'gpt-4o',
  sysPrompt: 'You are Jarvis, the AI CEO of Summit Brands (ChefBox Reserve, Aura, Sprig & Fork). Be concise and data-driven.',
};

export function loadCFG() {
  try { Object.assign(CFG, JSON.parse(localStorage.getItem('jarvis_cfg') || '{}')); } catch {}
}
export function saveCFG(patch) {
  Object.assign(CFG, patch);
  localStorage.setItem('jarvis_cfg', JSON.stringify(CFG));
}

// ── Supabase ────────────────────────────────────────────────────────────────
const SB_URL  = 'https://jyyqrlfxaypjdxwmurnt.supabase.co';
const SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5eXFybGZ4YXlwamR4d211cm50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU1MzI3NTIsImV4cCI6MjA2MTEwODc1Mn0.F5kFEBx3pTfk1mvETGUGmCBsiyGEZRfkJiI0lnNxpGs';

async function sb(table, qs = '') {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?${qs}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Live fetchers ────────────────────────────────────────────────────────────
export async function fetchMRR() {
  // Try fetching all members to compute MRR
  const rows = await sb('chefbox_members', 'select=name,status,weekly_rate');
  if (!rows || !rows.length) {
    // Fallback from known data: 7 active @ ~$175/wk avg + Ronnie @ $214
    return { mrr: Math.round((6*175 + 214)*4.33), active: 7, paused: 2, source: 'fallback' };
  }
  const active = rows.filter(m => (m.status||'').toLowerCase() === 'active');
  const paused = rows.filter(m => (m.status||'').toLowerCase() !== 'active');
  const mrr = active.reduce((s,m) => s + (Number(m.weekly_rate)||175)*4.33, 0);
  return { mrr: Math.round(mrr), active: active.length, paused: paused.length, source: 'live' };
}

export async function fetchMembers() {
  const rows = await sb('chefbox_members', 'select=name,status,weekly_rate&order=name');
  if (rows && rows.length) {
    return rows.map(m => ({
      name:   m.name || '—',
      plan:   m.weekly_rate ? `$${m.weekly_rate}/wk` : '$175/wk',
      status: (m.status || 'active').toLowerCase(),
    }));
  }
  return MEMBERS_STATIC;
}

export async function fetchBookings() {
  const rows = await sb('booking_conflicts', 'select=client_name,booking_date,total_amount,status&deposit_paid=eq.true&order=booking_date&limit=10');
  if (rows && rows.length) {
    return rows.map(b => ({
      client: b.client_name || 'Client',
      date:   b.booking_date ? new Date(b.booking_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—',
      amount: b.total_amount ? `$${Number(b.total_amount).toLocaleString()}` : '—',
      brand:  'Sprig & Fork',
      status: b.status || 'confirmed',
    }));
  }
  return [];
}

export async function fetchAuraEvents() {
  const today = new Date().toISOString().split('T')[0];
  const rows = await sb('events', `select=client_name,event_date,status&event_date=gte.${today}&order=event_date&limit=6`);
  if (rows && rows.length) {
    return rows.map(e => ({
      client: e.client_name || 'Client',
      date:   e.event_date ? new Date(e.event_date).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : '—',
      brand:  'Aura',
      status: e.status || 'upcoming',
    }));
  }
  return [];
}

export async function fetchBlogPosts() {
  const rows = await sb('blog_posts', 'select=slug,status&status=eq.published');
  if (!rows) return { chefbox:3, aura:3, sprig:3, total:9 };
  const cb = rows.filter(p => /personal-chef|chef-nashville|meal-delivery/.test(p.slug||'')).length || 3;
  const au = rows.filter(p => /private-chef|private-dining|rehearsal|proposal/.test(p.slug||'')).length || 3;
  const sp = rows.filter(p => /catering|corporate|office/.test(p.slug||'')).length || 3;
  return { chefbox: cb, aura: au, sprig: sp, total: rows.length };
}

// ── Static fallbacks ─────────────────────────────────────────────────────────
export const MEMBERS_STATIC = [
  { name:'Jenn',            plan:'TBD/wk',  status:'active' },
  { name:'Hayley Williams', plan:'$175/wk', status:'paused',  note:'Resumes May 18' },
  { name:'Melissa',         plan:'$175/wk', status:'paused',  note:'~2 wk remaining' },
  { name:'Heather',         plan:'$175/wk', status:'active' },
  { name:'Jojo',            plan:'$175/wk', status:'active' },
  { name:'Kellar',          plan:'$175/wk', status:'active' },
  { name:'Keegan',          plan:'$175/wk', status:'active' },
  { name:'Ronnie',          plan:'$214/wk', status:'active',  note:'Rejoined Jan 2026' },
  { name:'Terrin',          plan:'$175/wk', status:'active' },
];

// ── Agent definitions ────────────────────────────────────────────────────────
export const AGENTS = [
  { id:'JARVIS', name:'Jarvis', role:'CEO — Strategy & Routing',      color:'#2DD4A8', icon:'🧠',
    desc:'Orchestrates all agents, routes tasks, sends daily briefings and revenue snapshots to Joshua.',
    crons:['morning-recap','revenue-snapshot-daily','summit-ceo-morning-plan'] },
  { id:'CIPHER', name:'Cipher', role:'Sales — Outreach & Pipeline',   color:'#7c6bff', icon:'📡',
    desc:'Cold email sequences for all 3 brands, HubSpot CRM sync, reply detection, LinkedIn prospect sourcing.',
    crons:['cipher-chefbox-sales','cipher-aura-sales','cipher-sprig-sales','reply-checker','cipher-linkedin-prospects'] },
  { id:'FORGE',  name:'Forge',  role:'Marketing — Content & SEO',     color:'#f59e0b', icon:'✍️',
    desc:'Publishes SEO blog posts 3×/week across all brands, LinkedIn daily posts, social content rotation.',
    crons:['seo-content-agent','social-daily-native','summit-marketing-daily','linkedin-daily-post'] },
  { id:'SCOUT',  name:'Scout',  role:'SEO — Analytics & Lead Mining', color:'#34d399', icon:'🔍',
    desc:'Weekly GA4 + Search Console analysis, priority action reports, free lead sourcing via Tavily web search.',
    crons:['seo-analytics-weekly','free-lead-engine-daily'] },
  { id:'NOVA',   name:'Nova',   role:'CX — Reviews & Inbound',        color:'#fb7185', icon:'⭐',
    desc:'Sends one-time GBP review requests to ChefBox members, post-event requests for Aura/Sprig, Typeform inbound.',
    crons:['review-agent-daily','typeform-inbound-handler'] },
  { id:'ATLAS',  name:'Atlas',  role:'Growth — Referral Partners',    color:'#a78bfa', icon:'🤝',
    desc:'Sources and pitches referral partners — wedding planners, financial advisors, RE brokers. $75/$200/$100 deals.',
    crons:['referral-engine-daily'] },
  { id:'TITAN',  name:'Titan',  role:'Ops — Bookings & Fulfillment',  color:'#60a5fa', icon:'⚙️',
    desc:'Monitors Sprig bookings (booking_conflicts), Aura events table, auto-creates HubSpot deals, triggers reviews.',
    crons:['sprig-booking-monitor','aura-booking-monitor','summit-ops-daily'] },
];

// ── Cron schedule ────────────────────────────────────────────────────────────
export const CRONS = [
  { agent:'JARVIS', name:'Morning Recap',        sched:'7:30am CT daily',       desc:'Overnight activity, priorities, KPIs → Telegram' },
  { agent:'JARVIS', name:'Revenue Snapshot',     sched:'8:00am CT daily',       desc:'MRR delta, member changes → Telegram' },
  { agent:'JARVIS', name:'CEO Morning Plan',     sched:'8:00am CT daily',       desc:'Full orchestration, HTML report → Joshua email' },
  { agent:'CIPHER', name:'ChefBox Sales',        sched:'1:00pm CT daily',       desc:'Cold email sequence for ChefBox ICP leads' },
  { agent:'CIPHER', name:'Aura Sales',           sched:'1:15pm CT daily',       desc:'Aura booking outreach — private dining proposals' },
  { agent:'CIPHER', name:'Sprig Sales',          sched:'1:30pm CT daily',       desc:'Sprig corporate catering outreach' },
  { agent:'CIPHER', name:'Reply Checker',        sched:'Every 2 hours',         desc:'Scans Gmail INBOX, updates HubSpot on reply' },
  { agent:'CIPHER', name:'LinkedIn Prospects',   sched:'9:00am CT Mon/Wed/Fri', desc:'Fresh prospect list → Telegram for Joshua' },
  { agent:'FORGE',  name:'SEO Blog Content',     sched:'10:00am CT Mon/Wed/Fri',desc:'Keyword blog post → Supabase → all 3 sites' },
  { agent:'FORGE',  name:'Social Daily Native',  sched:'9:30am CT daily',       desc:'Native social post across brand channels' },
  { agent:'FORGE',  name:'LinkedIn Daily Post',  sched:'Daily',                 desc:'Joshua\'s LinkedIn — rotates brands, Typeform CTA' },
  { agent:'FORGE',  name:'Marketing Daily',      sched:'Daily',                 desc:'Content pipeline review and planning' },
  { agent:'SCOUT',  name:'SEO Analytics',        sched:'8:00am CT Mondays',     desc:'GA4 + Search Console report → Joshua email' },
  { agent:'SCOUT',  name:'Free Lead Engine',     sched:'9:00am CT daily',       desc:'Tavily search → verified email leads → HubSpot' },
  { agent:'NOVA',   name:'Review Agent',         sched:'11:00am CT daily',      desc:'Post-event review requests, one-time ChefBox asks' },
  { agent:'NOVA',   name:'Typeform Inbound',     sched:'Every 30 minutes',      desc:'Auto-reply to new leads, CRM entry, HubSpot sync' },
  { agent:'ATLAS',  name:'Referral Engine',      sched:'2:30pm CT daily',       desc:'Source + pitch referral partners, log to HubSpot' },
  { agent:'TITAN',  name:'Sprig Booking Monitor',sched:'Every 2 hrs (:30)',     desc:'Watches booking_conflicts → HubSpot deal' },
  { agent:'TITAN',  name:'Aura Booking Monitor', sched:'Every 2 hours',         desc:'Watches events table → Telegram + HubSpot deal' },
  { agent:'TITAN',  name:'Ops Daily',            sched:'10:00pm CT daily',      desc:'Health check — integrations, fulfillment review' },
  { agent:'NOVA',   name:'Neurolink Vault Sync', sched:'8:30am CT daily',       desc:'Pushes knowledge vault to GitHub private repo' },
];

// ── Activity log ─────────────────────────────────────────────────────────────
const _log = [];
export function addActivityLog(msg) {
  _log.unshift({ msg, ts: Date.now() });
  if (_log.length > 60) _log.pop();
  window.dispatchEvent(new CustomEvent('j-activity', { detail: { msg } }));
}
export function getLog() { return _log; }

// ── Helpers ───────────────────────────────────────────────────────────────────
export function fmtMRR(n) { return n ? `$${n.toLocaleString()}` : '—'; }
