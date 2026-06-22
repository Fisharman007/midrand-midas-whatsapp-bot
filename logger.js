// Conversation logger — stores recent turns in memory and emits structured JSON to console.
// Railway captures all stdout so logs are searchable in the Railway dashboard.

const MAX_LOG_ENTRIES = 500;

// In-memory ring buffer of recent conversation turns
const logBuffer = [];

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

module.exports = { logTurn, getRecentLogs, getStats };
