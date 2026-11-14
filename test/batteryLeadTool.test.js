process.env.CATALOGUE_PATH = './catalogue-Midrand Midas.xlsx';
process.env.ANTHROPIC_API_KEY ||= 'test-key';
delete process.env.DATABASE_URL;

const test = require('node:test');
const assert = require('node:assert/strict');
const { executeTool } = require('../aiConversation');

const ctx = { from: 'whatsapp:+27631890087', profileName: 'Sam' };

function captureLogs(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try { return { result: fn(), lines }; } finally { console.log = orig; }
}

test('submit_battery_lead returns the catalogue brand and price straight away and logs a masked lead', () => {
  const { result, lines } = captureLogs(() =>
    executeTool('submit_battery_lead', { sku: '658AGM', productCode: '658 G14', vehicle: '2016 Audi A4' }, ctx));
  assert.equal(typeof result.then, 'undefined', 'must not wait for the database');
  assert.deepEqual(result, { saved: true, brand: 'VARTA', productCode: '658-G14', price: 5695 });
  const lead = lines.find(l => l.startsWith('[LEAD] battery'));
  assert.ok(lead, 'expected a [LEAD] battery log line');
  assert.match(lead, /\*\*\*\*0087/);
  assert.doesNotMatch(lead, /27631890087/);
});

test('submit_battery_lead refuses a battery that is not in the catalogue', () => {
  const { result, lines } = captureLogs(() =>
    executeTool('submit_battery_lead', { sku: '658AGM', productCode: '646-D24', vehicle: 'x' }, ctx));
  assert.equal(result.saved, false);
  assert.match(result.error, /not in the catalogue/);
  assert.ok(!lines.some(l => l.startsWith('[LEAD] battery')));
});
