// ============================================================================
// ORDER PARSER - Parse natural language orders with Claude Haiku
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config";

interface ParsedOrder {
  is_order: boolean;
  customer: {
    name?: string;
    phone?: string;
  };
  delivery: {
    street?: string;
    number?: string;
    city?: string;
    extra?: string;
  };
  items: Array<{
    product: string;
    quantity: number;
    notes?: string;
  }>;
  missing_fields: string[];
}

const client = new Anthropic({
  apiKey: CONFIG.anthropic.apiKey,
});

export async function parseOrder(text: string): Promise<ParsedOrder | null> {
  try {
    const prompt = `Sei un parser di ordini di cibo in italiano. Analizza questo testo e estrai i dati.

TESTO: "${text}"

Rispondi in JSON con:
{"is_order": true/false, "customer": {"name": ..., "phone": ...}, "delivery": {"street": ..., "number": ..., "city": ..., "extra": ...}, "items": [{"product": ..., "quantity": ..., "notes": ...}]}

Se NON è un ordine, rispondi: {"is_order": false}
Rispondi SOLO con JSON valido.`;

    const message = await client.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 500,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = message.content[0].type === "text" ? message.content[0].text : "";
    
    let jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/) || responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);

    if (!parsed.is_order) {
      return { is_order: false, customer: {}, delivery: {}, items: [], missing_fields: [] };
    }

    const missing_fields: string[] = [];
    if (!parsed.customer?.name) missing_fields.push("customer.name");
    if (!parsed.customer?.phone) missing_fields.push("customer.phone");
    if (!parsed.delivery?.street) missing_fields.push("delivery.street");
    if (!parsed.delivery?.number) missing_fields.push("delivery.number");
    if (!parsed.delivery?.city) missing_fields.push("delivery.city");
    if (!parsed.items?.length) missing_fields.push("items");

    return {
      is_order: true,
      customer: { name: parsed.customer?.name, phone: parsed.customer?.phone },
      delivery: {
        street: parsed.delivery?.street,
        number: parsed.delivery?.number,
        city: parsed.delivery?.city,
        extra: parsed.delivery?.extra,
      },
      items: (parsed.items || []).map((i: any) => ({
        product: i.product || "articolo",
        quantity: i.quantity || 1,
        notes: i.notes,
      })),
      missing_fields,
    };
  } catch (err) {
    console.error("[parseOrder]", err);
    return null;
  }
}
