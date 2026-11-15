process.env.CATALOGUE_PATH = './catalogue-Midrand Midas.xlsx';
process.env.ANTHROPIC_API_KEY ||= 'test-key';
delete process.env.DATABASE_URL;
delete process.env.PARTS_DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeTool } = require('../aiConversation');

const ctx = { from: 'whatsapp:+27631890087', profileName: 'Sam' };
const input = { fulfilment: 'deliver', deliveryAddress: '12 Main Rd', vehicle: '2018 Toyota Hilux', parts: 'Brake pads' };

function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { return { result: fn(), lines }; } finally { console.log = orig; }
}

test('submit_parts_lead answers straight away and logs a masked parts lead', () => {
  const { result, lines } = captureLogs(() => executeTool('submit_parts_lead', input, ctx));
  assert.equal(typeof result.then, 'undefined', 'must not wait for the database');
  assert.deepEqual(result, { success: true });
  const lead = lines.find(l => l.startsWith('[LEAD] parts'));
  assert.ok(lead, 'expected a [LEAD] parts log line');
  assert.match(lead, /\*\*\*\*0087/);
  assert.match(lead, /Brake pads/);
  assert.doesNotMatch(lead, /27631890087/);
});

test('submit_parts_lead ignores a phone number or name smuggled into the tool input', () => {
  const { lines } = captureLogs(() => executeTool('submit_parts_lead',
    { ...input, from: 'whatsapp:+27999999999', customerName: 'Mallory' }, ctx));
  const lead = lines.find(l => l.startsWith('[LEAD] parts'));
  assert.ok(lead);
  assert.match(lead, /\*\*\*\*0087/);
  assert.match(lead, /"customerName":"Sam"/);
  assert.doesNotMatch(lead, /Mallory|9999/);
});
