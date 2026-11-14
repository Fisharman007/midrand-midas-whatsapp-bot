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

test('submit_battery_lead ignores a phone number or name smuggled into the tool input', () => {
  const { lines } = captureLogs(() => executeTool('submit_battery_lead',
    { sku: '658AGM', productCode: '658-G14', vehicle: 'x', from: 'whatsapp:+27999999999', customerName: 'Mallory' }, ctx));
  const lead = lines.find(l => l.startsWith('[LEAD] battery'));
  assert.match(lead, /\*\*\*\*0087/);
  assert.match(lead, /"customerName":"Sam"/);
});

const { ensureBatteryLead } = require('../aiConversation');

test('ensureBatteryLead forces the lead when the reply confirms a pick but the AI skipped the tool', async () => {
  const calls = [];
  const createMessage = async req => {
    calls.push(req);
    return { content: [{ type: 'tool_use', name: 'submit_battery_lead', input: { sku: '660AGM', productCode: '660AGMS', vehicle: '2018 Audi SQ5' } }] };
  };
  const { result, lines } = await (async () => {
    const lines = []; const orig = console.log; console.log = (...a) => lines.push(a.join(' '));
    try { return { result: await ensureBatteryLead({ reply: '🎉 Excellent choice, Sam!', toolsUsed: ['get_prices'], messages: [{ role: 'user', content: 'Quote' }], system: [], ctx, createMessage }), lines }; }
    finally { console.log = orig; }
  })();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].tool_choice, { type: 'tool', name: 'submit_battery_lead' });
  assert.equal(calls[0].messages.at(-1).role, 'user');
  assert.equal(result, true);
  assert.ok(lines.some(l => l.startsWith('[LEAD] battery') && l.includes('660AGMS')));
});

test('ensureBatteryLead does nothing when the tool already ran or the reply is not a pick', async () => {
  let called = 0;
  const createMessage = async () => { called++; return { content: [] }; };
  await ensureBatteryLead({ reply: '🎉 Excellent choice!', toolsUsed: ['submit_battery_lead'], messages: [], system: [], ctx, createMessage });
  await ensureBatteryLead({ reply: 'Which year is your Polo?', toolsUsed: [], messages: [], system: [], ctx, createMessage });
  assert.equal(called, 0);
});

test('the forced lead call is given the exact options last quoted to this customer', async () => {
  const quoteCtx = { from: 'whatsapp:+27000000777', profileName: 'Q' };
  executeTool('get_prices', { sku: '646AGM' }, quoteCtx);
  let req;
  await ensureBatteryLead({ reply: 'Excellent choice!', toolsUsed: [], messages: [{ role: 'user', content: '2' }], system: [],
    ctx: quoteCtx, createMessage: async r => { req = r; return { content: [] }; } });
  const nudge = req.messages.at(-1).content;
  for (const code of ['646-D52', '646AGMS', 'size 646AGM']) assert.ok(nudge.includes(code), `nudge missing ${code}`);
});
