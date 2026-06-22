const crypto = require('crypto');
const twilio  = require('twilio');

// --- Rate limiting ---
const RATE_LIMIT_MAX    = parseInt(process.env.RATE_LIMIT_MAX    || '15',    10); // messages
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10); // ms
const rateLimits = new Map();

// Clean up stale entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimits) {
    if (now > entry.resetAt) rateLimits.delete(key);
  }
}, 10 * 60 * 1000);

function checkRateLimit(id) {
  const now   = Date.now();
  const entry = rateLimits.get(id);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(id, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

// --- Twilio webhook signature validation ---
function validateTwilioSignature(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return true; // skip if unconfigured (dev mode)

  const sig = req.headers['x-twilio-signature'];
  if (!sig) return false;

  // Build the URL exactly as Twilio signed it
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host  = req.headers['x-forwarded-host']  || req.headers['host'];
  const url   = process.env.TWILIO_WEBHOOK_URL   || `${proto}://${host}/webhook`;

  return twilio.validateRequest(authToken, sig, url, req.body || {});
}

// --- Meta / WhatsApp Cloud API signature validation ---
function validateMetaSignature(req) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return true; // skip if unconfigured

  const sig = req.headers['x-hub-signature-256'];
  if (!sig) return false;

  const raw = req.rawBody;
  if (!raw) return false;

  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(raw).digest('hex');

  try {
    // Buffers must be same length for timingSafeEqual
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// --- Admin endpoint auth ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'battery123';

function checkAdminAuth(req) {
  // Accept ?pw= query param or Authorization: Bearer <token>
  const provided = req.query.pw
    || (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();

  if (!provided) return false;
  try {
    const a = Buffer.from(ADMIN_PASSWORD);
    const b = Buffer.from(provided);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

// --- Input sanitisation ---
const MAX_MSG_LENGTH = parseInt(process.env.MAX_MSG_LENGTH || '800', 10);

function sanitiseInput(text) {
  if (!text || typeof text !== 'string') return '';
  // Strip null bytes and non-printable control chars (keep newlines/tabs)
  return text.replace(/\0/g, '').replace(/[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

function isInputTooLong(text) {
  return text && text.length > MAX_MSG_LENGTH;
}

module.exports = {
  checkRateLimit,
  validateTwilioSignature,
  validateMetaSignature,
  checkAdminAuth,
  sanitiseInput,
  isInputTooLong,
  ADMIN_PASSWORD,
};
