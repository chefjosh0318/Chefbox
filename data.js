// ── Config ─────────────────────────────────────────────────────────────────
export const CFG = {
  ocUrl:     'https://be408b7e-0fdc-4e2c-a227-52d97cd3c704.cfargotunnel.com',
  aiKey:     '',   // override via Settings — falls back to built-in key
  aiModel:   'claude-haiku-4-5',
  sysPrompt: `You are Jarvis, the AI CEO of Summit Brands Inc.
You manage three premium brands: ChefBox Reserve (private chef subscription, Nashville), Aura (private dining events, Nashville), and Sprig & Fork (corporate catering, Nashville).

Real Stripe MRR (verified): $10,236 | Target: $20,236 | Gap: $10,000
Note: Jen has a duplicate $660/wk subscription in Stripe — real rate is $660/wk (one sub). Investigating.
Active ChefBox members:
- Jen: $660/wk (in-home private chef)
- Heather Larson: $395/wk
- Terrin Courtney: $285/wk
- Melissa Hudson-Gant: $285/wk (voluntarily paused ~2wk, auto-resumes)
- Ronnie Glenn: $214/wk (rejoined Jan 2026 from $175, best winback story)
- Keegan: $175/wk
- JoJo: $175/wk
- Kellar Edwards: $175/wk
- Hayley Williams: $175/wk (paused, sub auto-resumes May 18)

HubSpot pipeline: 78 leads, 75 attempted_to_contact, 2 connected, 1 open deal.
21 cron jobs running across 7 agents: Jarvis (CEO), Cipher (Sales), Forge (Marketing), Scout (SEO), Nova (CX), Atlas (Referral), Titan (Ops).
Brands: mychefbox.com | dinewithaura.com | sprigandfork.com | personalchefnashville.com
Apollo credits exhausted until ~May 10 — using Tavily free lead engine.
Rule: Never contact active members about upsells without Joshua approval.

Be concise, executive, data-driven. Answer questions about revenue, members, pipeline, agents, and strategy.`,
};

export function loadCFG() {
  try { Object.assign(CFG, JSON.parse(localStorage.getItem('jarvis_cfg') || '{}')); } catch {}
}
export function saveCFG(patch) {
  Object.assign(CFG, patch);
  localStorage.setItem('jarvis_cfg', JSON.stringify(CFG));
}

// ── Supabase (for live bookings only) ─────────────────────────────────────
const SB  = 'https://jyyqrlfxaypjdxwmurnt.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp5eXFybGZ4YXlwamR4d211cm50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU1MzI3NTIsImV4cCI6MjA2MTEwODc1Mn0.F5kFEBx3pTfk1mvETGUGmCBsiyGEZRfkJiI0lnNxpGs';

async function sb(table, qs) {
  try {
    const r = await fetch(`${SB}/rest/v1/${table}?${qs}`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

export async function fetchBookings() {
  const [sprig, aura] = await Promise.all([
    sb('booking_conflicts', 'select=client_name,booking_date,total_amount,status&deposit_paid=eq.true&order=booking_date&limit=8'),
    sb('events', `select=client_name,event_date,status&event_date=gte.${new Date().toISOString().split('T')[0]}&order=event_date&limit=6`),
  ]);
  const out = [];
  (sprig||[]).forEach(b => out.push({
    client: b.client_name||'—', brand:'Sprig & Fork',
    date: b.booking_date ? fmt(b.booking_date) : '—',
    amount: b.total_amount ? `$${Number(b.total_amount).toLocaleString()}` : '—',
    status: b.status||'confirmed',
  }));
  (aura||[]).forEach(e => out.push({
    client: e.client_name||'—', brand:'Aura', date: e.event_date ? fmt(e.event_date) : '—',
    amount: '—', status: e.status||'upcoming',
  }));
  return out;
}
function fmt(d) { return new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }

// ── Agents ─────────────────────────────────────────────────────────────────
export const AGENTS = [
  {
    id:'JARVIS', name:'Jarvis', role:'CEO — Strategy & Routing', color:'#00e5b0', icon:'🧠',
    desc:'Orchestrates all agents. Sends daily HTML briefing to Joshua, revenue snapshots, and CEO morning plan. Routes tasks to the right agent.',
    crons:3, status:'active',
  },
  {
    id:'CIPHER', name:'Cipher', role:'Sales — Outreach & Pipeline', color:'#7b6fff', icon:'📡',
    desc:'Runs cold email sequences for ChefBox, Aura, and Sprig leads. Syncs all replies and status changes to HubSpot CRM. Sends LinkedIn prospect lists.',
    crons:5, status:'active',
  },
  {
    id:'FORGE', name:'Forge', role:'Marketing — Content & SEO', color:'#f5a623', icon:'✍️',
    desc:'Writes and publishes keyword-targeted blog posts 3×/week across all 3 brand sites via Supabase. Publishes daily LinkedIn posts for Joshua. Manages social rotation.',
    crons:4, status:'active',
  },
  {
    id:'SCOUT', name:'Scout', role:'SEO — Analytics & Lead Mining', color:'#3ddbc0', icon:'🔍',
    desc:'Runs weekly GA4 + Search Console analysis. Sends priority SEO action report to Joshua every Monday. Mines verified email leads via Tavily web search daily.',
    crons:2, status:'active',
  },
  {
    id:'NOVA', name:'Nova', role:'CX — Reviews & Inbound', color:'#f5607a', icon:'⭐',
    desc:'Sends one-time GBP review requests to ChefBox members (warm, never re-asked). Post-event review requests for Aura and Sprig. Handles all Typeform inbound leads.',
    crons:2, status:'active',
  },
  {
    id:'ATLAS', name:'Atlas', role:'Growth — Referral Network', color:'#9b7fff', icon:'🤝',
    desc:'Sources and pitches referral partners daily: wedding planners ($75/booking), financial advisors ($200/member), CRE brokers ($100/first event). 11 pitched on day 1.',
    crons:1, status:'active',
  },
  {
    id:'TITAN', name:'Titan', role:'Ops — Bookings & Fulfillment', color:'#4da6ff', icon:'⚙️',
    desc:'Monitors Sprig bookings (booking_conflicts table) and Aura events table every 2 hours. Auto-creates HubSpot deals on confirmed deposits. Triggers review flow post-event.',
    crons:3, status:'active',
  },
];

// ── Daily schedule (flat, sorted by CT time) ───────────────────────────────
export const DAILY = [
  { time:'7:30 AM CT',  agent:'JARVIS', name:'Morning Recap',         desc:'Overnight activity, priority alerts → Telegram' },
  { time:'8:00 AM CT',  agent:'JARVIS', name:'Revenue Snapshot',      desc:'MRR delta, member changes → Telegram' },
  { time:'8:00 AM CT',  agent:'JARVIS', name:'CEO Morning Plan',      desc:'Full orchestration, HTML report → Joshua email' },
  { time:'8:30 AM CT',  agent:'JARVIS', name:'Neurolink Vault Sync',  desc:'Knowledge vault → GitHub private repo' },
  { time:'9:30 AM CT',  agent:'FORGE',  name:'Social Post',           desc:'Native social post across brand channels' },
  { time:'Every 30m',   agent:'NOVA',   name:'Typeform Inbound',      desc:'Auto-reply new leads, CRM entry, HubSpot sync' },
  { time:'Every 2h',    agent:'CIPHER', name:'Reply Checker',         desc:'Scan Gmail INBOX → HubSpot update → Telegram alert' },
  { time:'Every 2h',    agent:'TITAN',  name:'Sprig Booking Monitor', desc:'Watch booking_conflicts → HubSpot deal on deposit' },
  { time:'Every 2h',    agent:'TITAN',  name:'Aura Booking Monitor',  desc:'Watch events table → Telegram + HubSpot deal' },
  { time:'11:00 AM CT', agent:'NOVA',   name:'Review Agent',          desc:'Post-event GBP review requests (Aura/Sprig/ChefBox)' },
  { time:'1:00 PM CT',  agent:'CIPHER', name:'ChefBox Sales',         desc:'Cold email sequence for ChefBox ICP leads' },
  { time:'1:15 PM CT',  agent:'CIPHER', name:'Aura Sales',            desc:'Outreach — private dining, proposal dinners' },
  { time:'1:30 PM CT',  agent:'CIPHER', name:'Sprig Sales',           desc:'Corporate catering outreach' },
  { time:'2:30 PM CT',  agent:'ATLAS',  name:'Referral Engine',       desc:'Source + pitch referral partners, log to HubSpot' },
  { time:'10:00 PM CT', agent:'TITAN',  name:'Ops Daily',             desc:'Health check — integrations, fulfillment, gaps' },
  { time:'Daily',       agent:'FORGE',  name:'LinkedIn Post',         desc:'Joshua\'s LinkedIn — rotates brands, Typeform CTA' },
];

export const WEEKLY = [
  { day:'Mon/Wed/Fri', agent:'FORGE',  name:'SEO Blog Content',    desc:'Keyword post → Supabase → live on all 3 sites (10 AM CT)' },
  { day:'Mon/Wed/Fri', agent:'CIPHER', name:'LinkedIn Prospects',  desc:'Fresh prospect list → Telegram for Joshua (9 AM CT)' },
  { day:'Monday',      agent:'SCOUT',  name:'SEO Analytics',       desc:'GA4 + Search Console report + priority actions → Joshua email (8 AM CT)' },
];

// ── Activity log ──────────────────────────────────────────────────────────
const _log = [];
export function addActivityLog(msg) {
  _log.unshift({ msg, ts: Date.now() });
  if (_log.length > 60) _log.pop();
  window.dispatchEvent(new CustomEvent('jact', { detail: { msg } }));
}

// ── Agent colors ──────────────────────────────────────────────────────────
export const ACOLORS = {
  JARVIS:'#00e5b0', CIPHER:'#7b6fff', FORGE:'#f5a623',
  SCOUT:'#3ddbc0',  NOVA:'#f5607a',   ATLAS:'#9b7fff', TITAN:'#4da6ff',
};
