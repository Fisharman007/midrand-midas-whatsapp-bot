// Battery leads — one row per battery a customer picks, shown on the separate
// "mid-midas-battery-leads-dashboard" Vercel page so staff can phone them.
//
// Brand and price always come from the catalogue, never from the AI.
// Uses Postgres when DATABASE_URL is set, otherwise an in-memory store (local dev / tests).

const crypto = require('crypto');
const { getPricesForSKU, getAvailableSKUs } = require('./catalogue');

const REPICK_WINDOW_MS = 2 * 60 * 60 * 1000; // a re-pick within 2h updates the existing New lead
const SAST_OFFSET_MS   = 2 * 60 * 60 * 1000;

const phoneDigits = from => String(from || '').replace(/\D/g, '');
const codeKey     = code => String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// "646AGM", "Willard 646AGM" and "646AGM willard" all name the same option
const sameOption  = (b, key) => [codeKey(b.psku), codeKey(b.brand) + codeKey(b.psku), codeKey(b.psku) + codeKey(b.brand)].includes(key);

// The battery sizes last priced for each customer (chat history keeps only text, not tool results),
// so a lead can be matched to exactly what was quoted. Kept for the same 2h as a re-pick.
const lastQuoted = new Map(); // phone digits -> { skus: [], at }

function rememberQuote(from, sku) {
  const phone = phoneDigits(from);
  if (!phone || !sku) return;
  const prev = lastQuoted.get(phone);
  const fresh = prev && Date.now() - prev.at < REPICK_WINDOW_MS ? prev.skus.filter(s => s !== sku) : [];
  lastQuoted.set(phone, { skus: [...fresh, sku], at: Date.now() });
}

// "Option list" text for the AI: brand, product code and size of each battery last quoted.
function quotedOptionsText(from) {
  const entry = lastQuoted.get(phoneDigits(from));
  if (!entry || Date.now() - entry.at > REPICK_WINDOW_MS) return '';
  return entry.skus.flatMap(sku => getPricesForSKU(sku).map(b => `${b.brand} ${b.psku} (size ${sku})`)).join('; ');
}

// The option under the given size. If the "size" isn't a real size at all (the AI sometimes passes
// the product code there), use the one size whose list has that product code. A real size with
// another size's product code is refused — the lead must match what the customer was quoted.
function findOption(sku, productCode) {
  const key = codeKey(productCode);
  const options = getPricesForSKU(sku);
  if (options.length) {
    const direct = options.find(b => sameOption(b, key));
    return direct ? { sku, option: direct } : null;
  }
  const matches = getAvailableSKUs()
    .map(s => ({ sku: s, option: getPricesForSKU(s).find(b => sameOption(b, key)) }))
    .filter(m => m.option);
  return matches.length === 1 ? matches[0] : null;
}

function buildBatteryLead({ from, customerName, vehicle, sku, productCode }) {
  const found = findOption(sku, productCode);
  const price = Math.round(parseFloat(found?.option.price));
  if (!found || isNaN(price)) return null;
  const { option } = found;
  return {
    phone:        phoneDigits(from),
    customerName: customerName || '',
    vehicle:      vehicle || '',
    batterySku:   String(found.sku).trim().toUpperCase(),
    batteryBrand: option.brand,
    productCode:  option.psku,
    priceQuoted:  price,
  };
}

function newLeadId(nowMs) {
  const d = new Date(nowMs + SAST_OFFSET_MS).toISOString().slice(0, 10).replace(/-/g, '');
  return `MB-${d}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

async function saveBatteryLead(lead, store = defaultStore(), now = Date.now()) {
  const existing = await store.findRecentNew(lead.phone, now - REPICK_WINDOW_MS);
  if (existing) {
    await store.update(existing.leadId, lead);
    return { leadId: existing.leadId, updated: true };
  }
  const leadId = newLeadId(now);
  await store.insert({ ...lead, leadId, createdAt: now, status: 'New' });
  return { leadId, updated: false };
}

function createMemoryStore() {
  const rows = [];
  return {
    rows,
    async findRecentNew(phone, sinceMs) {
      return [...rows].reverse().find(r => r.phone === phone && r.status === 'New' && r.createdAt >= sinceMs) || null;
    },
    async insert(row) { rows.push({ ...row }); },
    async update(leadId, row) { Object.assign(rows.find(r => r.leadId === leadId), row); },
  };
}

// In production the bot reaches Postgres over Railway's private network (*.railway.internal),
// which never leaves Railway — no TLS needed there. The public proxy (local testing only)
// presents a certificate Node can't verify, so it is encrypted but unverified.
function sslFor(connectionString, pgssl = process.env.PGSSL) {
  if (pgssl === 'disable') return false;
  let host = '';
  try { host = new URL(connectionString).hostname; } catch { /* fall through */ }
  return host.endsWith('.railway.internal') ? false : { rejectUnauthorized: false };
}

function createPgStore(connectionString) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString, ssl: sslFor(connectionString), max: 3 });

  // Created on first use; a failed attempt (e.g. DB down at startup) is retried on the next save
  let ready = null;
  const ensureTable = () => {
    ready ??= pool.query(`
      CREATE TABLE IF NOT EXISTS battery_leads (
        lead_id           TEXT PRIMARY KEY,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        customer_name     TEXT,
        phone             TEXT,
        vehicle           TEXT,
        battery_sku       TEXT,
        battery_brand     TEXT,
        product_code      TEXT,
        price_quoted      NUMERIC,
        status            TEXT NOT NULL DEFAULT 'New',
        status_updated_at TIMESTAMPTZ,
        notes             TEXT
      )`).then(() => console.log('[BatteryLeads] battery_leads table ready'))
      .catch(err => { ready = null; throw err; });
    return ready;
  };

  const values = r => [r.customerName, r.phone, r.vehicle, r.batterySku, r.batteryBrand, r.productCode, r.priceQuoted];

  return {
    async findRecentNew(phone, sinceMs) {
      await ensureTable();
      const { rows } = await pool.query(
        `SELECT lead_id AS "leadId" FROM battery_leads
          WHERE phone = $1 AND status = 'New' AND created_at >= $2
          ORDER BY created_at DESC LIMIT 1`, [phone, new Date(sinceMs)]);
      return rows[0] || null;
    },
    async insert(row) {
      await ensureTable();
      await pool.query(
        `INSERT INTO battery_leads (customer_name, phone, vehicle, battery_sku, battery_brand, product_code,
           price_quoted, lead_id, created_at, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [...values(row), row.leadId, new Date(row.createdAt), row.status]);
    },
    async update(leadId, row) {
      await ensureTable();
      await pool.query(
        `UPDATE battery_leads SET customer_name = $1, phone = $2, vehicle = $3, battery_sku = $4,
           battery_brand = $5, product_code = $6, price_quoted = $7 WHERE lead_id = $8`,
        [...values(row), leadId]);
    },
  };
}

let store;
function defaultStore() {
  store ??= process.env.DATABASE_URL ? createPgStore(process.env.DATABASE_URL) : createMemoryStore();
  return store;
}

module.exports = { phoneDigits, buildBatteryLead, saveBatteryLead, createMemoryStore, createPgStore, sslFor, rememberQuote, quotedOptionsText };
