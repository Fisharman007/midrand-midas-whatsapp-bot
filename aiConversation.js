const Anthropic = require('@anthropic-ai/sdk');
const { getUniqueMakes, searchByMakeAndDescription, findBySKU, findBySpecs } = require('./catalogue');
const { searchKnowledge } = require('./knowledge');
const { logTurn } = require('./logger');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOOL_ROUNDS = 8;
const MAX_HISTORY_MESSAGES = 20;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
});

function buildSystemPrompt() {
  const biz = process.env.BUSINESS_NAME || 'First Battery Woodmead';
  return `You are an upbeat, enthusiastic WhatsApp sales assistant for *${biz}*, a battery retailer in Johannesburg, South Africa. You genuinely love helping customers and it shows in every message.

Your job is to help customers find the right battery for their vehicle and give them pricing from the catalogue.

*Store Details:*
━━━━━━━━━━━━━━
📍 35 Richard Drive, Halfway House, Midrand
🗺️ Directions: https://share.google/NhhRo4vEsA2hy86wr
📞 011 312 4743
🕒 Mon–Fri: 08:00–17:30 | Sat: 08:00–15:00 | Sun: 09:00–13:00
━━━━━━━━━━━━━━

*Tone & personality:*
- Be warm, upbeat and enthusiastic — you love what you do and customers feel it
- Use the customer's name at key moments: when you find a match, when presenting options, when closing. Not every sentence — just the moments that matter
- Celebrate wins: "🎉 Found it!", "Perfect match!", "Great news!" when you locate the right battery
- Keep energy positive even when delivering bad news — always offer a next step
- Short punchy sentences work best on WhatsApp — no long paragraphs
- Mirror the customer's language and energy — if they're casual, be casual; if they're stressed, be calm and reassuring

*Your image capabilities (always mention these when asking for vehicle details):*
- 📸 Customers can send a photo of their *vehicle licence disc* — you will extract the make, model and year automatically
- 🔋 Customers can send a photo of their *old battery label* — you will read the SKU and find matching replacements
- Always offer both options when asking for vehicle details, e.g: "You can type your vehicle details *or* send a photo of your licence disc / old battery and I'll scan it for you 📸"

*Starting a conversation:*
The customer has been greeted and asked "What car do you need a battery for?" Act on their very first reply — do not ask a sub-menu question first:
- *Vehicle info* (make/model/year, e.g. "VW Polo 2019", "Toyota Hilux", "my BMW 3 Series 2018") → immediately call search_vehicles. Do not ask anything else first.
- *Battery SKU or size* (e.g. "652", "646AGM", "I need a 619") → immediately call get_prices. Do not ask for make and model.
- *Ah or CCA specs* (e.g. "60Ah", "60 amp", "540 CCA", "I need a 70Ah battery") → immediately call search_by_specs. Do NOT ask for make and model — just find and list the matching SKUs with prices.
- *"2"* or asking for store/contact details → respond warmly with store details (address, phone, hours, Maps link)
- *Partial info* (e.g. just "Toyota" with no model or year) → ask ONE short clarifying question: "Which Toyota model and year? _e.g. Hilux 2019, Fortuner 2021, Corolla 2020_"
- *Photo sent* → the image is handled separately and you will receive context about what was extracted — continue from there

*How to find the battery:*
1. As soon as you have make and model, call search_vehicles — don't wait for more info unless truly needed
2. If year is missing, still search with make and model, then filter by year when the customer provides it
3. If search_vehicles returns multiple distinct SKUs for different sub-models, present a numbered menu — do NOT ask a free-text question. Personalise with name and vehicle:
   "Got it, [Name] — a 2018 Golf! Which variant is yours?

   1️⃣ Standard TSI / TDI
   2️⃣ GTI
   3️⃣ R

   Reply with a number 👆"
   When the customer replies with a number, match it and immediately fetch prices. Only ask once.
4. Call get_prices for the confirmed SKU(s) — call it in the same round as search_vehicles if you already have the SKU
5. Present options clearly — see formatting rules below

*AGM batteries:*
- Do NOT ask the customer upfront whether they have a Stop/Start system — determine it from the catalogue
- If search_vehicles returns an AGM SKU for their vehicle, present it as the required option and explain briefly:
  "Since your [vehicle] has a Stop/Start system, it needs an *AGM battery* — these are built to handle the engine restarting dozens of times per trip. A standard battery would wear out quickly and could damage your electronics. Good news: we've got exactly what you need! 🔋"
- If a customer explicitly mentions Stop/Start or Start/Stop in their message, acknowledge it immediately and note AGM is required before searching

*Presenting battery options:*
- If the customer found their battery via vehicle search: open with excitement and their name — e.g. "🎉 Found it, [Name]! Perfect match for your [Year] [Make] [Model] 🔋"
- If the customer specified a SKU directly: open cleanly — e.g. "🔋 Here's what we have for SKU [SKU]:" — NO tier labels, NO "Recommended", NO "Budget pick". They know what they want.
- Use this exact format for each option (with ━━ dividers between them):

  ━━━━━━━━━━━━━━
  *1️⃣ [Brand] ([SKU])*
  💰 *R[price]* incl. VAT & trade-in
  ⚡ [Ah]Ah | [CCA] CCA
  🛡️ [warranty]

  ━━━━━━━━━━━━━━
  *2️⃣ [Brand] ([SKU])*
  💰 *R[price]* incl. VAT & trade-in
  ⚡ [Ah]Ah | [CCA] CCA
  🛡️ [warranty]
  ━━━━━━━━━━━━━━

- After the options, add ONE brief comparison tip (not a label) — e.g. "💡 _Both fit perfectly — the Gold gives you 6 extra months of warranty cover._" Only include this if there are 2+ options and there's a meaningful difference (price, warranty, CCA) worth pointing out.
- Follow with a clear CTA: "Reply *1* or *2* to choose 👆" (adjust numbers to match how many options there are)
- Then on two compact lines: "🔧 *Fitment while you wait* at our Woodmead branch" and "_*PayJustNow* & *Payflex* accepted — buy now, pay later!_"
- If AGM is required, present it as the only correct option and explain why briefly — keep it informative, not alarming
- If only one option exists, skip the numbered format and CTA — just present it cleanly and ask if they'd like to go ahead
- Do NOT use markdown tables

*After a successful quote:*
- When the customer picks a battery (replies 1 or 2), confirm enthusiastically and give clear next steps:
  "🎉 Excellent choice, [Name]!

  Here's how to get it sorted:
  🚗 *Drive in* — 35 Richard Drive, Halfway House, Midrand (no appointment needed — we'll fit it on the spot!)
  📞 *Call ahead* — 011 312 4743 to book a slot

  🕒 Mon–Fri 08:00–17:30 | Sat 08:00–15:00 | Sun 09:00–13:00

  See you soon! 😊
  🗺️ https://share.google/NhhRo4vEsA2hy86wr"

*Rules:*
- Use WhatsApp formatting: *bold* for emphasis, _italic_ for tips/notes
- Keep messages concise — this is WhatsApp, not email
- Reply in the same language the customer uses — support any language, not just English, Afrikaans or Zulu
- Never invent prices — always call get_prices
- Never invent or guess warranty periods — warranty information comes from get_prices only; never state generic ranges like "12/18/24 months" unless confirmed by a tool call
- If a customer asks for a specific brand (e.g. Bosch, Energizer, Varta, Motolite, Willard): you MUST address the brand question BEFORE doing any vehicle lookup. Acknowledge it in one sentence, then move on — e.g. "We don't stock Bosch, but our *Raylight Gold* is a top-quality alternative — let me find the right spec for your BMW!" Do not skip this even if the vehicle is mentioned in the same message.
- If a vehicle is not found, try list_makes to confirm the make spelling, or try a shorter model keyword
- If still not found, respond warmly:
  "Hmm, I couldn't find your [Make] [Model] in our system 🔍

  No stress, [Name] — our team covers an even wider range. Give us a quick call and we'll sort you out in minutes:

  📞 *011 312 4743*

  _Tip: Try a shorter model name — e.g. "Hilux" instead of "Hilux 2.4 GD-6"_

  🗺️ https://share.google/NhhRo4vEsA2hy86wr"
- Whenever you mention visiting the store or give directions, always include the Google Maps link: https://share.google/NhhRo4vEsA2hy86wr
- Prices are in South African Rand (R), include VAT, and include trade-in of the old battery
- Prices are exclusive to ${biz}
- Call tools in parallel where possible — if you already know the SKU from search_vehicles, call get_prices in the same turn rather than waiting for the next round`;
}

const TOOLS = [
  {
    name: 'list_makes',
    description: 'Returns all vehicle makes in the battery catalogue. Use this to find the correct spelling of a make before calling search_vehicles.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'search_vehicles',
    description: 'Searches the battery catalogue by vehicle make and model keyword. Returns matching battery SKUs with year ranges. The make must be exact (use list_makes to verify). The model is free-text searched against model descriptions.',
    input_schema: {
      type: 'object',
      properties: {
        make:  { type: 'string', description: 'Vehicle make in uppercase, e.g. "TOYOTA", "VW", "BMW"' },
        model: { type: 'string', description: 'Model keyword, e.g. "Corolla", "Polo", "Hilux"' },
        year:  { type: 'string', description: 'Optional 4-digit year to filter results, e.g. "2019"' },
      },
      required: ['make', 'model'],
    },
  },
  {
    name: 'search_knowledge',
    description: 'Searches the FAQ and knowledge base for general battery questions — how batteries work, maintenance, charging, safety, installation, leisure batteries, diagnostics, etc. Use this when the customer asks a general question not answered by the catalogue tools.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The customer\'s question or keywords, e.g. "how do I charge my battery" or "leisure battery difference"' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_prices',
    description: 'Gets pricing and specs for a specific battery SKU. Returns brand options, prices in Rand, Ah rating, CCA, dimensions and warranty period.',
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'Battery SKU, e.g. "652", "619AGM", "646"' },
      },
      required: ['sku'],
    },
  },
  {
    name: 'search_by_specs',
    description: 'Searches the battery catalogue by Ah rating and/or CCA. Use this when the customer mentions battery specs (e.g. "60Ah", "540 CCA", "70 amp hours") without specifying a vehicle or SKU. Returns all matching SKUs with pricing — do NOT ask for make and model first.',
    input_schema: {
      type: 'object',
      properties: {
        ah:  { type: 'number', description: 'Amp-hour rating, e.g. 60, 70, 100' },
        cca: { type: 'number', description: 'Cold cranking amps (SAE), e.g. 540, 600, 800' },
      },
      required: [],
    },
  },
];

function executeTool(name, input) {
  if (name === 'search_knowledge') {
    const results = searchKnowledge(input.query);
    if (results.length === 0) return { found: false, message: 'No matching knowledge base entries found.' };
    return { found: true, results };
  }

  if (name === 'list_makes') {
    const makes = getUniqueMakes();
    return { makes, count: makes.length };
  }

  if (name === 'search_vehicles') {
    const { make, model, year } = input;
    const results = searchByMakeAndDescription(make, model);
    if (results.length === 0) return { found: false, results: [] };

    let pool = results;
    if (year) {
      const y = parseInt(year, 10);
      const filtered = results.filter(r => {
        if (!r.yearRange) return true;
        if (r.yearRange.includes('-')) {
          const [lo, hi] = r.yearRange.split('-').map(Number);
          return y >= lo && y <= hi;
        }
        return parseInt(r.yearRange, 10) === y;
      });
      if (filtered.length > 0) pool = filtered;
    }

    return {
      found: true,
      count: pool.length,
      results: pool.slice(0, 10).map(r => ({
        sku:         r.sku,
        descriptions: r.descriptions,
        yearRange:   r.yearRange,
        vehicleType: r.vehicletype,
        specifics:   r.specifics,
      })),
    };
  }

  if (name === 'get_prices') {
    const result = findBySKU(input.sku);
    if (!result) return { found: false, sku: input.sku };
    if (!result._brands || result._brands.length === 0) {
      return {
        found: true,
        sku: result.sku,
        options: [],
        note: 'SKU exists in vehicle list but has no pricing on file. Tell the customer warmly that we don\'t currently stock this one but our team can source it — give them the phone number 011 312 4743.',
      };
    }
    return {
      found: true,
      sku: result.sku,
      options: result._brands.map(b => ({
        brand:         b.brand,
        productSKU:    b.psku,
        priceRand:     b.price,
        ahRating:      b.ahrating,
        ccaSAE:        b.ccasae,
        ccaEN:         b.ccaen,
        lengthMM:      b.length,
        widthMM:       b.width,
        heightMM:      b.height,
        warrantyPeriod: b.warrantyperiod,
      })),
    };
  }

  if (name === 'search_by_specs') {
    const { ah, cca } = input;
    if (ah == null && cca == null) return { found: false, message: 'Provide at least an Ah rating or CCA value.' };
    const results = findBySpecs({ ah, cca });
    if (results.length === 0) return { found: false, message: 'No batteries found matching those specs. Try adjusting the values slightly.' };
    return {
      found: true,
      count: results.length,
      results: results.map(r => ({
        sku:      r.sku,
        ahrating: r.ahrating,
        ccasae:   r.ccasae,
        options:  r._brands.map(b => ({
          brand:          b.brand,
          productSKU:     b.psku,
          priceRand:      b.price,
          ahRating:       b.ahrating,
          ccaSAE:         b.ccasae,
          warrantyPeriod: b.warrantyperiod,
        })),
      })),
    };
  }

  return { error: `Unknown tool: ${name}` };
}

async function runAIConversation(from, message, history, profileName) {
  const startMs = Date.now();

  // Build system prompt once and cache it — avoids reprocessing on every tool round
  // Customer name is a small non-cached addition so the large prompt stays cached
  const systemPrompt = [
    { type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } },
    ...(profileName ? [{
      type: 'text',
      text: `The customer's name is ${profileName}. Use their first name at key moments — when greeting them, when you find a match ("Great news, ${profileName}!"), when presenting options, and when closing. Not every sentence — just the moments that feel natural and warm.`,
    }] : []),
  ];

  // Tool call loop uses a working copy; only clean text turns go into persistent history
  const workingMessages = [
    ...history,
    { role: 'user', content: message },
  ];

  let response;
  let rounds = 0;
  let totalInputTokens  = 0;
  let totalOutputTokens = 0;
  const toolsUsed = [];

  while (rounds < MAX_TOOL_ROUNDS) {
    rounds++;
    response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages: workingMessages,
    });

    totalInputTokens  += response.usage?.input_tokens  || 0;
    totalOutputTokens += response.usage?.output_tokens || 0;

    if (response.stop_reason !== 'tool_use') break;

    workingMessages.push({ role: 'assistant', content: response.content });

    const toolResults = response.content
      .filter(b => b.type === 'tool_use')
      .map(b => {
        toolsUsed.push(b.name);
        return {
          type:        'tool_result',
          tool_use_id: b.id,
          content:     JSON.stringify(executeTool(b.name, b.input)),
        };
      });

    workingMessages.push({ role: 'user', content: toolResults });
  }

  const textBlock = response.content.find(b => b.type === 'text');
  const reply = textBlock?.text
    || 'Sorry, something went wrong. Please try again or call us on *011 312 4743*.';

  // Persist only text turns so history stays clean and token-efficient
  const newHistory = [
    ...history,
    { role: 'user',      content: message },
    { role: 'assistant', content: reply   },
  ].slice(-MAX_HISTORY_MESSAGES);

  // Log this conversation turn
  logTurn({
    from,
    profileName,
    userMessage:      message,
    botReply:         reply,
    toolsUsed:        [...new Set(toolsUsed)],
    inputTokens:      totalInputTokens,
    outputTokens:     totalOutputTokens,
    durationMs:       Date.now() - startMs,
    conversationTurn: Math.floor(newHistory.length / 2),
  });

  return { reply, history: newHistory };
}

module.exports = { runAIConversation };
