// DLOOP SAAS - CUSTOMER LINK FLOW
// Merchant tap -> genera link -> cliente compila

import { Bot, Context } from "../deps.ts";
import { getSupabaseClient } from "../shared/supabase.ts";
import { CONFIG, CONSTANTS } from "../shared/config.ts";
import { PackageSize, Merchant } from "../shared/types.ts";

export function registerCustomerLinkHandlers(bot: Bot) {
  bot.command("ordine", handleOrdine);
  bot.command("impostazioni", handleImpostazioni);

  bot.callbackQuery(/^pkg_(S|M|L|XL)$/, handlePackageSizeCallback);
  bot.callbackQuery("pkg_count", handlePackageCountCallback);
  bot.callbackQuery("pkg_fragile", handlePackageFragileCallback);
  bot.callbackQuery("gen_link", handleGenerateLinkCallback);

  bot.callbackQuery(/^set_pkg_(S|M|L|XL)$/, handleSettingsPackageSize);
  bot.callbackQuery(/^set_pm_(prepaid|delivery_on_completion|cod)$/, handleSettingsPaymentMode);
}

interface OrderDraft {
  merchant_id: string;
  package_size?: PackageSize;
  package_count: number;
  is_fragile: boolean;
}

const draftStore = new Map<number, OrderDraft>();

async function handleOrdine(ctx: Context) {
  console.log("[handleOrdine] Command received from user:", ctx.from!.id);

  const userId = ctx.from!.id;
  const supabase = getSupabaseClient();

  console.log("[handleOrdine] Querying merchant...");
  const { data: merchant, error } = await supabase
    .from(CONSTANTS.TABLE_MERCHANTS)
    .select("id, default_package_size, default_payment_mode, pickup_address")
    .eq("telegram_user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[handleOrdine] DB error:", error);
  }
  console.log("[handleOrdine] Merchant found:", !!merchant);

  if (!merchant) {
    console.log("[handleOrdine] User not registered as merchant");
    await ctx.reply("Non sei registrato come merchant. Contatta admin.");
    return;
  }

  console.log("[handleOrdine] Merchant ID:", merchant.id);

  const draft: OrderDraft = {
    merchant_id: merchant.id,
    package_size: merchant.default_package_size || undefined,
    package_count: 1,
    is_fragile: false,
  };

  draftStore.set(userId, draft);

  await showPackageSelection(ctx, draft);
}

async function showPackageSelection(ctx: Context, draft: OrderDraft) {
  const sizes: PackageSize[] = ["S", "M", "L", "XL"];
  const pkgInfo = CONSTANTS.PACKAGE_SIZE;

  const legend = sizes.map((s) => `${pkgInfo[s].label}: ${pkgInfo[s].desc}`).join("\n");

  const keyboard = [
    sizes.map((s) => ({
      text: draft.package_size === s ? `✅ ${s}` : s,
      callback_data: `pkg_${s}`,
    })),
    [
      { text: `Colli: ${draft.package_count}`, callback_data: "pkg_count" },
      { text: draft.is_fragile ? "🔴 Fragile" : "Fragile", callback_data: "pkg_fragile" },
    ],
  ];

  if (draft.package_size) {
    keyboard.push([{ text: "🔗 Genera Link Cliente", callback_data: "gen_link" }]);
  }

  const message = `📦 ORDINE RAPIDO

${legend}

Seleziona taglia pacco:`;

  try {
    if (ctx.callbackQuery) {
      await ctx.editMessageText(message, {
        reply_markup: { inline_keyboard: keyboard },
      });
    } else {
      await ctx.reply(message, {
        reply_markup: { inline_keyboard: keyboard },
      });
    }
  } catch (e) {
    console.error("showPackageSelection error:", e);
  }
}

async function handlePackageSizeCallback(ctx: Context) {
  const userId = ctx.from!.id;
  const size = (ctx.match as RegExpMatchArray)[1] as PackageSize;

  const draft = draftStore.get(userId);
  if (!draft) {
    await ctx.answerCallbackQuery({ text: "Sessione scaduta. Usa /ordine", show_alert: true });
    return;
  }

  draft.package_size = size;
  await ctx.answerCallbackQuery({ text: `Taglia: ${size}` });
  await showPackageSelection(ctx, draft);
}

async function handlePackageCountCallback(ctx: Context) {
  const userId = ctx.from!.id;
  const draft = draftStore.get(userId);
  if (!draft) {
    await ctx.answerCallbackQuery({ text: "Sessione scaduta", show_alert: true });
    return;
  }

  draft.package_count = draft.package_count >= 4 ? 1 : draft.package_count + 1;
  await ctx.answerCallbackQuery({ text: `Colli: ${draft.package_count}` });
  await showPackageSelection(ctx, draft);
}

async function handlePackageFragileCallback(ctx: Context) {
  const userId = ctx.from!.id;
  const draft = draftStore.get(userId);
  if (!draft) {
    await ctx.answerCallbackQuery({ text: "Sessione scaduta", show_alert: true });
    return;
  }

  draft.is_fragile = !draft.is_fragile;
  await ctx.answerCallbackQuery({ text: draft.is_fragile ? "Fragile: SI" : "Fragile: NO" });
  await showPackageSelection(ctx, draft);
}

async function handleGenerateLinkCallback(ctx: Context) {
  const userId = ctx.from!.id;
  const draft = draftStore.get(userId);

  if (!draft || !draft.package_size) {
    await ctx.answerCallbackQuery({ text: "Seleziona taglia pacco", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({ text: "Generazione link..." });

  try {
    const supabase = getSupabaseClient();

    const token = generateToken();
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const { data: merchant } = await supabase
      .from(CONSTANTS.TABLE_MERCHANTS)
      .select("pickup_address, default_payment_mode")
      .eq("id", draft.merchant_id)
      .single();

    const { error } = await supabase.from(CONSTANTS.TABLE_ORDERS).insert({
      merchant_id: draft.merchant_id,
      pickup_point: merchant?.pickup_address || "",
      delivery_address: "",
      recipient_name: "",
      recipient_phone: "",
      payment_mode: merchant?.default_payment_mode || "delivery_on_completion",
      source: "telegram_link",
      status: "pending",
      package_size: draft.package_size,
      package_count: draft.package_count,
      is_fragile: draft.is_fragile,
      customer_token: token,
      token_expires_at: expiresAt.toISOString(),
    });

    if (error) throw error;

    const link = `${CONFIG.customerLink.baseUrl}/c/${token}`;

    await ctx.editMessageText(
      `✅ LINK GENERATO

Copia e invia al cliente:

${link}

Scadenza: 24 ore
📦 ${CONSTANTS.PACKAGE_SIZE[draft.package_size].label}${draft.package_count > 1 ? ` · ${draft.package_count} colli` : ""}${draft.is_fragile ? " · 🔴 Fragile" : ""}`,
      { reply_markup: { inline_keyboard: [] } }
    );

    draftStore.delete(userId);
  } catch (err) {
    console.error("handleGenerateLinkCallback error:", err);
    await ctx.reply(`Errore generazione link: ${(err as Error).message}`);
  }
}

function generateToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 8; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

async function handleImpostazioni(ctx: Context) {
  const userId = ctx.from!.id;
  const supabase = getSupabaseClient();

  const { data: merchant } = await supabase
    .from(CONSTANTS.TABLE_MERCHANTS)
    .select("id, default_package_size, default_payment_mode, pickup_address")
    .eq("telegram_user_id", userId)
    .maybeSingle();

  if (!merchant) {
    await ctx.reply("Non sei registrato come merchant.");
    return;
  }

  const pkgSize = merchant.default_package_size || "Non configurato";
  const paymentMode = merchant.default_payment_mode || "delivery_on_completion";

  const paymentLabels = {
    prepaid: "Prepagato",
    delivery_on_completion: "Cliente paga al rider",
    cod: "Contrassegno",
  };

  const message = `⚙️ IMPOSTAZIONI

📦 Taglia default: ${pkgSize !== "Non configurato" ? CONSTANTS.PACKAGE_SIZE[pkgSize as PackageSize].label : pkgSize}
💳 Pagamento default: ${paymentLabels[paymentMode as keyof typeof paymentLabels]}

Questi valori vengono pre-selezionati in /ordine.`;

  await ctx.reply(message, {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "S", callback_data: "set_pkg_S" },
          { text: "M", callback_data: "set_pkg_M" },
          { text: "L", callback_data: "set_pkg_L" },
          { text: "XL", callback_data: "set_pkg_XL" },
        ],
        [
          { text: "Cliente paga rider", callback_data: "set_pm_delivery_on_completion" },
          { text: "Contrassegno", callback_data: "set_pm_cod" },
        ],
      ],
    },
  });
}

async function handleSettingsPackageSize(ctx: Context) {
  const userId = ctx.from!.id;
  const size = (ctx.match as RegExpMatchArray)[1] as PackageSize;
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from(CONSTANTS.TABLE_MERCHANTS)
    .update({ default_package_size: size })
    .eq("telegram_user_id", userId);

  if (error) {
    await ctx.answerCallbackQuery({ text: "Errore aggiornamento", show_alert: true });
    return;
  }

  await ctx.answerCallbackQuery({ text: `Taglia default: ${size}` });
  await ctx.editMessageText(`✅ Taglia default aggiornata: ${CONSTANTS.PACKAGE_SIZE[size].label}`);
}

async function handleSettingsPaymentMode(ctx: Context) {
  const userId = ctx.from!.id;
  const mode = (ctx.match as RegExpMatchArray)[1];
  const supabase = getSupabaseClient();

  const { error } = await supabase
    .from(CONSTANTS.TABLE_MERCHANTS)
    .update({ default_payment_mode: mode })
    .eq("telegram_user_id", userId);

  if (error) {
    await ctx.answerCallbackQuery({ text: "Errore aggiornamento", show_alert: true });
    return;
  }

  const labels = {
    prepaid: "Prepagato",
    delivery_on_completion: "Cliente paga al rider",
    cod: "Contrassegno",
  };

  await ctx.answerCallbackQuery({ text: `Pagamento: ${labels[mode as keyof typeof labels]}` });
  await ctx.editMessageText(`✅ Pagamento default: ${labels[mode as keyof typeof labels]}`);
}
