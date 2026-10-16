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

function skusIn(text) {
  const priced = new Set(getAvailableSKUs().map(s => s.toLowerCase()));
  // "646 AGM" -> "646agm" so it matches the AGM SKU rather than the plain 646
  const tokens = text.replace(/(\d{3})\s+agm\b/gi, '$1agm').toLowerCase().match(/[a-z0-9]+/g) || [];
  return new Set(tokens.filter(t => priced.has(t)));
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

function guardPrices(from, text) {
  if (!text) return text;

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
