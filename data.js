// ── Config ────────────────────────────────────────────────────────────────────
export const CFG = {
  mcApiUrl:   'https://be408b7e-0fdc-4e2c-a227-52d97cd3c704.cfargotunnel.com',
  ocUrl:      'https://be408b7e-0fdc-4e2c-a227-52d97cd3c704.cfargotunnel.com',
  agentName:  'Jarvis',
  aiUrl:      'https://api.openai.com/v1/chat/completions',
  aiKey:      '',
  aiModel:    'gpt-4o',
  sysPrompt:  'You are Jarvis, the AI CEO of Summit Brands Inc. You help manage ChefBox Reserve, Aura, and Sprig & Fork. You have access to live data from Supabase, HubSpot, and the Summit Brands growth OS. Be concise, decisive, and data-driven.',
};

export function loadCFG() {
  try {
    const s = JSON.parse(localStorage.getItem('jarvis_cfg') || '{}');
    Object.assign(CFG, s);
  } catch {}
}

export function saveCFG(patch) {
  Object.assign(CFG, patch);
  localStorage.setItem('jarvis_cfg', JSON.stringify(CFG));
}

// ── Supabase ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://jyyqrlfxaypjdxwmurnt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5eXFybGZ4YXlwamR4d211cm50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU1MzI3NTIsImV4cCI6MjA2MTEwODc1Mn0.F5kFEBx3pTfk1mvETGUGmCBsiyGEZRfkJiI0lnNxpGs';

async function sbFetch(table, params = '') {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${params}`, {
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${SUPABASE_ANON}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Live data fetchers ────────────────────────────────────────────────────────
export async function fetchMembers() {
  const rows = await sbFetch('chefbox_members', 'select=name,email,status,weekly_rate&order=name');
  if (!rows) return MEMBERS_FALLBACK;
  return rows.map(m => ({
    name: m.name || m.email?.split('@')[0] || 'Member',
    svc: 'ChefBox Reserve',
    plan: m.weekly_rate ? `$${m.weekly_rate}/wk` : '$175/wk',
    status: m.status || 'active',
  }));
}

export async function fetchMRR() {
  const rows = await sbFetch('chefbox_members', 'select=status,weekly_rate&status=eq.active');
  if (!rows) return { mrr: 0, active: 0, paused: 0 };
  const active = rows.filter(m => m.status === 'active');
  const paused = rows.filter(m => m.status === 'paused' || m.status === 'inactive');
  const mrr = active.reduce((s, m) => s + (Number(m.weekly_rate) || 175) * 4.33, 0);
  return { mrr: Math.round(mrr), active: active.length, paused: paused.length };
}

export async function fetchBookings() {
  const rows = await sbFetch('booking_conflicts', 'select=client_name,booking_date,total_amount,status,deposit_paid&status=eq.active&deposit_paid=eq.true&order=booking_date');
  if (!rows) return [];
  return rows.map(b => ({
    client: b.client_name || 'Client',
    date: b.booking_date ? new Date(b.booking_date).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '—',
    amount: b.total_amount ? `$${Number(b.total_amount).toLocaleString()}` : '—',
    brand: 'Sprig & Fork',
    status: 'confirmed',
  }));
}

export async function fetchAuraEvents() {
  const today = new Date().toISOString().split('T')[0];
  const rows = await sbFetch('events', `select=client_name,event_date,status&event_date=gte.${today}&order=event_date&limit=5`);
  if (!rows) return [];
  return rows.map(e => ({
    client: e.client_name || 'Client',
    date: e.event_date ? new Date(e.event_date).toLocaleDateString('en-US', {month:'short',day:'numeric'}) : '—',
    brand: 'Aura',
    status: e.status || 'upcoming',
  }));
}

export async function fetchBlogPosts() {
  const rows = await sbFetch('blog_posts', 'select=slug,status&status=eq.published');
  if (!rows) return { chefbox: 0, aura: 0, sprig: 0, total: 0 };
  const chefbox = rows.filter(p => p.slug?.includes('personal-chef') || p.slug?.includes('chef-nashville') || p.slug?.includes('meal-delivery')).length;
  const aura = rows.filter(p => p.slug?.includes('private-chef') || p.slug?.includes('private-dining') || p.slug?.includes('rehearsal') || p.slug?.includes('proposal')).length;
  const sprig = rows.filter(p => p.slug?.includes('catering') || p.slug?.includes('corporate') || p.slug?.includes('office')).length;
  return { chefbox, aura, sprig, total: rows.length };
}

export async function fetchPipeline() {
  // Static for now — HubSpot API relay not yet implemented
  return { total: 78, attempted: 75, connected: 2, deals: 1 };
}

// ── Fallback static members ───────────────────────────────────────────────────
export const MEMBERS_FALLBACK = [
  { name: 'Jenn',            svc: 'ChefBox Reserve', plan: 'TBD/wk',    status: 'active' },
  { name: 'Hayley Williams', svc: 'ChefBox Reserve', plan: '$175/wk',   status: 'paused', note: 'Resumes May 18' },
  { name: 'Melissa',        svc: 'ChefBox Reserve', plan: '$175/wk',   status: 'paused', note: '~2 wk remaining' },
  { name: 'Heather',        svc: 'ChefBox Reserve', plan: '$175/wk',   status: 'active' },
  { name: 'Jojo',           svc: 'ChefBox Reserve', plan: '$175/wk',   status: 'active' },
  { name: 'Kellar',         svc: 'ChefBox Reserve', plan: '$175/wk',   status: 'active' },
  { name: 'Keegan',         svc: 'ChefBox Reserve', plan: '$175/wk',   status: 'active' },
  { name: 'Ronnie',         svc: 'ChefBox Reserve', plan: '$214/wk',   status: 'active', note: 'Rejoined Jan 2026' },
  { name: 'Terrin',         svc: 'ChefBox Reserve', plan: '$175/wk',   status: 'active' },
];

// ── Agents ────────────────────────────────────────────────────────────────────
export const AGENTS = [
  {
    id: 'JARVIS',
    name: 'Jarvis',
    role: 'CEO — Strategy & Routing',
    color: '#2DD4A8',
    icon: '🧠',
    desc: 'Orchestrates all agents, routes tasks, sends daily briefings and revenue snapshots.',
    crons: ['morning-recap', 'revenue-snapshot-daily', 'summit-ceo-morning-plan'],
  },
  {
    id: 'CIPHER',
    name: 'Cipher',
    role: 'Sales — Outreach & Pipeline',
    color: '#7c6bff',
    icon: '📡',
    desc: 'Cold email sequences for all 3 brands, HubSpot CRM sync, reply detection, LinkedIn prospect sourcing.',
    crons: ['cipher-chefbox-sales', 'cipher-aura-sales', 'cipher-sprig-sales', 'reply-checker', 'cipher-linkedin-prospects'],
  },
  {
    id: 'FORGE',
    name: 'Forge',
    role: 'Marketing — Content & SEO',
    color: '#f59e0b',
    icon: '✍️',
    desc: 'Publishes SEO blog posts 3x/week across all brands, LinkedIn daily posts, social content rotation.',
    crons: ['seo-content-agent', 'social-daily-native', 'summit-marketing-daily', 'linkedin-daily-post'],
  },
  {
    id: 'SCOUT',
    name: 'Scout',
    role: 'SEO — Keyword Research & Analytics',
    color: '#34d399',
    icon: '🔍',
    desc: 'Weekly GA4 traffic analysis, Search Console keyword tracking, priority action reports, free lead sourcing via Tavily.',
    crons: ['seo-analytics-weekly', 'web-lead-engine-daily', 'free-lead-engine-daily'],
  },
  {
    id: 'NOVA',
    name: 'Nova',
    role: 'CX — Member Engagement & Reviews',
    color: '#fb7185',
    icon: '⭐',
    desc: 'Sends one-time GBP review requests to ChefBox members, post-event review requests for Aura/Sprig, Typeform inbound handling.',
    crons: ['review-agent-daily', 'typeform-inbound-handler'],
  },
  {
    id: 'ATLAS',
    name: 'Atlas',
    role: 'Growth — Referral Partner Network',
    color: '#a78bfa',
    icon: '🤝',
    desc: 'Sources and pitches referral partners — wedding planners, financial advisors, real estate brokers, coworking spaces. $75/$200/$100 commission deals.',
    crons: ['referral-engine-daily'],
  },
  {
    id: 'TITAN',
    name: 'Titan',
    role: 'Ops — Bookings & Fulfillment',
    color: '#60a5fa',
    icon: '⚙️',
    desc: 'Monitors Sprig bookings (booking_conflicts + catering_quotes), Aura bookings (events table), auto-creates HubSpot deals, triggers review flow.',
    crons: ['sprig-booking-monitor', 'aura-booking-monitor', 'summit-ops-daily'],
  },
];

// ── Real cron schedule ────────────────────────────────────────────────────────
export const CRON_DEFS = [
  { id:'j1', agent:'JARVIS', name:'Morning Recap',          schedule:'7:30am CT daily',       desc:'Daily briefing — overnight activity, priorities, KPIs' },
  { id:'j2', agent:'JARVIS', name:'Revenue Snapshot',       schedule:'8:00am CT daily',       desc:'MRR delta, active vs paused members, brand breakdown' },
  { id:'j3', agent:'JARVIS', name:'CEO Morning Plan',       schedule:'8:00am CT daily',       desc:'Full orchestration — emails report to Joshua, routes tasks' },
  { id:'c1', agent:'CIPHER', name:'ChefBox Sales',          schedule:'1:00pm CT daily',       desc:'Cold email sequence for ChefBox ICP leads' },
  { id:'c2', agent:'CIPHER', name:'Aura Sales',             schedule:'1:15pm CT daily',       desc:'Aura booking outreach — proposal dinner, private dining' },
  { id:'c3', agent:'CIPHER', name:'Sprig Sales',            schedule:'1:30pm CT daily',       desc:'Sprig corporate catering outreach' },
  { id:'c4', agent:'CIPHER', name:'Reply Checker',          schedule:'Every 2 hours',         desc:'Scans Gmail INBOX, updates HubSpot on reply, Telegram alert' },
  { id:'c5', agent:'CIPHER', name:'LinkedIn Prospects',     schedule:'9:00am CT Mon/Wed/Fri', desc:'Sends fresh prospect list to Telegram for manual connect' },
  { id:'f1', agent:'FORGE',  name:'SEO Blog Content',       schedule:'10:00am CT Mon/Wed/Fri',desc:'Keyword-targeted blog post → Supabase → live on all 3 sites' },
  { id:'f2', agent:'FORGE',  name:'Social Daily Native',    schedule:'9:30am CT daily',       desc:'Publishes native social post across brand channels' },
  { id:'f3', agent:'FORGE',  name:'LinkedIn Daily Post',    schedule:'Daily',                 desc:'Joshua\'s LinkedIn post — rotates ChefBox/Aura/Sprig, Typeform CTA' },
  { id:'f4', agent:'FORGE',  name:'Marketing Daily',        schedule:'Daily',                 desc:'Summit marketing agent daily tasks and content pipeline' },
  { id:'s1', agent:'SCOUT',  name:'SEO Analytics',          schedule:'8:00am CT Mondays',     desc:'GA4 traffic report + Search Console + priority action list → email' },
  { id:'s2', agent:'SCOUT',  name:'Free Lead Engine',       schedule:'9:00am CT daily',       desc:'Tavily search → contact page scraping → email-verified leads → HubSpot' },
  { id:'s3', agent:'SCOUT',  name:'Web Lead Engine',        schedule:'Daily',                 desc:'Secondary lead sourcing — web scrape verified email leads' },
  { id:'n1', agent:'NOVA',   name:'Review Agent',           schedule:'11:00am CT daily',      desc:'Post-event review requests (Aura/Sprig), one-time ChefBox asks' },
  { id:'n2', agent:'NOVA',   name:'Typeform Inbound',       schedule:'Every 30 minutes',      desc:'Auto-reply to new Typeform leads, CRM entry, HubSpot sync' },
  { id:'a1', agent:'ATLAS',  name:'Referral Engine',        schedule:'2:30pm CT daily',       desc:'Sources + pitches referral partners — planners, FAs, brokers' },
  { id:'t1', agent:'TITAN',  name:'Sprig Booking Monitor',  schedule:'Every 2 hrs (:30)',     desc:'Watches booking_conflicts + catering_quotes → HubSpot deal + review' },
  { id:'t2', agent:'TITAN',  name:'Aura Booking Monitor',   schedule:'Every 2 hours',         desc:'Watches events table → Telegram alert → HubSpot deal → review email' },
  { id:'t3', agent:'TITAN',  name:'Ops Daily',              schedule:'10:00pm CT daily',      desc:'Summit ops health check — integration status, fulfillment review' },
];

const AGENT_COLORS = { JARVIS:'#2DD4A8', CIPHER:'#7c6bff', FORGE:'#f59e0b', SCOUT:'#34d399', NOVA:'#fb7185', ATLAS:'#a78bfa', TITAN:'#60a5fa' };

// ── Activity log ──────────────────────────────────────────────────────────────
const _actLog = [];
export function addActivityLog(msg) {
  _actLog.unshift({ msg, ts: Date.now() });
  if (_actLog.length > 80) _actLog.pop();
  window.dispatchEvent(new CustomEvent('activity', { detail: { msg } }));
}
export function getActivityLog() { return _actLog; }

// ── Render helpers ────────────────────────────────────────────────────────────
export function fmt(n) { return n?.toLocaleString() ?? '—'; }
export function fmtMRR(n) { return n ? `$${n.toLocaleString()}` : '—'; }
