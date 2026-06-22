const XLSX = require('xlsx');
const path = require('path');

const CATALOGUE_PATH = process.env.CATALOGUE_PATH || path.join(__dirname, 'catalogue.xlsx');

let makeIndex = {};  // make (lowercase) → vehicle rows
let priceMap  = {};  // sku (string, lowercase) → [ { brand, psku, price, warrantyperiod }, ... ]
let allMakes  = [];
let loaded    = false;

function normaliseKey(key) {
  return key.toString().toLowerCase().replace(/[\s_]/g, '');
}

function normaliseRow(row) {
  const result = {};
  for (const [key, val] of Object.entries(row)) {
    const k = normaliseKey(key);
    if (k === '__empty' || k === '') continue; // skip blank/junk columns
    result[k] = typeof val === 'string' ? val.trim() : val;
  }
  return result;
}

function skuKey(val) {
  return val?.toString().trim().toLowerCase() || '';
}

function loadData() {
  const workbook = XLSX.readFile(CATALOGUE_PATH);

  if (workbook.SheetNames.length < 2) {
    throw new Error('catalogue.xlsx must have at least 2 sheets: Sheet 1 = vehicles, remaining = supplier price lists');
  }

  // --- Sheet 1: Vehicles ---
  const vehicleSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rawVehicles  = XLSX.utils.sheet_to_json(vehicleSheet, { defval: '' });

  // Build make index for fast filtering
  makeIndex = {};
  rawVehicles.forEach(raw => {
    const r    = normaliseRow(raw);
    const make = (r.make || '').toUpperCase().trim();
    if (!make) return;
    if (!makeIndex[make]) makeIndex[make] = [];
    makeIndex[make].push(r);
  });
  allMakes = Object.keys(makeIndex).sort();

  // --- Sheets 2+: Supplier price lists (sheet name = brand) ---
  priceMap = {};
  workbook.SheetNames.slice(1).forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });

    rows.forEach(raw => {
      const r   = normaliseRow(raw);
      const sku = skuKey(r.sku);
      if (!sku) return;

      const brand = ((r.brand || sheetName).toString().trim()) || sheetName;
      const entry = {
        brand,
        psku:           (r.psku || '').toString().trim(),
        price:          r.price,
        ahrating:       r.ahrating !== '' ? r.ahrating : undefined,
        ccasae:         r.ccasae  !== '' ? r.ccasae  : undefined,
        ccaen:          r.ccaen   !== '' ? r.ccaen   : undefined,
        length:         r.length  !== '' ? r.length  : undefined,
        width:          r.width   !== '' ? r.width   : undefined,
        height:         r.height  !== '' ? r.height  : undefined,
        warrantyperiod: (r.warrantyperiod || '').toString().trim(),
      };

      if (!priceMap[sku]) priceMap[sku] = [];
      priceMap[sku].push(entry);
    });
  });

  loaded = true;
  const totalVehicles = Object.values(makeIndex).reduce((s, a) => s + a.length, 0);
  console.log(`Catalogue loaded: ${totalVehicles} vehicle rows, ${allMakes.length} makes, ${workbook.SheetNames.length - 1} supplier sheet(s)`);
}

function ensureLoaded() {
  if (!loaded) loadData();
}

function reloadCatalogue() {
  loaded = false;
  makeIndex = {};
  priceMap  = {};
  allMakes  = [];
  loadData();
}

// --- Lookup ---

function getUniqueMakes() {
  ensureLoaded();
  return allMakes;
}

function getPricesForSKU(sku) {
  return priceMap[skuKey(sku)] || [];
}

// Search vehicles by make + free-text against MODEL DESCRIPTION.
// Returns results grouped by unique SKU (battery type), each with year range.
function searchByMakeAndDescription(make, descQuery) {
  ensureLoaded();
  const makeUpper = make.toUpperCase().trim();
  const rows      = makeIndex[makeUpper] || [];
  const q         = descQuery.toLowerCase().trim();

  const matching = rows.filter(r =>
    (r.modeldescription || '').toLowerCase().includes(q)
  );

  // Group by SKU — deduplicate vehicle variants, collect year range
  const skuGroups = new Map();
  matching.forEach(r => {
    const sku = skuKey(r.sku);
    if (!sku) return;

    if (!skuGroups.has(sku)) {
      skuGroups.set(sku, {
        sku:          r.sku?.toString().trim() || sku,
        make:         r.make || makeUpper,
        vehicletype:  r.vehicletype || '',
        descriptions: new Set(),
        years:        [],
        specifics:    r.modelspecifics || '',
      });
    }
    const g = skuGroups.get(sku);
    if (r.modeldescription) g.descriptions.add(r.modeldescription);
    if (r.yearmodel)        g.years.push(Number(r.yearmodel));
    if (r.modelspecifics && !g.specifics) g.specifics = r.modelspecifics;
  });

  return [...skuGroups.values()].map(g => {
    const sortedYears = g.years.filter(y => !isNaN(y)).sort((a, b) => a - b);
    const yearRange   = sortedYears.length === 0 ? ''
      : sortedYears[0] === sortedYears[sortedYears.length - 1]
        ? `${sortedYears[0]}`
        : `${sortedYears[0]}-${sortedYears[sortedYears.length - 1]}`;

    return {
      sku:          g.sku,
      make:         g.make,
      vehicletype:  g.vehicletype,
      descriptions: [...g.descriptions].sort(),
      yearRange,
      specifics:    g.specifics,
      _brands:      getPricesForSKU(g.sku),
    };
  });
}

// Search the price catalogue by Ah rating and/or CCA — used when customer knows their specs
function findBySpecs({ ah, cca } = {}) {
  ensureLoaded();
  const results = [];

  for (const [sku, brands] of Object.entries(priceMap)) {
    if (!brands.length) continue;
    const first = brands[0];

    const ahVal  = first.ahrating !== undefined ? Number(first.ahrating) : null;
    const ccaVal = first.ccasae   !== undefined ? Number(first.ccasae)   : null;

    const ahMatch  = ah  == null || (ahVal  !== null && Math.abs(ahVal  - Number(ah))  <= 5);
    const ccaMatch = cca == null || (ccaVal !== null && Math.abs(ccaVal - Number(cca)) <= 60);

    if (ahMatch && ccaMatch) {
      results.push({
        sku:      sku.toUpperCase(),
        ahrating: ahVal,
        ccasae:   ccaVal,
        _brands:  brands,
      });
    }
  }

  return results.sort((a, b) => (a.ahrating || 0) - (b.ahrating || 0));
}

// Returns all SKUs that have pricing data, sorted numerically then alpha
function getAvailableSKUs() {
  ensureLoaded();
  return Object.keys(priceMap).sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  ).map(s => s.toUpperCase());
}

// Direct SKU lookup — used for "search by battery code" path
function findBySKU(skuQuery) {
  ensureLoaded();
  const q       = skuQuery.toLowerCase().trim();
  const brands  = priceMap[q] || [];

  // Also find any vehicle rows that use this SKU
  const matchingVehicles = [];
  for (const [, rows] of Object.entries(makeIndex)) {
    for (const r of rows) {
      if (skuKey(r.sku) === q) {
        matchingVehicles.push(r);
        break; // one sample row per make is enough
      }
    }
  }

  if (brands.length === 0 && matchingVehicles.length === 0) return null;

  const firstVehicle = matchingVehicles[0] || {};
  return {
    sku:          skuQuery.toUpperCase(),
    make:         '',
    vehicletype:  firstVehicle.vehicletype || '',
    descriptions: [],
    yearRange:    '',
    specifics:    firstVehicle.modelspecifics || '',
    _brands:      brands,
  };
}

// --- Formatting ---

const DIVIDER = '━━━━━━━━━━━━━━';

function formatPrice(val) {
  const num = parseFloat(val);
  if (isNaN(num)) return val?.toString() || '';
  return `R${num.toLocaleString('en-ZA')}`;
}

// Extract engine sizes like "2.0", "2.4", "3.0" from description strings
function extractVariants(descriptions) {
  const sizes = new Set();
  descriptions.forEach(d => {
    const matches = d.match(/\b\d+\.\d+\b/g);
    if (matches) matches.forEach(m => sizes.add(m));
  });
  return [...sizes].sort((a, b) => parseFloat(a) - parseFloat(b));
}

// Format MODEL SPECIFICS: put engine code first, then valve/power specs
function formatSpecifics(specifics) {
  if (!specifics) return '';
  const parts = specifics.split(',').map(s => s.trim()).filter(Boolean);
  const isSpec = p => /^\d+V$/i.test(p) || /^\d+KW$/i.test(p) || /^\d+$/.test(p);
  const codes  = parts.filter(p => !isSpec(p));
  const specs  = parts.filter(p => isSpec(p));
  return [...codes, ...specs].join(' | ');
}

function formatResult(b) {
  const businessName = process.env.BUSINESS_NAME || 'First Battery Woodmead';
  const lines = [];

  lines.push('🔋 *Great news — here\'s what we have for you!*');

  if (b._brands && b._brands.length > 0) {
    b._brands.forEach((entry, i) => {
      lines.push(DIVIDER);
      const label = [entry.brand, entry.psku].filter(Boolean).join(' — ');
      lines.push(`*${i + 1} — ${label}*`);
      if (entry.price !== '' && entry.price !== undefined) lines.push(`💰 ${formatPrice(entry.price)} incl. VAT`);

      const ahPart  = entry.ahrating !== undefined ? `${entry.ahrating}Ah` : '';
      const ccaPart = entry.ccasae   !== undefined ? `${entry.ccasae} CCA` : '';
      if (ahPart || ccaPart) lines.push(`⚡ ${[ahPart, ccaPart].filter(Boolean).join(' | ')}`);

      if (entry.warrantyperiod) lines.push(`🛡️ ${entry.warrantyperiod}`);
      lines.push('');
    });

    if (b._brands.length > 1) {
      lines.push(`_Reply with *1* or *2* to choose, or call us if you need advice._`);
      lines.push('');
    }
  } else {
    lines.push(DIVIDER);
    lines.push(`_We don't currently have pricing on file for SKU *${b.sku}*._`);
    lines.push(`_Call us and our team will source the right battery for you! 😊_`);
    lines.push(`📞 *(010) 746 6260* | 💬 *+27 87 250 2643*`);
    lines.push('');
  }

  lines.push(DIVIDER);
  lines.push(`📦 Battery SKU: ${b.sku}`);
  lines.push('ℹ️ All prices include the trade-in of your old battery.');
  lines.push(`💲 Prices are exclusive to ${businessName}.`);
  lines.push('_Budget a little tight? We accept *PayJustNow* & *Payflex* — buy now, pay later!_');
  lines.push('🔧 *Onsite fitment available* at our Woodmead branch.');
  lines.push('⚠️ Vehicles fitted with Start/Stop systems require AGM batteries.');
  lines.push('');
  lines.push('*0* — Contact Us | *menu* — Start Over');

  return lines.join('\n');
}

function formatResults(results) {
  if (!results || results.length === 0) return null;
  return results.map(b => formatResult(b)).join(`\n\n${DIVIDER}\n\n`);
}

function findBestAGMMatch(targetAh, agmSkus) {
  ensureLoaded();
  const summaries = getAGMSummaries(agmSkus).filter(s => s.ahrating !== undefined);
  if (summaries.length === 0) return null;

  const sorted = [...summaries].sort((a, b) => a.ahrating - b.ahrating);
  const match  = sorted.find(s => s.ahrating >= targetAh) || sorted[sorted.length - 1];
  return findBySKU(match.sku);
}

function getAGMSummaries(skus) {
  ensureLoaded();
  return skus.map(sku => {
    const brands = priceMap[skuKey(sku)] || [];
    const first  = brands[0] || {};
    return {
      sku:      sku.toUpperCase(),
      ahrating: first.ahrating,
      ccasae:   first.ccasae,
    };
  }).filter(s => s.ahrating !== undefined || s.ccasae !== undefined);
}

module.exports = {
  getUniqueMakes,
  getAvailableSKUs,
  searchByMakeAndDescription,
  findBySKU,
  findBySpecs,
  getAGMSummaries,
  findBestAGMMatch,
  formatPrice,
  formatResults,
  reloadCatalogue,
};
