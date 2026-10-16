// Conversation logger — stores recent turns in memory and emits structured JSON to console.
// Railway captures all stdout so logs are searchable in the Railway dashboard.

const axios = require('axios');

const MAX_LOG_ENTRIES = 500;

// In-memory ring buffer of recent conversation turns
const logBuffer = [];

// In-memory ring buffer of leads (parts quotes, etc.) — kept separate from
// logBuffer because leads need the customer's FULL number for follow-up,
// unlike the masked general chat log.
const leadBuffer = [];

function maskPhone(from) {
  if (!from || from.length < 4) return '****';
  return '****' + from.slice(-4);
}

function logTurn({ from, profileName, userMessage, botReply, toolsUsed, inputTokens, outputTokens, durationMs, conversationTurn }) {
  const entry = {
    ts:         new Date().toISOString(),
    from:       maskPhone(from),
    profile:    profileName || '',
    turn:       conversationTurn || 1,
    user:       userMessage,
    bot:        botReply,
    tools:      toolsUsed || [],
    tokens_in:  inputTokens  || 0,
    tokens_out: outputTokens || 0,
    duration_ms: durationMs  || 0,
  };

  // Append to ring buffer
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) logBuffer.shift();

  // Structured JSON to stdout — captured by Railway logs
  console.log('[CONV]', JSON.stringify(entry));
}

function getRecentLogs(limit = 100) {
  return logBuffer.slice(-limit).reverse();
}

function logLead({ from, profileName, type, request }) {
  const entry = {
    ts:      new Date().toISOString(),
    from,    // full number, intentionally unmasked — staff need it to follow up
    profile: profileName || '',
    type:    type || 'general',
    request,
  };

  leadBuffer.push(entry);
  if (leadBuffer.length > MAX_LOG_ENTRIES) leadBuffer.shift();

  console.log('[LEAD]', JSON.stringify(entry));

  // Best-effort durable copy — a Google Sheet survives server restarts/redeploys,
  // unlike leadBuffer above. Fire-and-forget: never let a Sheets hiccup slow down
  // or break the customer's WhatsApp reply.
  const sheetUrl = process.env.LEADS_SHEET_WEBHOOK_URL;
  if (sheetUrl) {
    axios.post(sheetUrl, entry, { timeout: 8000 })
      .catch(err => console.error('[LEAD] Failed to sync to Google Sheet:', err.message));
  }
}

function getRecentLeads(limit = 100) {
  return leadBuffer.slice(-limit).reverse();
}

function getStats() {
  const total = logBuffer.length;
  if (total === 0) return { total: 0 };

  const toolCounts = {};
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  const uniqueUsers = new Set();

  for (const e of logBuffer) {
    totalTokensIn  += e.tokens_in;
    totalTokensOut += e.tokens_out;
    uniqueUsers.add(e.from);
    for (const t of e.tools) {
      toolCounts[t] = (toolCounts[t] || 0) + 1;
    }
  }

  return {
    total_turns:     total,
    unique_users:    uniqueUsers.size,
    total_tokens_in: totalTokensIn,
    total_tokens_out: totalTokensOut,
    tool_usage:      toolCounts,
    oldest:          logBuffer[0]?.ts,
    newest:          logBuffer[logBuffer.length - 1]?.ts,
  };
}

module.exports = { logTurn, getRecentLogs, getStats, logLead, getRecentLeads };
