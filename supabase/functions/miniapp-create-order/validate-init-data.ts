// ============================================================================
// TELEGRAM MINI APP — INIT DATA VALIDATION (HMAC-SHA256)
// ============================================================================
// CRITICAL: Valida la firma HMAC dell'initData per prevenire impersonificazione
// RFC: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
// ============================================================================

import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

export interface ValidationResult {
  valid: boolean;
  userId?: number;
  userName?: string;
  userFirstName?: string;
  authDate?: number;
  error?: string;
}

/**
 * Valida l'initData di Telegram WebApp usando HMAC-SHA256.
 *
 * Algoritmo:
 * 1. Parse initData (query string)
 * 2. Estrae hash
 * 3. Crea data-check-string (params ordinati alfabeticamente, escluso hash)
 * 4. Calcola secret_key = HMAC-SHA256("WebAppData", bot_token)
 * 5. Calcola hash = HMAC-SHA256(data_check_string, secret_key)
 * 6. Verifica hash === hash_ricevuto
 * 7. Verifica timestamp auth_date (max 24h old)
 *
 * @param initData - La stringa initData da Telegram.WebApp.initData
 * @param botToken - Il token del bot Telegram (TELEGRAM_BOT_TOKEN)
 * @returns ValidationResult con userId se valid=true
 */
export function validateTelegramInitData(
  initData: string,
  botToken: string
): ValidationResult {
  try {
    // 1. Parse initData come URLSearchParams (query string)
    const params = new URLSearchParams(initData);
    const receivedHash = params.get("hash");

    if (!receivedHash) {
      return { valid: false, error: "Missing hash in initData" };
    }

    // 2. Rimuovi hash dai params (non va nel data-check-string)
    params.delete("hash");

    // 3. Crea data-check-string: tutti i params ordinati alfabeticamente
    // Formato: key1=value1\nkey2=value2\n...
    const entries = Array.from(params.entries());
    entries.sort(([keyA], [keyB]) => keyA.localeCompare(keyB));

    const dataCheckString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join("\n");

    if (dataCheckString.length === 0) {
      return { valid: false, error: "Empty data-check-string (no params)" };
    }

    // 4. Calcola secret_key = HMAC-SHA256("WebAppData", bot_token)
    const secretKey = createHmac("sha256", "WebAppData")
      .update(botToken)
      .digest();

    // 5. Calcola hash = HMAC-SHA256(data_check_string, secret_key)
    const computedHash = createHmac("sha256", secretKey)
      .update(dataCheckString)
      .digest("hex");

    // 6. Verifica hash
    if (computedHash !== receivedHash) {
      return {
        valid: false,
        error: "Invalid HMAC signature (hash mismatch)",
      };
    }

    // 7. Verifica timestamp auth_date (max 24h old)
    const authDateStr = params.get("auth_date");
    if (!authDateStr) {
      return { valid: false, error: "Missing auth_date in initData" };
    }

    const authDate = parseInt(authDateStr, 10);
    const now = Math.floor(Date.now() / 1000);
    const age = now - authDate;

    if (age > 86400) {
      // 24 ore = 86400 secondi
      return {
        valid: false,
        error: `initData expired (age: ${age}s > 24h)`,
        authDate,
      };
    }

    if (age < 0) {
      return {
        valid: false,
        error: "initData from future (auth_date > now)",
        authDate,
      };
    }

    // 8. Estrae userId da campo "user" (JSON encodato)
    const userStr = params.get("user");
    if (!userStr) {
      return { valid: false, error: "Missing user in initData" };
    }

    let user: any;
    try {
      user = JSON.parse(userStr);
    } catch (err) {
      return { valid: false, error: `Invalid user JSON: ${err}` };
    }

    if (!user.id || typeof user.id !== "number") {
      return { valid: false, error: "Missing or invalid user.id" };
    }

    // 9. Successo: validazione OK
    return {
      valid: true,
      userId: user.id,
      userName: user.username || undefined,
      userFirstName: user.first_name || undefined,
      authDate,
    };
  } catch (err) {
    return {
      valid: false,
      error: `Validation exception: ${(err as Error).message}`,
    };
  }
}

/**
 * Helper per logging sicuro (censura hash/token)
 */
export function safeLogInitData(initData: string): string {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (hash) {
    params.set("hash", `${hash.slice(0, 8)}...`);
  }
  return params.toString();
}
