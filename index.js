require('dotenv').config();
const express = require('express');
const axios   = require('axios');
const { MessagingResponse } = require('twilio').twiml;
const { handleLicenceDisc, handlePickMakeNumber } = require('./imageHandler');
const { runAIConversation } = require('./aiConversation');
const { reloadCatalogue } = require('./catalogue');
const { getSession, updateSession, clearSession } = require('./sessions');
const { getRecentLogs, getStats } = require('./logger');
const { getLastImage } = require('./ai');
const { checkRateLimit, validateTwilioSignature, sanitiseInput, isInputTooLong, checkAdminAuth } = require('./security');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const RESET_TRIGGERS = new Set(['menu', 'hi', 'hello', 'hey', 'start', 'hola', 'howzit']);

function contactCard() {
  const biz = process.env.BUSINESS_NAME || 'First Battery Woodmead';
  return (
    `Need help? Our team is ready for you! 😊\n\n` +
    `📞 *Call us:* 011 312 4743\n` +
    `📍 35 Richard Drive, Halfway House, Midrand\n\n` +
    `🕒 Mon–Fri: 08:00–17:30 | Sat: 08:00–15:00 | Sun: 09:00–13:00\n\n` +
    `_Reply *menu* to start over._`
  );
}

function aiGreeting(name) {
  const n = name ? ` *${name}*` : '';
  return (
    `Hi${n}! 👋 I'm MAC, your Midrand Midas AI Assistant.\n\n` +
    `I can help you find the correct battery for your vehicle and give you an instant quote. 🔋\n\n` +
    `What can I help you with today?\n\n` +
    `_Store details & contact? Reply *0*_`
  );
}

// Load catalogue into memory before the server accepts any requests
console.log('Loading catalogue...');
try {
  reloadCatalogue();
  console.log('Catalogue ready.');
} catch (err) {
  console.error('Failed to load catalogue:', err.message);
  process.exit(1);
}

// Health check — Railway uses this to confirm the app is running
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '3.0.0', timestamp: new Date().toISOString() });
});

// Keep-alive ping — point an uptime monitor (e.g. UptimeRobot) at /ping every 5 mins
app.get('/ping', (req, res) => res.send('pong'));

// --- AI conversation handler (all text messages) ---

async function handleAIMessage(from, message, profileName) {
  const msg     = message.trim().toLowerCase();
  let   session = getSession(from);

  if (profileName && !session.data.profileName) {
    updateSession(from, { data: { ...session.data, profileName } });
    session = getSession(from);
  }
  const name = session.data.profileName || profileName || '';

  // After a failed image read, session lands in PICK_MAKE_NUMBER for numbered make selection
  if (session.state === 'PICK_MAKE_NUMBER') {
    return handlePickMakeNumber(from, msg, session);
  }

  if (msg === '0') {
    return contactCard();
  }

  if (RESET_TRIGGERS.has(msg)) {
    clearSession(from);
    updateSession(from, { state: 'AI_CHAT', data: { profileName: name } });
    return aiGreeting(name);
  }

  const history = session.data.aiHistory || [];
  const { reply, history: newHistory } = await runAIConversation(from, message, history, name);

  updateSession(from, { state: 'AI_CHAT', data: { ...session.data, aiHistory: newHistory } });
  return reply;
}

// --- Twilio WhatsApp webhook ---

app.post('/webhook', async (req, res) => {
  const from = req.body.From;
  if (!from) return res.status(400).send('Missing From field');

  if (process.env.NODE_ENV === 'production' && !validateTwilioSignature(req)) {
    return res.status(403).send('Forbidden');
  }

  if (!checkRateLimit(from)) {
    const twiml = new MessagingResponse();
    twiml.message('Too many messages. Please wait a moment before trying again.');
    res.type('text/xml');
    return res.send(twiml.toString());
  }

  try {
    const incomingMsg = sanitiseInput((req.body.Body || '').trim());
    const profileName = sanitiseInput((req.body.ProfileName || '').trim());

    if (isInputTooLong(incomingMsg)) {
      const twiml = new MessagingResponse();
      twiml.message('Your message is too long. Please keep it under 800 characters.');
      res.type('text/xml');
      return res.send(twiml.toString());
    }
    const mediaUrl    = parseInt(req.body.NumMedia, 10) > 0 ? req.body.MediaUrl0 : null;

    let responseText;

    if (mediaUrl) {
      responseText = await handleLicenceDisc(from, incomingMsg, getSession(from), mediaUrl, null);
    } else {
      responseText = await handleAIMessage(from, incomingMsg, profileName);
    }

    const twiml = new MessagingResponse();
    if (responseText) twiml.message(responseText);
    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    console.error('Webhook error:', err);
    const twiml = new MessagingResponse();
    twiml.message('Sorry, something went wrong. Please try again in a moment.');
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// --- WhatsApp Cloud API (Meta) webhook ---

async function sendWhatsAppReply(phoneNumberId, to, text) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
    { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } },
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
}

// Webhook verification
app.get('/wa-webhook', (req, res) => {
  if (
    req.query['hub.mode']         === 'subscribe' &&
    req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    res.status(200).send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

// Incoming messages — Meta always requires an immediate 200 OK
app.post('/wa-webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const value   = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];
    if (!message) return;

    const from          = message.from;
    const phoneNumberId = value?.metadata?.phone_number_id;
    const profileName   = value?.contacts?.[0]?.profile?.name || '';

    let responseText;

    if (message.type === 'image') {
      const mediaId = message.image?.id;
      responseText  = await handleLicenceDisc(from, '', getSession(from), null, mediaId);
    } else if (message.type === 'text') {
      responseText = await handleAIMessage(from, message.text?.body || '', profileName);
    }

    if (responseText && phoneNumberId) {
      await sendWhatsAppReply(phoneNumberId, from, responseText);
    }
  } catch (err) {
    console.error('[WhatsApp] Webhook error:', err.message);
  }
});

// --- Admin: last received image viewer (debug) ---
app.get('/admin/last-image', (req, res) => {
  if (!checkAdminAuth(req)) {
    return res.status(401).send('Unauthorised — add ?pw=YOUR_PASSWORD');
  }
  const img = getLastImage();
  if (!img) {
    return res.status(404).send('No image received yet. Send a WhatsApp image to the bot first.');
  }
  const buf = Buffer.from(img.base64, 'base64');
  res.setHeader('Content-Type', img.contentType);
  res.setHeader('X-Image-URL', img.url);
  res.setHeader('X-Captured-At', img.ts);
  res.send(buf);
});

// --- Admin: conversation logs viewer ---
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'battery123';

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

app.get('/admin/logs', (req, res) => {
  if (!checkAdminAuth(req)) {
    return res.status(401).send('Unauthorised — add ?pw=YOUR_PASSWORD');
  }

  const limit  = Math.min(parseInt(req.query.limit || '50', 10), 500);
  const logs   = getRecentLogs(limit);
  const stats  = getStats();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Conversation Logs</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:960px;margin:0 auto;padding:16px;background:#f5f5f5}
    h1{font-size:1.4rem;margin-bottom:8px}
    .stats{background:#fff;border-radius:8px;padding:12px 16px;margin-bottom:16px;display:flex;gap:24px;flex-wrap:wrap;font-size:.9rem}
    .stat{text-align:center}.stat b{display:block;font-size:1.4rem;color:#1a73e8}
    .card{background:#fff;border-radius:8px;padding:12px 16px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
    .meta{font-size:.75rem;color:#666;margin-bottom:6px;display:flex;gap:12px;flex-wrap:wrap}
    .tag{background:#e8f0fe;color:#1a73e8;border-radius:4px;padding:2px 6px;font-size:.72rem}
    .tag.tool{background:#fce8d8;color:#c05a00}
    .bubble-u{background:#e8f0fe;border-radius:12px 12px 12px 0;padding:8px 12px;margin:4px 0;display:inline-block;max-width:90%;white-space:pre-wrap;font-size:.9rem}
    .bubble-b{background:#f1f3f4;border-radius:12px 12px 0 12px;padding:8px 12px;margin:4px 0 4px 20px;display:inline-block;max-width:90%;white-space:pre-wrap;font-size:.9rem}
    .row{display:block}
  </style>
</head>
<body>
<h1>🔋 Conversation Logs</h1>
<div class="stats">
  <div class="stat"><b>${stats.total_turns || 0}</b>turns</div>
  <div class="stat"><b>${stats.unique_users || 0}</b>users</div>
  <div class="stat"><b>${stats.total_tokens_in || 0}</b>tokens in</div>
  <div class="stat"><b>${stats.total_tokens_out || 0}</b>tokens out</div>
  <div class="stat"><b>${Object.entries(stats.tool_usage || {}).map(([k,v])=>`${escHtml(k)}:${escHtml(String(v))}`).join(' ') || '—'}</b>tools</div>
</div>
${logs.map(e => `
<div class="card">
  <div class="meta">
    <span>${escHtml(e.ts)}</span>
    <span class="tag">${escHtml(e.from)}${e.profile ? ' · ' + escHtml(e.profile) : ''}</span>
    <span>turn ${escHtml(String(e.turn))}</span>
    <span>${escHtml(String(e.duration_ms))}ms · ${escHtml(String(e.tokens_in))}↑ ${escHtml(String(e.tokens_out))}↓</span>
    ${(e.tools || []).map(t=>`<span class="tag tool">${escHtml(t)}</span>`).join('')}
  </div>
  <div class="row"><div class="bubble-u">${escHtml(e.user)}</div></div>
  <div class="row"><div class="bubble-b">${escHtml(e.bot)}</div></div>
</div>`).join('')}
</body></html>`);
});

app.listen(PORT, () => {
  console.log(`Midrand Midas WhatsApp Bot running on port ${PORT}`);
});
