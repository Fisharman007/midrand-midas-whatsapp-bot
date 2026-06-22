require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const axios     = require('axios');
let sharp;
try {
  sharp = require('sharp');
  console.log('[ImageDebug] sharp loaded OK, version:', sharp.versions?.sharp);
} catch (e) {
  console.warn('[ImageDebug] sharp failed to load:', e.message);
  sharp = null;
}
const { readLicenceDiscByMediaId, readBatteryLabelByMediaId } = require('./licenceDiscReader');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Stores the last image received — accessible via /admin/last-image for debugging
let lastImage = null;

function getLastImage() { return lastImage; }

async function downloadRawBuffer(imageUrl) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const hasAuth    = !!(accountSid && authToken);
  console.log(`[ImageDebug] Fetching image | auth: ${hasAuth}`);

  // First attempt: with Twilio Basic auth
  let res;
  try {
    res = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      maxRedirects: 0,  // handle redirects manually to avoid sending auth to S3
      ...(hasAuth && { auth: { username: accountSid, password: authToken } }),
    });
  } catch (err) {
    if (err.response?.status === 301 || err.response?.status === 302 || err.response?.status === 307 || err.response?.status === 308) {
      // Redirect — follow without auth (e.g. Twilio → S3)
      const redirectUrl = err.response.headers.location;
      console.log('[ImageDebug] Redirect → following without auth');
      res = await axios.get(redirectUrl, { responseType: 'arraybuffer', maxRedirects: 5 });
    } else if (err.response?.status === 401) {
      // Auth failed — try without credentials (some Twilio URLs are public after signing)
      console.warn(`[ImageDebug] 401 with auth — retrying without credentials`);
      res = await axios.get(imageUrl, { responseType: 'arraybuffer', maxRedirects: 5 });
    } else {
      console.error(`[ImageDebug] Download failed: ${err.response?.status}`);
      throw err;
    }
  }

  const buf         = Buffer.from(res.data);
  const contentType = res.headers['content-type'] || 'image/jpeg';

  if (buf.length < 30_000) {
    console.warn(`[ImageDebug] ⚠️  Downloaded only ${buf.length}B — likely a thumbnail, quality may be poor`);
  } else {
    console.log(`[ImageDebug] Downloaded ${buf.length}B, type: ${contentType}`);
  }
  return { buf, contentType };
}

async function preprocessImage(inputBuf) {
  if (!sharp) {
    console.warn('[ImageDebug] sharp not installed — skipping preprocessing');
    return inputBuf;
  }
  try {
    const out = await sharp(inputBuf)
      .resize(1568, 1568, { fit: 'inside', withoutEnlargement: false })
      .normalise()
      .sharpen()
      .jpeg({ quality: 95 })
      .toBuffer();
    console.log(`[ImageDebug] Preprocessed: ${inputBuf.length}B → ${out.length}B`);
    return out;
  } catch (err) {
    console.warn('[ImageDebug] Preprocessing failed, using original:', err.message);
    return inputBuf;
  }
}

async function downloadImageAsBase64(imageUrl) {
  const { buf, contentType } = await downloadRawBuffer(imageUrl);
  const processed = await preprocessImage(buf);
  const base64    = processed.toString('base64');
  lastImage = { base64, contentType: 'image/jpeg', url: imageUrl, ts: new Date().toISOString() };
  return { base64, contentType: 'image/jpeg' };
}

async function readLicenceDisc(imageUrl, mediaId = null) {
  // WhatsApp Cloud API path — download via media_id + Bearer token
  if (mediaId) {
    const raw = await readLicenceDiscByMediaId(mediaId);
    if (!raw || (!raw.make && !raw.model)) return null;
    return {
      make:  (raw.make  || '').toUpperCase().trim(),
      model: (raw.model || '').toUpperCase().trim(),
      year:  (raw.year  || '').trim(),
      cc:    '',
    };
  }

  // Twilio path — download, preprocess, send to Claude
  const { buf: rawBuf } = await downloadRawBuffer(imageUrl);
  const processedBuf    = await preprocessImage(rawBuf);
  const base64          = processedBuf.toString('base64');
  lastImage = { base64, contentType: 'image/jpeg', url: imageUrl, ts: new Date().toISOString() };
  console.log(`[LicenceDisc] Sizes — raw: ${rawBuf.length}B, processed: ${processedBuf.length}B`);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
        },
        {
          type: 'text',
          text: 'This image is a South African vehicle licence disc, usually photographed through a windscreen — expect glare, reflections and slight angle. IGNORE the barcode completely. Transcribe only the printed text fields and return STRICT JSON with these keys (use null if unreadable): licence_no, vehicle_register_no, vin, engine_no, make, description, gvm_kg, tare_kg, date_of_test, expiry_date, seated_persons. Return ONLY the JSON object, no markdown fences, no commentary.',
        },
      ],
    }],
  });

  const rawText = response.content.find(b => b.type === 'text')?.text || '';
  console.log(`[LicenceDisc] Claude raw response: ${rawText}`);

  const jsonStr = extractJson(rawText);
  if (!jsonStr) return null;

  try {
    const data = JSON.parse(jsonStr);

    const vinOk    = data.vin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(data.vin);
    const makeOk   = data.make && data.make.trim().length > 0;
    const expiryOk = data.expiry_date && !isNaN(Date.parse(data.expiry_date));
    console.log(`[LicenceDisc] Validation — make: ${makeOk}, vin: ${vinOk}, expiry: ${expiryOk}`);

    if (!makeOk || !vinOk) return { retryable: true };

    const year = data.date_of_test
      ? (String(data.date_of_test).match(/\d{4}/)?.[0] || '')
      : '';

    return {
      make:  data.make.toUpperCase().trim(),
      model: (data.description || '').toUpperCase().trim(),
      year,
      cc:    '',
    };
  } catch {
    return null;
  }
}

async function readBatteryLabel(imageUrl, mediaId = null) {
  try {
    let data;

    if (mediaId) {
      data = await readBatteryLabelByMediaId(mediaId);
    } else {
      const { base64, contentType } = await downloadImageAsBase64(imageUrl);
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } },
            {
              type: 'text',
              text: `This is a car battery label. Extract the following and return ONLY valid JSON:
{"sku":"","brand":"","ah":"","voltage":"","cca":""}
SKU is the battery part/model number (e.g. "646", "668", "NS70", "DIN88", "F668P"). Use empty string for any field not visible. If this is not a battery label, return: {"error":"not_a_battery"}. Return JSON only.`,
            },
          ],
        }],
      });
      const text    = response.content.find(b => b.type === 'text')?.text || '';
      const jsonStr = extractJson(text);
      if (!jsonStr) return null;
      data = JSON.parse(jsonStr);
    }

    if (!data || data.error) return null;
    if (!data.sku && !data.ah) return null;
    return {
      sku:     (data.sku     || '').trim(),
      brand:   (data.brand   || '').trim(),
      ah:      (data.ah      || '').trim(),
      voltage: (data.voltage || '').trim(),
      cca:     (data.cca     || '').trim(),
    };
  } catch (err) {
    console.error('[BatteryLabel] Error:', err.message);
    return null;
  }
}

function extractJson(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

function parseSpecsJson(text) {
  const m = extractJson(text);
  if (!m) return null;
  try {
    const data = JSON.parse(m[0]);
    if (data.error) return null;
    const ah = parseFloat(data.ah), cca = parseFloat(data.cca);
    if (isNaN(ah) || isNaN(cca)) return null;
    return { ah, cca, is_start_stop: !!data.is_start_stop };
  } catch {
    return null;
  }
}

// In-memory cache: "make|model|year" → { ah, cca, is_start_stop, cachedAt }
const oemCache = new Map();
const OEM_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

setInterval(() => {
  const cutoff = Date.now() - OEM_CACHE_TTL_MS;
  for (const [key, entry] of oemCache) {
    if (entry.cachedAt < cutoff) oemCache.delete(key);
  }
}, 60 * 60 * 1000); // sweep hourly

async function findOEMBatterySpecs(make, model, year, cc) {
  const vehicleDesc = `${year ? year + ' ' : ''}${make} ${model}${cc ? ` ${cc}cc` : ''}`;
  const jsonSpec    = '{"ah":<number>,"cca":<number>,"is_start_stop":<true|false>}';
  const cacheKey    = `${make}|${model}|${year || ''}`.toLowerCase();

  // Check cache first
  const cached = oemCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < OEM_CACHE_TTL_MS) {
    console.log(`[OEM] Cache hit: ${vehicleDesc}`);
    return { ah: cached.ah, cca: cached.cca, is_start_stop: cached.is_start_stop };
  }

  // Try Sonnet built-in knowledge first (~2-4s, no web search needed for most SA vehicles)
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,
      messages: [{
        role: 'user',
        content: `OEM battery specs for ${vehicleDesc}. Does it have Start/Stop? JSON only: ${jsonSpec} or {"error":"not_found"}.`,
      }],
    });
    const text   = response.content.find(b => b.type === 'text')?.text || '';
    const result = parseSpecsJson(text);
    if (result) {
      console.log(`[OEM] Knowledge hit: ${vehicleDesc} → ${JSON.stringify(result)}`);
      oemCache.set(cacheKey, { ...result, cachedAt: Date.now() });
      return result;
    }
  } catch (err) {
    console.error('[OEM] Knowledge error:', err.message);
  }

  // Fallback: web search (for obscure or very new models not in Sonnet's training data)
  // web_search_20250305 is a server-side built-in tool — one API call handles search + answer
  console.log(`[OEM] Knowledge miss — falling back to web search for ${vehicleDesc}`);
  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for the original OEM battery specifications for a ${vehicleDesc}. Find the Ah (amp-hour) rating, CCA (cold cranking amps, SAE standard), and whether this vehicle has a Start/Stop (idle-stop) system that requires an AGM battery. After searching, reply ONLY with JSON: ${jsonSpec} or {"error":"not_found"}.`,
      }],
    });
    const text   = response.content.find(b => b.type === 'text')?.text || '';
    const result = parseSpecsJson(text);
    if (result) {
      oemCache.set(cacheKey, { ...result, cachedAt: Date.now() });
      return result;
    }
  } catch (err) {
    console.error('[OEM] Web search error:', err.message);
  }

  return null;
}

module.exports = { readLicenceDisc, readBatteryLabel, findOEMBatterySpecs, getLastImage };
