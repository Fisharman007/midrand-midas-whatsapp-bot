const { getUniqueMakes, findBySKU } = require('./catalogue');
const { readLicenceDisc, readBatteryLabel } = require('./ai');
const { updateSession, clearSession } = require('./sessions');

function buildMakePickerMessage() {
  const makes = getUniqueMakes();
  const lines = makes.map((m, i) => `${String(i + 1).padEnd(2)} - ${m}`);
  lines.push(`${String(makes.length + 1).padEnd(2)} - OTHER`);
  return (
    `📸 *We couldn't read your licence disc clearly.*\n\n` +
    `No worries! Reply with the number of your vehicle make:\n\n` +
    `${lines.join('\n')}\n\n` +
    `Reply with a number 👆`
  );
}

function handlePickMakeNumber(from, msg, session) {
  const makes = getUniqueMakes();
  const total = makes.length + 1;
  const pick  = parseInt(msg.trim(), 10);

  if (isNaN(pick) || pick < 1 || pick > total) {
    return `Please reply with a number between 1 and ${total}.\n\n` + buildMakePickerMessage();
  }

  if (pick === total) {
    clearSession(from);
    return (
      `Please contact us directly and our team will find the right battery for your vehicle.\n\n` +
      `📞 *(010) 746 6260*\n` +
      `💬 *+27 87 250 2643*\n\n` +
      `🕒 Mon–Fri: 08:00–17:30 | Sat: 08:00–14:00\n\n` +
      `_Reply *menu* to start over._`
    );
  }

  const make = makes[pick - 1];
  const seedMsg = `[System: Customer selected vehicle make "${make}" from a numbered list after their licence disc photo couldn't be read. Ask them for their model and year, then search the catalogue.]`;
  const assistantReply = `Got it — *${make}* it is! 🚗\n\nWhat's the *model and year* of your vehicle?\n\n_E.g. Polo 2019, Corolla 2020_`;
  updateSession(from, {
    state: 'AI_CHAT',
    data: { ...session.data, aiHistory: [{ role: 'user', content: seedMsg }, { role: 'assistant', content: assistantReply }] },
  });
  return assistantReply;
}

async function handleLicenceDisc(from, message, session, mediaUrl, mediaId = null) {
  if (!mediaUrl && !mediaId) {
    if (message.trim() === '2') {
      updateSession(from, { state: 'PICK_MAKE_NUMBER', data: { ...session.data } });
      return buildMakePickerMessage();
    }
    return (
      `📸 Please send us a clear photo of your vehicle licence disc so we can find the right battery for you.\n\n` +
      `_Don't have your licence disc? Reply *2* to enter your vehicle details manually._`
    );
  }

  let vehicle;
  try {
    vehicle = await readLicenceDisc(mediaUrl, mediaId);
  } catch (err) {
    console.error('Vision error:', err.message);
    vehicle = null;
  }

  if (vehicle?.retryable) {
    const retries = (session.data.licenceRetries || 0) + 1;
    updateSession(from, { data: { ...session.data, licenceRetries: retries } });
    if (retries >= 2) {
      updateSession(from, { state: 'PICK_MAKE_NUMBER', data: { ...session.data, licenceRetries: 0 } });
      return (
        `Still having trouble reading the disc 😕\n\n` +
        `No worries — let's do it manually instead:\n\n` +
        buildMakePickerMessage()
      );
    }
    return (
      `I couldn't read the disc clearly 😕\n\n` +
      `Please resend the photo as a *document* 📎 _(tap Attach → Document)_ — ` +
      `WhatsApp keeps full quality that way.\n\n` +
      `Or retake it straight-on, filling the frame, avoiding sunlight.`
    );
  }

  if (!vehicle) {
    let batteryLabel = null;
    try {
      batteryLabel = await readBatteryLabel(mediaUrl, mediaId);
    } catch (err) {
      console.error('[BatteryLabel] Read error:', err.message);
    }

    if (batteryLabel?.sku) {
      const rawSku  = batteryLabel.sku.toUpperCase().replace(/^[A-Z]+/, '').replace(/[A-Z]+$/, '');
      const skuKeys = [batteryLabel.sku.toUpperCase(), rawSku, batteryLabel.sku.toUpperCase().replace(/[^0-9AGM]/g, '')].filter(Boolean);

      let catalogueResult = null;
      for (const key of skuKeys) {
        catalogueResult = findBySKU(key);
        if (catalogueResult) break;
      }

      if (catalogueResult?._brands?.length) {
        const labelLine = [
          batteryLabel.brand && `*${batteryLabel.brand}*`,
          batteryLabel.ah    && `${batteryLabel.ah}Ah`,
          batteryLabel.cca   && `${batteryLabel.cca} CCA`,
        ].filter(Boolean).join(' | ');

        const options = catalogueResult._brands.map((b, i) => (
          `*${i + 1}* — ${b.brand} *(${catalogueResult.sku})*\n` +
          `• *R${b.price}* (incl. VAT & trade-in)\n` +
          `• ${b.ahrating}Ah | ${b.warrantyperiod} warranty`
        )).join('\n\n');

        updateSession(from, { state: 'AI_CHAT', data: { ...session.data } });
        return (
          `📸 *Battery label detected!*\n` +
          (labelLine ? `_Scanned: ${labelLine}_\n\n` : '\n') +
          `Here are the matching options for *SKU ${catalogueResult.sku}*:\n\n` +
          `${options}\n\n` +
          `_Prices exclusive to First Battery Woodmead_\n\n` +
          `Which works best for you? I can arrange fitment or delivery 😊`
        );
      }

      updateSession(from, { state: 'AI_CHAT', data: { ...session.data } });
      return (
        `📸 I can see a battery label${batteryLabel.brand ? ` — *${batteryLabel.brand}*` : ''}` +
        `${batteryLabel.sku ? `, SKU *${batteryLabel.sku}*` : ''}` +
        `${batteryLabel.ah ? `, ${batteryLabel.ah}Ah` : ''}.\n\n` +
        `Unfortunately that SKU isn't in our current catalogue. ` +
        `Please call us and our team will source the right replacement:\n\n` +
        `📞 *(010) 746 6260*\n` +
        `🗺️ https://share.google/csvciyYZ7nWOaoYmi`
      );
    }

    updateSession(from, { state: 'AI_CHAT', data: { ...session.data } });
    return (
      `📸 Thanks for the image! I wasn't able to read the vehicle or battery details from it.\n\n` +
      `No worries — just type your *vehicle make, model and year* and I'll find the right battery in seconds. 🔋\n\n` +
      `_Or call us directly:_ 📞 *(010) 746 6260*`
    );
  }

  const BODY_TYPE_WORDS = ['wagon', 'sedan', 'hatchback', 'bakkie', 'pickup', 'truck', 'van',
    'bus', 'suv', 'mpv', 'coupe', 'convertible', 'limousine', 'stasiewa', 'motorfiets',
    'motorcycle', 'tractor', 'trailer'];
  const isBodyTypeOnly = BODY_TYPE_WORDS.some(w => vehicle.model.toLowerCase().includes(w)) &&
    vehicle.model.split(/\s+/).length <= 5;

  if (isBodyTypeOnly) {
    const yearHint       = vehicle.year ? ` (${vehicle.year})` : '';
    const seedMsg        = `[System: Customer sent a licence disc photo. Scanned details — Make: ${vehicle.make}, Body type: ${vehicle.model}${yearHint}. The disc didn't include the specific model name. Ask the customer what model it is, then search the catalogue.]`;
    const assistantReply = `Got it! I scanned your licence disc 📸 and can see it's a *${vehicle.make}* ${vehicle.model.toLowerCase()}${yearHint}.\n\nCould you tell me the specific *model name*? (e.g. Fortuner, Land Cruiser Prado, Hilux, etc.) That'll help me find the exact battery for you. 🔋`;
    updateSession(from, {
      state: 'AI_CHAT',
      data:  { ...session.data, aiHistory: [{ role: 'user', content: seedMsg }, { role: 'assistant', content: assistantReply }] },
    });
    return assistantReply;
  }

  const yearDisplay  = vehicle.year  || 'Unknown';
  const modelDisplay = vehicle.model || 'Unknown';
  const confirmMsg   = (
    `📸 *I scanned your licence disc!* Here's what I found:\n\n` +
    `🚗 *Make:* ${vehicle.make}\n` +
    `🚘 *Model:* ${modelDisplay}\n` +
    `📅 *Year:* ${yearDisplay}\n\n` +
    `Is this correct? Reply *Yes* to find your battery, or let me know any corrections 😊`
  );
  const seedMsg = (
    `[System: Customer sent a licence disc. Extracted details — ` +
    `Make: ${vehicle.make}, Model: ${modelDisplay}, Year: ${yearDisplay}. ` +
    `You have already shown this to the customer and asked them to confirm. ` +
    `If they reply Yes/Correct/Confirm, immediately call search_vehicles and get_prices for this vehicle and present battery options. ` +
    `If they correct any details, use the corrected info to search instead.]`
  );
  updateSession(from, {
    state: 'AI_CHAT',
    data:  { ...session.data, licenceRetries: 0, aiHistory: [{ role: 'user', content: seedMsg }, { role: 'assistant', content: confirmMsg }] },
  });
  return confirmMsg;
}

module.exports = { handleLicenceDisc, handlePickMakeNumber };
