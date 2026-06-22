const axios    = require('axios');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function readLicenceDiscByMediaId(mediaId, mimeType = 'image/jpeg') {
  console.log(`[LicenceDisc] Step 1 - Getting media URL for ID: ${mediaId}`);

  // Get authenticated download URL from WhatsApp Graph API
  const urlRes = await axios.get(
    `https://graph.facebook.com/v18.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
  const mediaUrl = urlRes.data?.url;
  if (!mediaUrl) throw new Error('No URL returned from WhatsApp media endpoint');
  console.log('[LicenceDisc] Step 2 - Media URL retrieved');

  // Download image bytes — MUST use Authorization header AND arraybuffer
  const imageRes = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer',
  });
  const base64Image  = Buffer.from(imageRes.data).toString('base64');
  const detectedMime = imageRes.headers['content-type'] || mimeType;
  console.log(`[LicenceDisc] Step 3 - Image downloaded, size: ${imageRes.data.byteLength} bytes`);

  // Send to Claude vision
  const claudeRes = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: { type: 'base64', media_type: detectedMime, data: base64Image },
        },
        {
          type: 'text',
          text: `This is a South African vehicle licence disc. Extract all visible information and return ONLY a valid JSON object with these exact keys:
{
  "registrationNumber": "",
  "make": "",
  "model": "",
  "year": "",
  "colour": "",
  "fuelType": "",
  "engineNumber": "",
  "vinNumber": "",
  "expiryDate": "",
  "tare": "",
  "grossVehicleMass": ""
}
Use empty string for any field not visible. Return JSON only — no markdown, no explanation.`,
        },
      ],
    }],
  });

  const rawText = claudeRes.content
    .map(b => b.type === 'text' ? b.text : '')
    .join('')
    .trim()
    .replace(/```json|```/g, '')
    .trim();

  console.log(`[LicenceDisc] Step 4 - Claude raw response: ${rawText}`);
  return JSON.parse(rawText);
}

async function readBatteryLabelByMediaId(mediaId, mimeType = 'image/jpeg') {
  console.log(`[BatteryLabel] Getting media URL for ID: ${mediaId}`);

  const urlRes = await axios.get(
    `https://graph.facebook.com/v18.0/${mediaId}`,
    { headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` } }
  );
  const mediaUrl = urlRes.data?.url;
  if (!mediaUrl) throw new Error('No URL returned from WhatsApp media endpoint');

  const imageRes = await axios.get(mediaUrl, {
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` },
    responseType: 'arraybuffer',
  });
  const base64Image  = Buffer.from(imageRes.data).toString('base64');
  const detectedMime = imageRes.headers['content-type'] || mimeType;
  console.log(`[BatteryLabel] Image downloaded, size: ${imageRes.data.byteLength} bytes`);

  const claudeRes = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: detectedMime, data: base64Image } },
        {
          type: 'text',
          text: `This is a car battery label. Extract the following and return ONLY valid JSON:
{
  "sku": "",
  "brand": "",
  "ah": "",
  "voltage": "",
  "cca": ""
}
SKU is the battery part/model number (e.g. "646", "668", "NS70", "DIN88", "F668P"). Use empty string for any field not visible. If this is not a battery label, return: {"error":"not_a_battery"}. Return JSON only — no markdown, no explanation.`,
        },
      ],
    }],
  });

  const rawText = claudeRes.content
    .map(b => b.type === 'text' ? b.text : '')
    .join('')
    .trim()
    .replace(/```json|```/g, '')
    .trim();

  console.log(`[BatteryLabel] Claude raw response: ${rawText}`);
  return JSON.parse(rawText);
}

async function readLicenceDiscFromWhatsApp(webhookBody) {
  try {
    const message = webhookBody?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message)                  throw new Error('No message in webhook');
    if (message.type !== 'image')  throw new Error(`Expected image, got: ${message.type}`);

    const mediaId  = message.image?.id;
    const mimeType = message.image?.mime_type || 'image/jpeg';
    if (!mediaId) throw new Error('No media_id in image message');

    const data = await readLicenceDiscByMediaId(mediaId, mimeType);
    return { success: true, data };
  } catch (err) {
    console.error('[LicenceDisc] ERROR:', err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { readLicenceDiscFromWhatsApp, readLicenceDiscByMediaId, readBatteryLabelByMediaId };
