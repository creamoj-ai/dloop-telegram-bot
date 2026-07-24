// ============================================================================
// DLOOP SAAS — TELEGRAM API HELPER (HTTP direct, no Bot instance)
// ============================================================================
// Invia messaggi Telegram via fetch API diretta (per dispatch-service).
// Usato per notificare rider dal webhook merchant senza Bot instance rider.
// ============================================================================

/**
 * Invia messaggio Telegram a un rider usando il bot RIDER.
 * Usa fetch API diretta (no Bot instance).
 */
export async function sendRiderNotification(
  riderTelegramUserId: number,
  message: string,
  inlineKeyboard?: Array<Array<{ text: string; callback_data: string }>>
): Promise<boolean> {
  const TELEGRAM_RIDER_BOT_TOKEN = Deno.env.get("TELEGRAM_RIDER_BOT_TOKEN") || "";

  if (!TELEGRAM_RIDER_BOT_TOKEN) {
    console.error("[telegram-api] TELEGRAM_RIDER_BOT_TOKEN non configurato");
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_RIDER_BOT_TOKEN}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id: riderTelegramUserId,
    text: message,
    parse_mode: "Markdown",
  };

  if (inlineKeyboard) {
    body.reply_markup = {
      inline_keyboard: inlineKeyboard,
    };
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[telegram-api] Error sending message to rider ${riderTelegramUserId}:`, errorText);
      return false;
    }

    console.log(`[telegram-api] Message sent to rider ${riderTelegramUserId}`);
    return true;
  } catch (err) {
    console.error("[telegram-api] Fetch error sending message to rider:", err);
    return false;
  }
}

/**
 * Aggiorna messaggio Telegram esistente (editMessageText).
 * Usato per notificare rider quando ordine è già assegnato.
 */
export async function editRiderMessage(
  riderTelegramUserId: number,
  messageId: number,
  newText: string
): Promise<boolean> {
  const TELEGRAM_RIDER_BOT_TOKEN = Deno.env.get("TELEGRAM_RIDER_BOT_TOKEN") || "";

  if (!TELEGRAM_RIDER_BOT_TOKEN) {
    console.error("[telegram-api] TELEGRAM_RIDER_BOT_TOKEN non configurato");
    return false;
  }

  const url = `https://api.telegram.org/bot${TELEGRAM_RIDER_BOT_TOKEN}/editMessageText`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: riderTelegramUserId,
        message_id: messageId,
        text: newText,
        parse_mode: "Markdown",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[telegram-api] Error editing message for rider ${riderTelegramUserId}:`, errorText);
      return false;
    }

    console.log(`[telegram-api] Message edited for rider ${riderTelegramUserId}`);
    return true;
  } catch (err) {
    console.error("[telegram-api] Fetch error editing message:", err);
    return false;
  }
}
