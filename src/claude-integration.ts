// ============================================================================
// DLOOP TELEGRAM BOT - CLAUDE AI INTEGRATION
// ============================================================================
// Customer support AI responses using Claude Haiku for cost-effective responses
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { CONFIG } from "./config";

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────

interface AIResponseOptions {
  userMessage: string;
  chatId: number;
  userId?: number;
}

// ─────────────────────────────────────────────────────────────────────────
// INITIALIZE ANTHROPIC CLIENT
// ─────────────────────────────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({
      apiKey: CONFIG.anthropic.apiKey,
    });
  }
  return anthropicClient;
}

// ─────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT FOR CUSTOMER SUPPORT
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a helpful customer support assistant for Dloop, a delivery service that connects local merchants (dealers) with customers via Telegram.

Your role:
- Answer questions about how the Dloop service works
- Explain the order process to customers
- Provide information about payment, delivery, and pricing
- Direct users to the /start_order command when they want to create an order

Capabilities:
- Answer questions about the service in a friendly and professional manner
- Explain how to use the bot
- Provide general information about delivery services

Constraints:
- Always respond in Italian
- Keep responses concise (2-3 sentences for simple questions, up to 4-5 sentences for complex questions)
- Be friendly and professional
- Don't make promises about specific delivery times or pricing beyond what's mentioned
- Suggest /start_order when appropriate for customers wanting to place orders
- Don't provide technical support for issues beyond the scope of using the bot

Example conversation flow:
- User: "Come funziona il servizio?"
- You: "Il nostro servizio permette di ordinare prodotti dai negozi locali con consegna a domicilio. Per creare un ordine, usa il comando /start_order e segui i passaggi. Il pagamento avviene tramite Stripe dopo la conferma del negoziante."`;

// ─────────────────────────────────────────────────────────────────────────
// GET AI RESPONSE
// ─────────────────────────────────────────────────────────────────────────

export async function getAIResponse(
  options: AIResponseOptions
): Promise<string> {
  const { userMessage, chatId, userId } = options;

  try {
    // Check if API key is configured
    if (!CONFIG.anthropic.apiKey) {
      console.warn(
        "⚠️ ANTHROPIC_API_KEY not configured, returning fallback message"
      );
      return "Mi dispiace, il servizio di supporto AI non è disponibile al momento. Usa /start_order per creare un ordine.";
    }

    const client = getAnthropicClient();

    // Call Claude Haiku for cost-effective response
    console.log(`🤖 Calling Claude AI for chat ${chatId}...`);
    const message = await client.messages.create({
      model: "claude-haiku-4.5",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userMessage,
        },
      ],
    });
    console.log(`✅ Claude responded successfully`);

    // Extract text response
    const response = message.content[0];
    if (response.type === "text") {
      const aiText = response.text;
      console.log(`✅ AI response generated for chat ${chatId}`);
      console.log(
        `📊 Tokens used - Input: ${message.usage.input_tokens}, Output: ${message.usage.output_tokens}`
      );
      return aiText;
    }

    // Fallback if unexpected response type
    console.warn("⚠️ Unexpected response type from Claude");
    return "Mi dispiace, non riesco a rispondere ora. Usa /start_order per creare un ordine.";
  } catch (error: unknown) {
    // Handle various error types
    console.error(`❌ Error in getAIResponse:`, error);
    if (error instanceof Anthropic.APIError) {
      console.error(`❌ Anthropic API Error:`, {
        status: error.status,
        message: error.message,
        error: error,
      });

      // Handle specific API errors
      if (error.status === 401) {
        return "Mi dispiace, c'è un problema con la configurazione del servizio. Contatta l'amministratore.";
      } else if (error.status === 429) {
        return "Il servizio è al momento sovraccarico. Riprova tra pochi secondi.";
      } else if (error.status === 500) {
        return "Il servizio di supporto è temporaneamente indisponibile. Riprova tra pochi secondi.";
      }
    } else {
      console.error(
        `❌ Unexpected error in getAIResponse:`,
        error instanceof Error ? error.message : String(error)
      );
    }

    // Generic fallback message
    return "Mi dispiace, non riesco a rispondere ora. Usa /start_order per creare un ordine.";
  }
}
