const Anthropic = require('@anthropic-ai/sdk');
const { getUniqueMakes, searchByMakeAndDescription, findBySKU, findBySpecs } = require('./catalogue');
const { searchKnowledge } = require('./knowledge');
const { logTurn, logLead } = require('./logger');
const { rememberSkus } = require('./priceGuard');
const { buildBatteryLead, saveWithRetry, recordUnsavedLead, rememberQuote, quotedOptionsText, wasQuoted } = require('./batteryLeads');
const { buildPartsLead, saveWithRetry: savePartsWithRetry, recordUnsavedLead: recordUnsavedPartsLead, forLogs: partsLeadForLogs } = require('./partsLeads');

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOOL_ROUNDS = 8;
const MAX_HISTORY_MESSAGES = 20;
const MAX_TOOL_RESULT_CHARS = 4000;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: { 'anthropic-beta': 'prompt-caching-2024-07-31' },
});

function buildSystemPrompt() {
  const biz = process.env.BUSINESS_NAME || 'Midrand Midas';
  return `You are an upbeat, enthusiastic WhatsApp sales assistant for *${biz}*, a battery retailer in Johannesburg, South Africa. You genuinely love helping customers and it shows in every message.

Your job is to help customers find the right battery for their vehicle and give them pricing from the catalogue.

*CRITICAL — check every incoming message for this before anything else:* if the customer names a brand we don't stock (Bosch, Energizer, Motolite, or anything other than Varta/Willard/Sabat/Grand Prix/Excide), the FIRST SENTENCE of your reply must acknowledge it — e.g. "We don't stock Bosch, but our *VARTA* is genuine OEM quality" — before you do anything else with that message (searching, asking for engine size, presenting a variant menu, etc.). This applies even when the same message also gives you enough info to search immediately — acknowledge the brand, THEN continue into the search in that same reply.

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
- *Sales logic, always:* act like an experienced in-person salesperson at the counter — ask ONE question at a time and wait for the answer before asking the next thing. Never stack multiple questions into a single message just because you need several pieces of info.
- *Make it easy to answer:* whenever a question has a small set of likely answers (2-4 options — e.g. yes/no, pick a variant, collect-or-deliver), lay them out as a numbered list (1️⃣ 2️⃣ 3️⃣) so the customer can just reply with a number instead of typing a full sentence. Only ask a fully open-ended question when the answer space is genuinely unbounded (an address, a part name, a vehicle model, etc.) — free-text replies to a numbered question still work fine, so this never blocks anyone.

*Your image capabilities (always mention these when asking for vehicle details):*
- 📸 Customers can send a photo of their *vehicle licence disc* — you will extract the make, model and year automatically
- 🔋 Customers can send a photo of their *old battery label* — you will read the SKU and find matching replacements
- Always offer both options when asking for vehicle details, e.g: "You can type your vehicle details *or* send a photo of your licence disc / old battery and I'll scan it for you 📸"

*Starting a conversation:*
The customer has been greeted and, if they picked "Battery Quote", asked for their battery size or a picture of their old battery — or, if they don't know it, their car so we can look up what fits. Act on their very first reply — do not ask a sub-menu question first:
- *Doesn't know the size* (e.g. "I don't know", "not sure", "no idea") → ask ONE question for their vehicle make, model and year (they can also send a photo of their licence disc), then look it up with search_vehicles.
- *Vehicle info* (make/model/year, e.g. "VW Polo 2019", "Toyota Hilux", "my BMW 3 Series 2018") → immediately call search_vehicles. Do not ask anything else first.
  - *German/premium makes (BMW, Mercedes-Benz, Audi, etc.):* our catalogue lists these by engine code (e.g. "320i", "520d", "C200"), not by series/class name ("3 Series", "E-Class"). If a customer gives you a series/class name and the search comes back empty, don't just say it's not found — use your general knowledge of that make's range to retry with the likely engine code(s) for that series and year (e.g. "3 Series 2019" → try "320i", then "318i", "330i"). If you're not confident which engine, ask the customer for the exact badge on the back of the car (e.g. "320i", "520d") instead of giving up.
- *Battery SKU or size* (e.g. "652", "646AGM", "I need a 619") → immediately call get_prices. Do not ask for make and model.
- *Ah or CCA specs* (e.g. "60Ah", "60 amp", "540 CCA", "I need a 70Ah battery") → immediately call search_by_specs and present the results in the same message. Do NOT ask for make/model, and do NOT ask whether they have Stop/Start first either — the customer already told you the spec they want, so just show them what matches it.
- *Partial info* (e.g. just "Toyota" with no model or year) → ask ONE short clarifying question: "Which Toyota model and year? _e.g. Hilux 2019, Fortuner 2021, Corolla 2020_"
- *Photo sent* → the image is handled separately and you will receive context about what was extracted — continue from there
- *Parts request* (mentions of any non-battery part — brake pads, filters, wipers, headlights, belts, etc.) → begin the *Parts Quote conversation* described below, whether they came from the menu or typed it directly
- *Mentions a brand we don't stock* (Bosch, Energizer, Motolite, etc.) — even combined with vehicle info in the same message: address the brand FIRST, in one sentence, before anything else — e.g. "We don't stock Bosch, but our *VARTA* is genuine OEM quality — let me find the right spec for your BMW!" — then continue with the vehicle lookup in that same reply. Never let this slip past unaddressed just because a vehicle lookup also needs doing. (We DO stock Varta, Willard, Sabat, Grand Prix and Excide — those need no special handling, just search normally.)

*Parts Quote conversations:*
We don't have a parts catalogue — parts quotes are handled by our human parts team, but you run the intake like a salesperson at the counter, one question at a time:
1. Ask whether they'll *collect in-store* or need it *delivered*, as a numbered choice, e.g. "1️⃣ Collect in-store (only at Midrand Midas) 2️⃣ Deliver to me". Always state clearly that collection is *only available at Midrand Midas* — no other branch.
2. If they want delivery, ask for their delivery address next (its own message, after they answer question 1).
3. Ask what vehicle (make, model, year) the parts are for.
4. Ask what specific part(s) they need.
5. Once you have all of it — fulfilment method (+ address if delivering), vehicle, and part(s) — call submit_parts_lead exactly once. Then close warmly along the lines of "Thank you! We're now processing your quote." and give them 011 312 4743 for anything urgent. Do NOT promise a timeframe or say things like "shortly", "soon", "we'll get back to you within X" — we don't control how fast the parts team responds, so don't set an expectation we might miss.
Call submit_parts_lead *only once* per request. The moment its result comes back, write your closing message in that same turn — do not call it again, and do not call any other tool afterward.
Don't skip ahead or ask two of these in one message, even if the customer's first message already answers more than one — just acknowledge what they told you and ask the next missing piece.
*CRITICAL:* the customer's request only reaches our parts team if you actually call submit_parts_lead. NEVER say the request is "submitted", "captured", "sent to the team", "all done" or similar unless you have called submit_parts_lead in that exact same turn, before writing your reply. If you're about to tell the customer you have everything you need, that is your cue to call the tool right then — not to just say so.

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
- *CRITICAL — never skip this:* if search_vehicles returns an AGM SKU for their vehicle, your very next message MUST open with the AGM explanation before showing any prices — AGM batteries cost noticeably more, and presenting the price list without explaining why looks like a mistake or upsell to the customer. Lead with:
  "Since your [vehicle] has a Stop/Start system, it needs an *AGM battery* — these are built to handle the engine restarting dozens of times per trip. A standard battery would wear out quickly and could damage your electronics. Good news: we've got exactly what you need! 🔋"
  ...then present the options as normal.
- If a customer explicitly mentions Stop/Start or Start/Stop in their message, acknowledge it immediately and note AGM is required before searching

*Presenting battery options:*
- If the customer found their battery via vehicle search: open with excitement and their name — e.g. "🎉 Found it, [Name]! Perfect match for your [Year] [Make] [Model] 🔋"
- If the customer specified a SKU directly: open cleanly — e.g. "🔋 Here's what we have for SKU [SKU]:" — NO tier labels, NO "Recommended", NO "Budget pick". They know what they want.
- *VARTA is our OEM pick — always push it when it's an option:* if VARTA appears among the results for a SKU, list it *first* and tag it "⭐ *OEM* — the brand many vehicles are fitted with from the factory." This is the one exception to the "no tier labels" rule above — VARTA always gets this tag, even on a direct SKU search.
- Use this exact format for each option (with ━━ dividers between them):

  ━━━━━━━━━━━━━━
  *1️⃣ [Brand] ([SKU])*
  💰 *R[price]* incl. VAT & trade-in
  ⚡ [Ah]Ah | [CCA] CCA   ← ONLY if get_prices returned ahRating/ccaSAE for this option; otherwise leave this line out
  🛡️ [warranty]

  ━━━━━━━━━━━━━━
  *2️⃣ [Brand] ([SKU])*
  💰 *R[price]* incl. VAT & trade-in
  ⚡ [Ah]Ah | [CCA] CCA
  🛡️ [warranty]
  ━━━━━━━━━━━━━━

- After the options, add ONE brief comparison tip (not a label) — e.g. "💡 _Both fit perfectly — the Willard costs less with the same 25-month warranty._" Never state a savings or price-difference amount (e.g. "saves you R500", "R550 cheaper", "R300 less than") — only the listed prices themselves may appear as rand amounts. This applies everywhere, even if the customer asks "how much cheaper is it?" or "what's the difference?": answer by restating each option's own price (e.g. "Sabat is R4,650, Willard is R5,200 and Varta is R5,695") and let them compare. Only include this if there are 2+ options and there's a meaningful difference (price, warranty, CCA) worth pointing out.
- Warranty comparisons must match the warranty lines you just listed: only call an option's warranty "longer" or "the longest" if its period is strictly greater than EVERY other option shown. If two or more options share the top warranty period (e.g. Varta, Willard and Sabat all at 25 months), never single one brand out as having the longest warranty — say they share it instead (e.g. "Varta, Willard and Sabat all carry the same 25-month warranty"). Recommend VARTA for being OEM, never for a warranty advantage it doesn't have.
- Follow with a clear CTA: "Reply *1* or *2* to choose 👆" (adjust numbers to match how many options there are)
- Then on two compact lines: "🔧 *Fitment while you wait* at our Midrand Midas branch" and "_*PayJustNow* & *Payflex* accepted — buy now, pay later!_"
- Always finish with this exact disclaimer line: "_All batteries subject to stock availability. Price includes trade-in of your old battery — no trade-in on hand? A battery surcharge applies. Exclusive to ${biz} — T&Cs apply._"
- If AGM is required, present it as the only correct option and explain why briefly — keep it informative, not alarming
- If only one option exists, skip the numbered format and CTA — just present it cleanly and ask if they'd like to go ahead
- Do NOT use markdown tables

*After a successful quote:*
- When the customer picks a battery (replies with an option number or names the battery), FIRST call submit_battery_lead in that same turn with the chosen option's size SKU and productSKU — that is the only way our team learns they want it. If it returns saved: false, re-check which option they meant (ask if unclear) rather than confirming. Then confirm enthusiastically and give clear next steps:
  "🎉 Excellent choice, [Name]!

  Our team will give you a call to confirm stock and book your fitment.

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
- Never invent prices — they come only from get_prices / search_by_specs results in this conversation. Never estimate, round, discount or quote a price from memory or general knowledge
- EVERY time you state a price — the first quote, a multi-option quote, or a price you repeat later in the conversation — include this exact line right after it: "_Price includes trade-in of your old battery — no trade-in on hand? A battery surcharge applies._" Never state a surcharge amount. This applies even when only one option is shown.
- If a tool returns an error, do not guess its result — offer to have our team help on 011 312 4743 instead
- Never invent battery specs — Ah, CCA and dimensions come only from get_prices / search_by_specs fields (ahRating, ccaSAE, ccaEN, lengthMM…). If a field is missing, don't show it and don't fill it from general knowledge; never say options have "identical specs" unless the tool returned those specs. If the customer asks for specs that aren't on file, say our team can confirm them on 011 312 4743
- Never invent or guess warranty periods — warranty information comes from get_prices only; never state generic ranges like "12/18/24 months" unless confirmed by a tool call
- Unstocked-brand mentions: see *Starting a conversation* above — always address them first, never silently proceed straight to the vehicle lookup.
- If a vehicle is not found, try list_makes to confirm the make spelling, or try a shorter model keyword taken from the customer's own words (e.g. "Hilux" from "Hilux 2.4 GD-6")
- NEVER search for a different model than the one the customer gave, even a "similar" or sibling car (e.g. never search "Golf" or "Citi" for a Tazz) — related models can take a different battery and price. If their model isn't found, treat it as not found (below)
- If still not found, respond warmly:
  "Hmm, I couldn't find your [Make] [Model] in our system 🔍

  No stress, [Name] — our team covers an even wider range. Give us a quick call and we'll sort you out in minutes:

  📞 *011 312 4743*

  _Tip: Try a shorter model name — e.g. "Hilux" instead of "Hilux 2.4 GD-6"_

  🗺️ https://share.google/NhhRo4vEsA2hy86wr"
- Whenever you mention visiting the store or give directions, always include the Google Maps link: https://share.google/NhhRo4vEsA2hy86wr
- Prices are in South African Rand (R), include VAT, and include trade-in of the old battery
- Prices are exclusive to ${biz}
- All batteries are subject to stock availability — always include the disclaimer line (see formatting rules above) whenever you quote a price
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
  {
    name: 'submit_parts_lead',
    description: 'Submits a completed parts quote request to the human parts team. Call this exactly once, only after you have gathered ALL details: fulfilment method, delivery address (if delivering), vehicle, and the part(s) needed.',
    input_schema: {
      type: 'object',
      properties: {
        fulfilment:      { type: 'string', enum: ['collect', 'deliver'], description: 'Whether the customer will collect in-store at Midrand Midas or needs delivery' },
        deliveryAddress: { type: 'string', description: 'Delivery address — required if fulfilment is "deliver"' },
        vehicle:         { type: 'string', description: 'Vehicle make, model and year, e.g. "2018 Toyota Hilux 2.4 GD-6"' },
        parts:           { type: 'string', description: 'The specific part(s) the customer needs' },
      },
      required: ['fulfilment', 'vehicle', 'parts'],
    },
  },
  {
    name: 'submit_battery_lead',
    description: 'Saves the battery the customer chose so our team can phone them. Call this exactly once, in the same turn the customer picks one of the quoted options (by number or by name, e.g. "1", "the Willard", "I\'ll take the Varta") — never before they choose. Use that option\'s size SKU and product code exactly as get_prices returned them.',
    input_schema: {
      type: 'object',
      properties: {
        sku:         { type: 'string', description: 'Battery size SKU from get_prices, e.g. "658AGM"' },
        productCode: { type: 'string', description: 'The chosen option\'s productSKU from get_prices, e.g. "658-G14"' },
        vehicle:     { type: 'string', description: 'Customer\'s vehicle, e.g. "2016 Audi A4 2.0 TFSI"' },
      },
      required: ['sku', 'productCode', 'vehicle'],
      additionalProperties: false,
    },
  },
];

// True if at least one word of the searched model is something the customer actually said —
// allowing typo fixes ("Corola" -> "Corolla") but not swapping in another car ("Tazz" -> "Golf").
// Engine codes with digits ("320i", "C200") are exempt — the BMW/Mercedes series→engine-code retry relies on them.
function customerMentioned(model, customerText) {
  if (!customerText) return true;
  const words  = customerText.toLowerCase().match(/[a-z0-9]+/g) || [];
  const tokens = (model || '').toLowerCase().match(/[a-z0-9]+/g) || [];
  const wordy  = tokens.filter(t => /^[a-z]{2,}$/.test(t));
  if (wordy.length === 0) return true;
  return wordy.some(t => words.some(w =>
    w === t || (t.length >= 4 && w.length >= 4 && w.slice(0, 4) === t.slice(0, 4))
  ));
}

function executeTool(name, input, ctx) {
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
    if (!customerMentioned(model, ctx?.customerText)) {
      console.warn('[Tool] search_vehicles blocked — model not mentioned by customer:', model);
      return {
        found: false,
        blocked: true,
        message: `The customer never mentioned "${model}". Never search for a different or "similar" model than the one they gave — a sibling model can take a different battery. If their own model isn't found, use the not-found reply.`,
      };
    }
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
    rememberSkus(ctx?.from, [result.sku]);
    rememberQuote(ctx?.from, result.sku);
    const hasSpecs = result._brands.some(b => b.ahrating != null || b.ccasae != null || b.ccaen != null);
    return {
      found: true,
      sku: result.sku,
      ...(hasSpecs ? {} : { specsNote: 'No Ah, CCA or size data is on file for this battery. Do NOT show a ⚡ specs line or mention any Ah/CCA/dimensions — if the customer asks, say our team can confirm the specs on 011 312 4743.' }),
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
    rememberSkus(ctx?.from, results.map(r => r.sku));
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

  if (name === 'submit_parts_lead') {
    const { fulfilment, deliveryAddress, vehicle, parts } = input;
    const request = [
      `Vehicle: ${vehicle}`,
      `Part(s): ${parts}`,
      fulfilment === 'deliver'
        ? `Deliver to: ${deliveryAddress || '(address not captured)'}`
        : 'Collect in-store at Midrand Midas',
    ].join('\n');
    logLead({ from: ctx.from, profileName: ctx.profileName, type: 'parts', request });
    // Also saved to the parts leads dashboard database, in the background — the customer's reply
    // never waits on it. Name and phone come from the webhook, never from the AI's input.
    const lead = buildPartsLead({
      fulfilment, deliveryAddress, vehicle, parts,
      from: ctx.from, customerName: ctx.profileName,
    });
    console.log('[LEAD] parts', JSON.stringify(partsLeadForLogs(lead)));
    savePartsWithRetry(lead)
      .then(r => console.log('[PartsLead] Saved', r.leadId))
      .catch(err => recordUnsavedPartsLead(lead, err));
    return { success: true };
  }

  if (name === 'submit_battery_lead') {
    // Only the battery fields come from the AI — who the customer is comes from the webhook
    const lead = buildBatteryLead({
      sku: input.sku, productCode: input.productCode, vehicle: input.vehicle,
      from: ctx.from, customerName: ctx.profileName,
    });
    if (!lead) return { saved: false, error: 'That battery is not in the catalogue — re-check the option the customer picked.' };
    if (!wasQuoted(ctx.from, lead.batterySku)) {
      return { saved: false, error: `Size ${lead.batterySku} was not quoted to this customer — use the size and product code of the option they actually picked.` };
    }
    const masked = { ...lead, phone: '****' + lead.phone.slice(-4) };
    console.log('[LEAD] battery', JSON.stringify(masked));
    // Saved in the background — the customer's reply never waits on (or fails because of) the database.
    // Retried for ~12 minutes; if every attempt fails, the lead goes to the staff leads sheet instead.
    saveWithRetry(lead)
      .then(r => console.log('[BatteryLead] Saved', r.leadId, r.updated ? '(updated re-pick)' : ''))
      .catch(err => recordUnsavedLead(lead, err));
    return { saved: true, brand: lead.batteryBrand, productCode: lead.productCode, price: lead.priceQuoted };
  }

  return { error: `Unknown tool: ${name}` };
}

// Brands we don't stock — mentioned in the same message as vehicle info, the model
// reliably jumps straight into the tool-calling search and never circles back to
// acknowledge the brand, even with an explicit per-turn reminder injected into the
// prompt (verified: both static prompt wording and a dynamic [System: ...] note
// got the acknowledgement into well under half of test replies). This is a real
// business requirement — customers asking about a brand should never be silently
// ignored — so it's guaranteed in code instead of left to the model.
const UNSTOCKED_BRANDS = ['bosch', 'energizer', 'motolite'];

function detectUnstockedBrandMention(message) {
  const lower = message.toLowerCase();
  return UNSTOCKED_BRANDS.find(b => new RegExp(`\\b${b}\\b`).test(lower));
}

// Guaranteed battery lead — when a customer names the battery instead of replying with a number,
// the model confirms the pick ("Excellent choice") but skips submit_battery_lead often enough that
// staff would never hear about it (seen in testing). If the reply confirms a pick and no lead was
// submitted this turn, make one extra call that must use the tool. Never shown to the customer.
const PICK_CONFIRMED = /excellent choice/i;

async function ensureBatteryLead({ reply, toolsUsed, messages, system, ctx, createMessage }) {
  // Only after a battery quote — "excellent choice" in a parts or other reply must not invent a pick
  if (!PICK_CONFIRMED.test(reply) || toolsUsed.includes('submit_battery_lead') || !quotedOptionsText(ctx.from)) return false;
  try {
    const response = await createMessage({
      model: MODEL,
      max_tokens: 300,
      system,
      tools: TOOLS,
      tool_choice: { type: 'tool', name: 'submit_battery_lead' },
      messages: [
        ...messages,
        { role: 'assistant', content: reply },
        { role: 'user', content: `[System: The customer has just chosen a battery. Call submit_battery_lead for the option they chose.${quotedOptionsText(ctx.from) ? ` The batteries quoted to them were: ${quotedOptionsText(ctx.from)}. Use that option's product code and size exactly as written.` : ' Use its size SKU and productSKU from get_prices.'}]` },
      ],
    });
    const call = response.content.find(b => b.type === 'tool_use' && b.name === 'submit_battery_lead');
    if (!call) return false;
    console.log('[Tool] submit_battery_lead (forced)', JSON.stringify(call.input));
    const result = executeTool('submit_battery_lead', call.input, ctx);
    if (!result.saved) console.warn('[BatteryLead] Forced lead not saved:', result.error);
    return result.saved;
  } catch (err) {
    console.error('[BatteryLead] Forced lead call failed:', err.message);
    return false;
  }
}

async function runAIConversation(from, message, history, profileName) {
  const startMs = Date.now();

  // The API rejects empty user turns (66 "something went wrong" replies in one week) —
  // never send one, and drop any that slipped into stored history
  history = history.filter(m => typeof m.content !== 'string' || m.content.trim());
  if (!(message || '').trim()) {
    return {
      reply: `I didn't catch that 🤔 Please *type* your vehicle's make, model and year _(e.g. Toyota Hilux 2019)_, or send a photo of your licence disc 📸`,
      history,
    };
  }

  // Build system prompt once and cache it — avoids reprocessing on every tool round
  // Customer name is a small non-cached addition so the large prompt stays cached
  const systemPrompt = [
    { type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } },
    ...(profileName ? [{
      type: 'text',
      text: `The customer's name is ${profileName}. Use their first name at key moments — when greeting them, when you find a match ("Great news, ${profileName}!"), when presenting options, and when closing. Not every sentence — just the moments that feel natural and warm.`,
    }] : []),
    // Chat history keeps only text, so remind the model of the exact codes it quoted — used for submit_battery_lead
    ...(quotedOptionsText(from) ? [{
      type: 'text',
      text: `Batteries already quoted to this customer (brand, product code, size): ${quotedOptionsText(from)}. If they pick one, call submit_battery_lead with that product code and size exactly as written here.`,
    }] : []),
  ];

  const brandMention = detectUnstockedBrandMention(message);

  // Everything the customer has said, so search_vehicles can refuse a model they never mentioned
  const customerText = [...history.filter(m => m.role === 'user' && typeof m.content === 'string').map(m => m.content), message].join(' ');

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
  let agmDetected = false;

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
        console.log('[Tool]', b.name, JSON.stringify(b.input));
        let result;
        try {
          result = executeTool(b.name, b.input, { from, profileName, customerText });
        } catch (err) {
          console.error('[Tool] ' + b.name + ' failed:', err.message);
          result = { error: `${b.name} failed. Do not guess the result — offer to have our team help instead.` };
        }
        const raw = JSON.stringify(result);
        // Only get_prices confirms AGM pricing is actually being shown — search_vehicles
        // can return an AGM SKU as just one of several unconfirmed variant options.
        if (b.name === 'get_prices' && raw.toUpperCase().includes('AGM')) agmDetected = true;
        const content = raw.length > MAX_TOOL_RESULT_CHARS
          ? raw.slice(0, MAX_TOOL_RESULT_CHARS) + '...[truncated]'
          : raw;
        return { type: 'tool_result', tool_use_id: b.id, content };
      });

    workingMessages.push({ role: 'user', content: toolResults });
  }

  const textBlock = response.content.find(b => b.type === 'text');
  // If the lead was actually submitted but the model failed to produce a closing
  // message (e.g. ran out of tool rounds), don't scare the customer with a generic
  // error — the request already reached the parts team.
  let reply = textBlock?.text
    || (toolsUsed.includes('submit_parts_lead')
      ? "Thank you! We're now processing your quote. If you don't hear from us, give us a call: *011 312 4743*."
      : 'Sorry, something went wrong. Please try again or call us on *011 312 4743*.');

  if (await ensureBatteryLead({
    reply, toolsUsed, messages: workingMessages, system: systemPrompt,
    ctx: { from, profileName, customerText }, createMessage: req => client.messages.create(req),
  })) toolsUsed.push('submit_battery_lead');

  // Guaranteed brand acknowledgement — see note on detectUnstockedBrandMention above.
  // Only prepend if the model didn't already address it on its own.
  if (brandMention && !reply.toLowerCase().includes(brandMention)) {
    const brandTitleCase = brandMention.charAt(0).toUpperCase() + brandMention.slice(1);
    reply = `We don't stock ${brandTitleCase}, but our *VARTA* is genuine OEM quality! 🔋\n\n${reply}`;
  }

  // Guaranteed AGM explanation — an AGM battery costs noticeably more, and the model
  // skips this explanation often enough (~1 in 3 test replies) that a silent price
  // jump risks looking like a mistake or upsell. Skip if the customer already typed
  // "AGM"/Stop-Start themselves (they clearly already know) or the reply covers it.
  if (agmDetected && !/agm/i.test(message) && !/\bagm\b|stop.?start/i.test(reply)) {
    reply = `Since your vehicle has a Stop/Start system, it needs an *AGM battery* — these are built to handle the engine restarting dozens of times per trip. A standard battery would wear out quickly and could damage your electronics. Good news: we've got exactly what you need! 🔋\n\n${reply}`;
  }

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

module.exports = { runAIConversation, executeTool, ensureBatteryLead };
