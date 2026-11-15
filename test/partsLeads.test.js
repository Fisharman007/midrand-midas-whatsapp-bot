delete process.env.PARTS_DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPartsLead, savePartsLead, saveWithRetry, recordUnsavedLead, createMemoryStore } = require('../partsLeads');

const input = (over = {}) => ({
  from: 'whatsapp:+27631890087', customerName: 'Sam', vehicle: '2018 Toyota Hilux',
  parts: 'Front brake pads', fulfilment: 'deliver', deliveryAddress: '12 Main Rd, Midrand', ...over,
});

test('buildPartsLead keeps only the digits of the WhatsApp number', () => {
  const lead = buildPartsLead(input());
  assert.deepEqual(lead, {
    phone: '27631890087', customerName: 'Sam', vehicle: '2018 Toyota Hilux',
    parts: 'Front brake pads', fulfilment: 'deliver', deliveryAddress: '12 Main Rd, Midrand',
  });
});

test('buildPartsLead drops the address for a collection', () => {
  assert.equal(buildPartsLead(input({ fulfilment: 'collect' })).deliveryAddress, '');
});

test('savePartsLead stores a New lead with an MP- id', async () => {
  const store = createMemoryStore();
  const { leadId } = await savePartsLead(buildPartsLead(input()), store, Date.UTC(2026, 10, 15, 23, 0));
  assert.match(leadId, /^MP-20261116-[0-9A-F]{4}$/); // 23:00 UTC is the next day in SAST
  assert.equal(store.rows.length, 1);
  assert.equal(store.rows[0].status, 'New');
  assert.equal(store.rows[0].parts, 'Front brake pads');
});

test('two requests from the same customer are two leads', async () => {
  const store = createMemoryStore();
  await savePartsLead(buildPartsLead(input()), store);
  await savePartsLead(buildPartsLead(input({ parts: 'Wipers' })), store);
  assert.equal(store.rows.length, 2);
});

test('saveWithRetry keeps trying until the save works', async () => {
  let attempts = 0;
  const save = async () => { if (++attempts < 3) throw new Error('db down'); return { leadId: 'MP-x' }; };
  const orig = console.warn; console.warn = () => {};
  try {
    assert.deepEqual(await saveWithRetry({}, { save, delays: [0, 0] }), { leadId: 'MP-x' });
  } finally { console.warn = orig; }
  assert.equal(attempts, 3);
});

test('recordUnsavedLead logs only the masked number', () => {
  const lines = [];
  const orig = console.error; console.error = (...a) => lines.push(a.join(' '));
  try { recordUnsavedLead(buildPartsLead(input()), new Error('db down')); } finally { console.error = orig; }
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[LEAD-UNSAVED\] parts/);
  assert.match(lines[0], /\*\*\*\*0087/);
  assert.doesNotMatch(lines[0], /27631890087/);
  assert.doesNotMatch(lines[0], /12 Main Rd|Sam/, 'address and name stay out of the logs');
});
