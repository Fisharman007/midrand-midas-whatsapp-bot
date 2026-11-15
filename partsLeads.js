// Parts leads — one row per completed parts quote request, shown on the separate
// "mid-midas-parts-leads" Vercel page so staff can phone the customer and record who quoted.
//
// Lives in its own Postgres (PARTS_DATABASE_URL), separate from the battery leads database.
// Without PARTS_DATABASE_URL an in-memory store is used (local dev / tests).
// The staff Google Sheet still gets every parts lead too (logLead in aiConversation.js).

const crypto = require('crypto');
const { phoneDigits, sslFor } = require('./batteryLeads');

const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

// Name and phone must come from the webhook, never from the AI's tool input
function buildPartsLead({ from, customerName, vehicle, parts, fulfilment, deliveryAddress }) {
  const deliver = fulfilment === 'deliver';
  return {
    phone:           phoneDigits(from),
    customerName:    customerName || '',
    vehicle:         vehicle || '',
    parts:           parts || '',
    fulfilment:      deliver ? 'deliver' : 'collect',
    deliveryAddress: deliver ? (deliveryAddress || '') : '',
  };
}

function newLeadId(nowMs) {
  const d = new Date(nowMs + SAST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '');
  return `MP-${d}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

async function savePartsLead(lead, store = defaultStore(), now = Date.now()) {
  const leadId = newLeadId(now);
  await store.insert({ ...lead, leadId, createdAt: now, status: 'New' });
  return { leadId };
}

// A database blip must not lose the lead: retry after each delay (30s, 2min, 10min by default).
const RETRY_DELAYS_MS = [30 * 1000, 2 * 60 * 1000, 10 * 60 * 1000];
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function saveWithRetry(lead, { save = l => savePartsLead(l), delays = RETRY_DELAYS_MS } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await save(lead);
    } catch (err) {
      if (attempt >= delays.length) throw err;
      console.warn(`[PartsLead] Save failed (${err.message}), retrying in ${Math.round(delays[attempt] / 1000)}s`);
      await sleep(delays[attempt]);
    }
  }
}

// Every save attempt failed. The lead is already on the staff Google Sheet, so only log it (masked).
function recordUnsavedLead(lead, err) {
  console.error('[LEAD-UNSAVED] parts — not on the dashboard, but it is on the leads sheet:', err.message, JSON.stringify(forLogs(lead)));
}

// What a parts lead may show in the logs: masked number, no name or delivery address
// (the staff sheet and the dashboard hold the full lead).
function forLogs(lead) {
  return { phone: '****' + String(lead.phone).slice(-4), vehicle: lead.vehicle, parts: lead.parts, fulfilment: lead.fulfilment };
}

function createMemoryStore() {
  const rows = [];
  return {
    rows,
    async insert(row) { rows.push({ ...row }); },
  };
}

function createPgStore(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString, ssl: sslFor(connectionString), max: 3, connectionTimeoutMillis: 5000 });
  // Without this, an idle connection dropped by Postgres (restart, network blip) crashes the whole bot
  pool.on('error', err => console.error('[PartsLeads] Postgres connection error:', err.message));

  // Created on first use; a failed attempt (e.g. DB down at startup) is retried on the next save
  let ready = null;
  const ensureTable = () => {
    ready ??= pool.query(`
      CREATE TABLE IF NOT EXISTS parts_leads (
        lead_id           TEXT PRIMARY KEY,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        customer_name     TEXT,
        phone             TEXT,
        vehicle           TEXT,
        parts             TEXT,
        fulfilment        TEXT,
        delivery_address  TEXT,
        status            TEXT NOT NULL DEFAULT 'New',
        status_updated_at TIMESTAMPTZ,
        salesman          TEXT,
        notes             TEXT
      )`).then(() => console.log('[PartsLeads] parts_leads table ready'))
      .catch(err => { ready = null; throw err; });
    return ready;
  };

  return {
    pool,
    async insert(r) {
      await ensureTable();
      await pool.query(
        `INSERT INTO parts_leads (lead_id, created_at, customer_name, phone, vehicle, parts, fulfilment,
           delivery_address, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [r.leadId, new Date(r.createdAt), r.customerName, r.phone, r.vehicle, r.parts, r.fulfilment,
          r.deliveryAddress, r.status]);
    },
  };
}

let store;
function defaultStore() {
  store ??= process.env.PARTS_DATABASE_URL ? createPgStore(process.env.PARTS_DATABASE_URL) : createMemoryStore();
  return store;
}

module.exports = { buildPartsLead, forLogs, savePartsLead, saveWithRetry, recordUnsavedLead, createMemoryStore, createPgStore };
