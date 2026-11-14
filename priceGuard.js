// Last check on every outgoing message: any rand amount that isn't a catalogue price for the
// battery size it's quoted against is replaced, so the bot can never send a made-up price.
//
// "The size it's quoted against" = SKUs named in the same block (options are separated by ━━
// dividers or blank lines), else SKUs anywhere in the message, else the SKUs this customer was
// last quoted for (e.g. "that's R1,550 incl. trade-in" a few turns after the quote).

const { getAvailableSKUs, getPricesForSKU } = require('./catalogue');

const UNCONFIRMED_PRICE = 'our team will confirm the price';
const RECENT_SKU_TTL_MS = 2 * 60 * 60 * 1000;

// R1550, R1,550, R1 550, R 1 550, R1,550.00 — not followed by a letter/digit (so not "R2D2")
const RAND_RE = /\bR\s?(\d{1,3}(?:[ , ]\d{3})+|\d+)(?:\.\d{2})?(?![\w])/g;

const recentSkus = new Map(); // from -> { skus: Set, at }

// Supplier product codes (PSKUs) -> the battery size they belong to, e.g. "646-D52" -> "646agm".
// Without this, "VARTA (646-D52)" reads as plain SKU 646 and its real AGM price gets blocked.
function pskuPatterns() {
  const patterns = [];
  for (const sku of getAvailableSKUs()) {
    for (const b of getPricesForSKU(sku)) {
      const parts = (b.psku || '').toLowerCase().match(/[a-z0-9]+/g);
      if (!parts) continue;
      // allow "646-D52", "646 D52" or "646D52"
      patterns.push({ re: new RegExp(`(?<![a-z0-9])${parts.join('[\\s-]?')}(?![a-z0-9])`, 'gi'), sku: sku.toLowerCase() });
    }
  }
  // longest codes first so "646AGMS" is matched before "646AGM"
  return patterns.sort((a, b) => b.re.source.length - a.re.source.length);
}

function skusIn(text) {
  const priced = new Set(getAvailableSKUs().map(s => s.toLowerCase()));
  const found = new Set();

  // Ignore rand amounts — "R4,650" must not read as SKU 650
  let rest = text.replace(RAND_RE, ' ');
  // Pull out supplier codes first, so their leading digits don't also count as the plain size
  for (const { re, sku } of pskuPatterns()) {
    rest = rest.replace(re, () => { found.add(sku); return ' '; });
  }

  // "646 AGM" -> "646agm" so it matches the AGM SKU rather than the plain 646
  const tokens = rest.replace(/(\d{3})\s+agm\b/gi, '$1agm').toLowerCase().match(/[a-z0-9]+/g) || [];
  tokens.filter(t => priced.has(t)).forEach(t => found.add(t));
  return found;
}

function rememberSkus(from, skus) {
  const list = [...skus].map(s => s.toString().toLowerCase()).filter(Boolean);
  if (!from || list.length === 0) return;
  recentSkus.set(from, { skus: new Set(list), at: Date.now() });
}

function rememberedSkus(from) {
  const entry = recentSkus.get(from);
  if (!entry || Date.now() - entry.at > RECENT_SKU_TTL_MS) return new Set();
  return entry.skus;
}

function catalogueRands(skus) {
  const rands = new Set();
  for (const sku of skus) {
    for (const b of getPricesForSKU(sku)) {
      const n = Math.round(parseFloat(b.price));
      if (!isNaN(n)) rands.add(n);
    }
  }
  return rands;
}

// "saves you R400", "R500 cheaper", "R300 less than" — the bot must only quote listed prices,
// never savings or price differences. Matches the word on either side of the amount.
const SAVINGS_WORDS = '(?:sav(?:e|es|ing|ings)|cheaper|less|difference|extra|more|off|discount)';
const SAVINGS_RE = new RegExp(
  `${SAVINGS_WORDS}[^.!?\\n]{0,25}\\bR\\s?\\d|\\bR\\s?[\\d ,.]+\\s*(?:\\w+\\s+){0,2}${SAVINGS_WORDS}\\b`, 'i');

const mask = from => (from ? '****' + String(from).slice(-4) : '');

// Remove the parts of a message that fail `isBad`, line by line. A 💡 tip is dropped whole
// (it's optional and italic-wrapped); otherwise only the offending clause onwards is cut, so
// "Sabat is the cheapest at R4,650 — that's R550 less…" keeps "Sabat is the cheapest at R4,650."
function stripLines(text, isBad, onRemove) {
  return text.split('\n').map(line => {
    if (!isBad(line)) return line;
    onRemove(line);
    if (/^\s*💡/.test(line)) return null;
    const kept = line.split(/(?<=[.!?])\s+/).map(sentence => {
      if (!isBad(sentence)) return sentence;
      const clauses = sentence.split(/\s+—\s+|;\s+|,\s+/);
      const good = [];
      for (const c of clauses) { if (isBad(c)) break; good.push(c); }
      if (!good.length) return '';
      return good.join(', ').replace(/[\s,]+$/, '').replace(/([^.!?])$/, '$1.');
    }).filter(Boolean).join(' ').trim();
    return /[a-z0-9]/i.test(kept) ? kept : null;
  }).filter(l => l !== null).join('\n');
}

function stripSavings(from, text) {
  return stripLines(text, l => SAVINGS_RE.test(l), line =>
    console.warn('[PriceGuard] Removed savings amount', JSON.stringify({ from: mask(from), line })));
}

// Ah / CCA figures: "70Ah", "70 amp hours", "760 CCA", "CCA of 760"
const SPEC_RE = /\b(\d{2,4}(?:\.\d)?)\s?(?:ah|a\/h|amp[\s-]?hours?)\b|\b(\d{3,4})\s?cca\b|\bcca\s?(?:of\s|:\s?)?(\d{3,4})\b/gi;

function catalogueSpecs(skus) {
  const specs = new Set();
  for (const sku of skus) {
    for (const b of getPricesForSKU(sku)) {
      for (const v of [b.ahrating, b.ccasae, b.ccaen]) {
        const n = Math.round(parseFloat(v));
        if (!isNaN(n)) specs.add(n);
      }
    }
  }
  return specs;
}

// The catalogue may not carry Ah/CCA for a battery — never let the bot make them up
function stripUnverifiedSpecs(from, text, skus) {
  if (!skus.size) return text; // not talking about a specific battery
  const allowed = catalogueSpecs(skus);
  const isBad = s => [...s.matchAll(SPEC_RE)].some(m => !allowed.has(Math.round(parseFloat(m[1] || m[2] || m[3]))));
  return stripLines(text, isBad, line =>
    console.warn('[PriceGuard] Removed unverified spec', JSON.stringify({ from: mask(from), line, skus: [...skus] })));
}

function guardPrices(from, text) {
  if (!text) return text;
  text = stripSavings(from, text);
  {
    const skus = skusIn(text);
    text = stripUnverifiedSpecs(from, text, skus.size ? skus : rememberedSkus(from));
  }

  const messageSkus = skusIn(text);
  const fallbackSkus = messageSkus.size ? messageSkus : rememberedSkus(from);

  // Split keeps the separators, so joining the parts rebuilds the message exactly
  const parts = text.split(/(\n[^\n]*━[^\n]*\n|\n\s*\n)/);
  const checked = parts.map((part, i) => {
    if (i % 2 === 1) return part;
    const blockSkus = skusIn(part);
    const allowed = catalogueRands(blockSkus.size ? blockSkus : fallbackSkus);

    return part.replace(RAND_RE, (match, digits) => {
      const amount = Math.round(parseFloat(digits.replace(/[ , ]/g, '')));
      if (allowed.has(amount)) return match;
      console.warn('[PriceGuard] Replaced unverified price', JSON.stringify({
        from: from ? '****' + String(from).slice(-4) : '', price: match,
        skus: [...(blockSkus.size ? blockSkus : fallbackSkus)],
      }));
      return UNCONFIRMED_PRICE;
    });
  });

  rememberSkus(from, messageSkus);
  return checked.join('');
}

module.exports = { guardPrices, rememberSkus, UNCONFIRMED_PRICE };
