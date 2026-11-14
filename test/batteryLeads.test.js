process.env.CATALOGUE_PATH = './catalogue-Midrand Midas.xlsx';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { phoneDigits, buildBatteryLead, saveBatteryLead, createMemoryStore } = require('../batteryLeads');

const pick = (productCode, sku = '658AGM') =>
  buildBatteryLead({ from: 'whatsapp:+27631890087', customerName: 'Sam', vehicle: '2016 Audi A4', sku, productCode });

test('phoneDigits strips the whatsapp prefix and plus sign', () => {
  assert.equal(phoneDigits('whatsapp:+27631890087'), '27631890087');
  assert.equal(phoneDigits('27631890087'), '27631890087');
});

test('buildBatteryLead takes brand and price from the catalogue, matching loose product codes', () => {
  for (const code of ['658 g14', '658G14', '658-G14']) {
    const lead = pick(code);
    assert.equal(lead.batteryBrand, 'VARTA');
    assert.equal(lead.productCode, '658-G14');
    assert.equal(lead.priceQuoted, 5695);
    assert.equal(lead.batterySku, '658AGM');
    assert.equal(lead.phone, '27631890087');
  }
});

test('buildBatteryLead returns null for a code that is not under that size, or an unknown size', () => {
  assert.equal(pick('646-D24'), null);
  assert.equal(pick('NOPE-1', '999XX'), null);
});

test('a re-pick within 2 hours updates the same New lead', async () => {
  const store = createMemoryStore();
  const t0 = Date.UTC(2026, 10, 14, 8, 0);
  const first = await saveBatteryLead(pick('658-G14'), store, t0);
  const second = await saveBatteryLead(pick('658AGMS'), store, t0 + 60 * 60 * 1000);
  assert.equal(first.updated, false);
  assert.match(first.leadId, /^MB-20261114-[0-9A-F]{4}$/);
  assert.deepEqual(second, { leadId: first.leadId, updated: true });
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].productCode, '658AGMS');
});

test('a re-pick after 3 hours creates a new lead', async () => {
  const store = createMemoryStore();
  const t0 = Date.UTC(2026, 10, 14, 8, 0);
  const first = await saveBatteryLead(pick('658-G14'), store, t0);
  const later = await saveBatteryLead(pick('658AGMS'), store, t0 + 3 * 60 * 60 * 1000);
  assert.equal(later.updated, false);
  assert.notEqual(later.leadId, first.leadId);
  assert.equal(store.rows.length, 2);
});

test('a lead already Contacted is not overwritten by a re-pick', async () => {
  const store = createMemoryStore();
  const t0 = Date.UTC(2026, 10, 14, 8, 0);
  const first = await saveBatteryLead(pick('658-G14'), store, t0);
  store.rows[0].status = 'Contacted';
  const again = await saveBatteryLead(pick('658AGMS'), store, t0 + 10 * 60 * 1000);
  assert.equal(again.updated, false);
  assert.notEqual(again.leadId, first.leadId);
  assert.equal(store.rows[0].productCode, '658-G14');
});

test('a failed save does not leave the store stuck — the next save succeeds', async () => {
  const store = createMemoryStore();
  const realInsert = store.insert;
  let calls = 0;
  store.insert = async row => { calls++; if (calls === 1) throw new Error('db down'); return realInsert(row); };
  await assert.rejects(saveBatteryLead(pick('658-G14'), store), /db down/);
  const ok = await saveBatteryLead(pick('658-G14'), store);
  assert.equal(ok.updated, false);
  assert.equal(store.rows.length, 1);
});

test('sslFor: no TLS on Railway\'s private network, encrypted (unverified) on the public proxy, off when PGSSL=disable', () => {
  const { sslFor } = require('../batteryLeads');
  assert.equal(sslFor('postgresql://u:p@postgres.railway.internal:5432/railway'), false);
  assert.deepEqual(sslFor('postgresql://u:p@shuttle.proxy.rlwy.net:12345/railway'), { rejectUnauthorized: false });
  assert.equal(sslFor('postgresql://u:p@localhost:5432/x', 'disable'), false);
});

test('buildBatteryLead recovers when the AI passes the wrong size but a unique product code', () => {
  const lead = pick('660AGMS', '660AGMS');
  assert.equal(lead.batterySku, '660AGM');
  assert.equal(lead.batteryBrand, 'SABAT');
  assert.equal(lead.priceQuoted, 5350);
});

test('buildBatteryLead refuses a wrong size when the product code exists under more than one size', () => {
  assert.equal(pick('650SR', '999XX'), null);
});

test('buildBatteryLead accepts the brand written with the product code', () => {
  for (const code of ['WILLARD 646AGM', '646AGM Willard']) {
    const lead = pick(code, '646AGM');
    assert.equal(lead?.batteryBrand, 'WILLARD', code);
    assert.equal(lead.priceQuoted, 3750);
  }
});

test('a dropped Postgres connection does not crash the bot (pool has an error handler)', () => {
  const { createPgStore } = require('../batteryLeads');
  const store = createPgStore('postgresql://u:p@127.0.0.1:1/x');
  assert.doesNotThrow(() => store.pool.emit('error', new Error('connection terminated')));
  store.pool.end();
});

test('saveWithRetry retries a failed save and gives up after the last delay', async () => {
  const { saveWithRetry } = require('../batteryLeads');
  let calls = 0;
  const flaky = async () => { calls++; if (calls < 3) throw new Error('db down'); return { leadId: 'MB-1', updated: false }; };
  assert.deepEqual(await saveWithRetry({}, { save: flaky, delays: [1, 1, 1] }), { leadId: 'MB-1', updated: false });
  assert.equal(calls, 3);
  calls = 0;
  const dead = async () => { calls++; throw new Error('db down'); };
  await assert.rejects(saveWithRetry({}, { save: dead, delays: [1, 1] }), /db down/);
  assert.equal(calls, 3);
});

test('wasQuoted only allows sizes quoted to this customer (anything goes when nothing is remembered)', () => {
  const { rememberQuote, wasQuoted } = require('../batteryLeads');
  assert.equal(wasQuoted('whatsapp:+27000000555', '658AGM'), true);
  rememberQuote('whatsapp:+27000000555', '646AGM');
  assert.equal(wasQuoted('whatsapp:+27000000555', '646AGM'), true);
  assert.equal(wasQuoted('whatsapp:+27000000555', '658AGM'), false);
});
