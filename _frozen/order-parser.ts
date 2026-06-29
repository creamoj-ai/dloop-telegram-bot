// ============================================================================
// ORDER PARSER - Multi-Category Parse Engine for Claude Haiku
// ============================================================================
// Enhanced to support 6 category verticals (FOOD, ABBIGLIAMENTO, GROCERY,
// PET, FARMACIE, CASA) with category-aware prompts, validation, and
// few-shot examples.
//
// ARCHITECTURE:
//   1. detectOrderCategory(text, dealerId) -- resolve category
//   2. buildCategoryContext(category, dealerId) -- load catalog + examples
//   3. generateCategoryPrompt(category, context) -- build dynamic prompt
//   4. parseOrder(text, dealerId, context) -- main parse with Haiku
//   5. validateCategoryOrder(parsed) -- post-parse validation
//
// BACKWARDS COMPATIBILITY:
//   - parseOrder() still works with dealerId=null (defaults to FOOD)
//   - Legacy ParsedOrder is a subset of ParsedOrderMultiCategory
//   - Existing training_examples work as-is (treated as category="food")
//   - Existing market_products work as-is (category_attributes is nullable)
//
// PRIORITY HIERARCHY (unchanged from v1):
//   1. CATALOG (source of truth for names/prices)
//   2. FEW-SHOT EXAMPLES (teaches parsing patterns)
//   3. SEED EXAMPLES (from category definition, cold-start only)
//   4. BASE PROMPT (always present)
// ============================================================================

import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { CONFIG, CONSTANTS } from "./config";
import {
  DealerCategory,
  CATEGORY_REGISTRY,
  CategoryDefinition,
  getCategoryDefinition,
  detectCategoryFromText,
  validateCategoryAttributes,
} from "./category-definitions";
import {
  ParsedOrderMultiCategory,
  ParsedItemMultiCategory,
  ValidationWarning,
  CategoryParsingContext,
  CatalogProductExtended,
  CategoryTrainingExample,
  DealerWithCategory,
  legacyToMultiCategory,
} from "./multi-category-types";

// Re-export for backwards compatibility
export type { ParsedOrderMultiCategory as ParsedOrder };
export type { CategoryParsingContext as OrderParsingContext };

// ─────────────────────────────────────────────────────────────────────────
// CLIENTS
// ─────────────────────────────────────────────────────────────────────────

const anthropicClient = new Anthropic({
  apiKey: CONFIG.anthropic.apiKey,
});

const supabaseClient = createClient(CONFIG.supabase.url, CONFIG.supabase.anonKey);

// ─────────────────────────────────────────────────────────────────────────
// 1. CATEGORY DETECTION
// ─────────────────────────────────────────────────────────────────────────

/**
 * Detect the order category for a given dealer and/or text.
 *
 * Resolution order:
 *   1. Dealer's registered category (from dealers table) -- highest priority
 *   2. Text-based keyword detection -- fallback
 *   3. Default to FOOD -- last resort (backwards compatibility)
 *
 * @param text       The order text (for keyword detection)
 * @param dealerId   Optional dealer ID to look up registered category
 * @returns          { category, source } where source explains how it was determined
 */
export async function detectOrderCategory(
  text: string,
  dealerId?: string | null
): Promise<{ category: DealerCategory; source: "dealer" | "text_detection" | "default" }> {
  // 1. Try dealer's registered category
  if (dealerId) {
    try {
      const { data, error } = await supabaseClient
        .from(CONSTANTS.TABLE_DEALERS)
        .select("id, category")
        .eq("id", dealerId)
        .maybeSingle();

      if (!error && data?.category) {
        const dealerCategory = data.category as DealerCategory;
        if (CATEGORY_REGISTRY.has(dealerCategory)) {
          console.log(
            `[detectOrderCategory] Dealer ${dealerId} has registered category: ${dealerCategory}`
          );
          return { category: dealerCategory, source: "dealer" };
        }
      }
    } catch (err) {
      console.warn("[detectOrderCategory] Error fetching dealer category:", err);
    }
  }

  // 2. Try text-based detection
  if (CONSTANTS.CATEGORY_DETECTION_ENABLED) {
    const detected = detectCategoryFromText(text);
    if (detected) {
      console.log(
        `[detectOrderCategory] Detected category from text: ${detected}`
      );
      return { category: detected, source: "text_detection" };
    }
  }

  // 3. Default to FOOD
  console.log("[detectOrderCategory] Defaulting to FOOD category");
  return { category: DealerCategory.FOOD, source: "default" };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. CATALOG LOADER (Extended for category attributes)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Load active products with stock for a given dealer.
 * Now includes category_attributes JSONB field for rich product metadata.
 * Returns an empty array if dealerId is null/undefined or no products found.
 */
async function fetchDealerCatalog(
  dealerId?: string | null
): Promise<CatalogProductExtended[]> {
  if (!dealerId || !CONSTANTS.CATALOG_CONTEXT_ENABLED) {
    return [];
  }

  try {
    const { data, error } = await supabaseClient
      .from(CONSTANTS.TABLE_MARKET_PRODUCTS)
      .select("name, price, category, description, category_attributes")
      .eq("dealer_id", dealerId)
      .eq("is_active", true)
      .gt("stock", 0)
      .order("sold_count", { ascending: false })
      .limit(CONSTANTS.CATALOG_MAX_PRODUCTS);

    if (error) {
      console.warn("[fetchDealerCatalog] Error:", error.message);
      return [];
    }

    if (data && data.length > 0) {
      console.log(
        `[fetchDealerCatalog] Loaded ${data.length} products for dealer ${dealerId}`
      );
      return data as CatalogProductExtended[];
    }

    console.log(`[fetchDealerCatalog] No active products for dealer ${dealerId}`);
    return [];
  } catch (err) {
    console.warn("[fetchDealerCatalog] Unexpected error:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 3. FEW-SHOT EXAMPLE RETRIEVAL (Category-aware)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Fetch confirmed training examples, filtered by category when possible.
 *
 * Strategy:
 *   1. Try dealer-specific + category-specific examples
 *   2. Fall back to category-specific global examples
 *   3. Fall back to any global confirmed examples
 */
async function fetchFewShotExamples(
  category: DealerCategory,
  dealerId?: string | null
): Promise<CategoryTrainingExample[]> {
  try {
    const limit = CONSTANTS.FEW_SHOT_MAX_EXAMPLES;
    const minScore = CONSTANTS.FEW_SHOT_MIN_QUALITY_SCORE;

    // 1. Try dealer-specific + category-specific
    if (dealerId) {
      const { data: dealerExamples, error: dealerError } = await supabaseClient
        .from(CONSTANTS.TABLE_TRAINING_EXAMPLES)
        .select("raw_input, parsed_output, category")
        .eq("is_confirmed", true)
        .eq("dealer_id", dealerId)
        .eq("category", category)
        .gte("quality_score", minScore)
        .order("quality_score", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(limit);

      if (!dealerError && dealerExamples && dealerExamples.length >= 2) {
        console.log(
          `[fetchFewShotExamples] Loaded ${dealerExamples.length} dealer+category examples for ${dealerId}/${category}`
        );
        return dealerExamples as CategoryTrainingExample[];
      }
    }

    // 2. Try category-specific global examples
    const { data: categoryExamples, error: categoryError } = await supabaseClient
      .from(CONSTANTS.TABLE_TRAINING_EXAMPLES)
      .select("raw_input, parsed_output, category")
      .eq("is_confirmed", true)
      .eq("category", category)
      .gte("quality_score", minScore)
      .order("quality_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (!categoryError && categoryExamples && categoryExamples.length >= 2) {
      console.log(
        `[fetchFewShotExamples] Loaded ${categoryExamples.length} global category examples for ${category}`
      );
      return categoryExamples as CategoryTrainingExample[];
    }

    // 3. Fall back to any global confirmed examples (legacy behavior)
    const { data: globalExamples, error: globalError } = await supabaseClient
      .from(CONSTANTS.TABLE_TRAINING_EXAMPLES)
      .select("raw_input, parsed_output, category")
      .eq("is_confirmed", true)
      .gte("quality_score", minScore)
      .order("quality_score", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(limit);

    if (globalError) {
      console.warn("[fetchFewShotExamples] Error:", globalError.message);
      return [];
    }

    if (globalExamples && globalExamples.length > 0) {
      console.log(
        `[fetchFewShotExamples] Loaded ${globalExamples.length} global few-shot examples (fallback)`
      );
      return globalExamples as CategoryTrainingExample[];
    }

    console.log("[fetchFewShotExamples] No few-shot examples available (cold start)");
    return [];
  } catch (err) {
    console.warn("[fetchFewShotExamples] Failed to fetch:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. CATALOG PROMPT SECTION BUILDER (Category-aware)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build a compact catalog section for the system prompt.
 * Now includes category-specific attributes in the catalog display.
 */
function buildCatalogPromptSection(
  catalog: CatalogProductExtended[],
  category: DealerCategory
): string {
  if (catalog.length === 0) return "";

  const categoryDef = getCategoryDefinition(category);

  // Group by category
  const byCategory = new Map<string, CatalogProductExtended[]>();
  for (const p of catalog) {
    const cat = p.category || "Altro";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(p);
  }

  let section = "\n\nCATALOGO PRODOTTI DISPONIBILI PER QUESTO DEALER:\n";
  section += "(Usa questi nomi ESATTI e prezzi quando il cliente ordina un prodotto corrispondente)\n";

  for (const [productCategory, products] of byCategory) {
    section += `\n[${productCategory}]\n`;
    for (const p of products) {
      section += `- ${p.name}: ${p.price.toFixed(2)} EUR`;
      if (p.description) {
        const desc = p.description.length > 60
          ? p.description.slice(0, 57) + "..."
          : p.description;
        section += ` (${desc})`;
      }
      // Include category-specific attributes from catalog
      if (p.category_attributes && categoryDef) {
        const attrParts: string[] = [];
        for (const field of categoryDef.attributeFields) {
          const val = p.category_attributes[field.name];
          if (val != null) {
            attrParts.push(`${field.name}: ${val}`);
          }
        }
        if (attrParts.length > 0) {
          section += ` [${attrParts.join(", ")}]`;
        }
      }
      section += "\n";
    }
  }

  section += "\nREGOLE CATALOGO:\n";
  section += "- Se il cliente ordina qualcosa che corrisponde a un prodotto del catalogo, usa il NOME ESATTO dal catalogo\n";
  section += "- Compila il campo unit_price con il prezzo dal catalogo\n";
  section += '- Se il prodotto NON e nel catalogo, usa il nome dato dal cliente e unit_price: null\n';
  section += "- Fai matching FUZZY: 'margherita' corrisponde a 'Pizza Margherita', 'coca' a 'Coca Cola', ecc.\n";

  return section;
}

// ─────────────────────────────────────────────────────────────────────────
// 5. FEW-SHOT MESSAGE BUILDER
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build few-shot messages from training examples.
 */
function buildFewShotMessages(
  examples: CategoryTrainingExample[]
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const example of examples) {
    messages.push({
      role: "user",
      content: `Analizza questo ordine:\n"${example.raw_input}"`,
    });
    messages.push({
      role: "assistant",
      content: JSON.stringify(example.parsed_output, null, 2),
    });
  }

  return messages;
}

/**
 * Build seed example messages from the category definition.
 * Used for cold start when no training_examples exist.
 */
function buildSeedExampleMessages(
  categoryDef: CategoryDefinition
): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];

  for (const seed of categoryDef.seedExamples) {
    messages.push({
      role: "user",
      content: `Analizza questo ordine:\n"${seed.input}"`,
    });
    messages.push({
      role: "assistant",
      content: seed.output,
    });
  }

  return messages;
}

// ─────────────────────────────────────────────────────────────────────────
// 6. SYSTEM PROMPT BUILDER (Category-aware, dynamic)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Generate the complete system prompt for a given category.
 *
 * Structure:
 *   1. Base role description (common to all categories)
 *   2. Category-specific instructions (from CategoryDefinition)
 *   3. Output JSON schema (adapted per category)
 *   4. Catalog section (if products available)
 *   5. Common rules
 */
export function generateCategoryPrompt(
  category: DealerCategory,
  catalog: CatalogProductExtended[]
): string {
  const categoryDef = getCategoryDefinition(category);
  const hasUnitPrice = catalog.length > 0;

  // ── BASE ROLE ──
  let prompt = `Sei un parser di ordini in italiano per la piattaforma Dloop.
Analizzi il testo dell'utente e estrai i dati strutturati.

CATEGORIA DI QUESTO DEALER: ${categoryDef?.label_it || category.toUpperCase()}
${categoryDef?.description_it || ""}

Rispondi ESCLUSIVAMENTE in JSON PURO (senza markdown, senza commenti, senza backtick) con questa struttura:
{
  "is_order": true,
  "category": "${category}",
  "customer": {
    "name": "nome cliente o null",
    "phone": "numero telefonico con prefisso o null"
  },
  "delivery": {
    "street": "via/piazza",
    "number": "numero civico",
    "city": "citta",
    "extra": "dettagli aggiuntivi (piano, campanello, ecc) o null"
  },
  "items": [
    ${categoryDef?.itemSchemaExample || `{"product": "nome articolo", "quantity": 2${hasUnitPrice ? ', "unit_price": 8.50' : ''}, "notes": "note opzionali o null"}`}
  ],
  "missing_fields": []${hasUnitPrice ? ',\n  "catalog_matched": true' : ''}
}`;

  // ── CATEGORY-SPECIFIC INSTRUCTIONS ──
  if (categoryDef?.promptInstructions) {
    prompt += `\n\n${categoryDef.promptInstructions}`;
  }

  // ── ATTRIBUTE FIELDS DOCUMENTATION ──
  if (categoryDef && categoryDef.attributeFields.length > 0) {
    prompt += "\n\nCAMPI CATEGORY_ATTRIBUTES PER OGNI ITEM:";
    for (const field of categoryDef.attributeFields) {
      const req = field.required ? " (OBBLIGATORIO)" : " (opzionale)";
      const enumInfo = field.enum_values
        ? ` [valori: ${field.enum_values.join(", ")}]`
        : "";
      prompt += `\n- ${field.name}: ${field.description_it}${req}${enumInfo}`;
    }
  }

  // ── CATALOG SECTION ──
  const catalogSection = buildCatalogPromptSection(catalog, category);
  if (catalogSection) {
    prompt += catalogSection;
  }

  // ── COMMON RULES ──
  prompt += `

REGOLE CRITICHE:
1. Se il testo NON e un ordine (es: saluto, domanda, chiacchiera), rispondi: {"is_order": false}
2. Estrai nome cliente, indirizzo completo (via, numero, citta), articoli con quantita
3. Se la quantita non e esplicita, usa 1
4. Rispondi ESCLUSIVAMENTE con JSON valido, niente altro
5. Se un campo e sconosciuto, usa null
6. Se e un ordine, is_order deve essere true
7. Normalizza i nomi dei prodotti (prima lettera maiuscola)
8. I numeri di telefono devono includere il prefisso +39 se italiano
9. Il campo "category" deve essere sempre "${category}"
10. Ogni item DEVE avere il campo "category_attributes" con i campi specifici di questa categoria`;

  return prompt;
}

// ─────────────────────────────────────────────────────────────────────────
// 7. BUILD CATEGORY CONTEXT (Main orchestrator)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Build the complete AI context for category-aware order parsing.
 *
 * This is the main entry point for context assembly. It:
 *   1. Detects the category (from dealer or text)
 *   2. Loads the dealer's product catalog
 *   3. Loads confirmed few-shot examples (filtered by category)
 *   4. Falls back to seed examples from category definition if needed
 *   5. Builds the dynamic system prompt with category instructions
 *   6. Returns a complete context object ready for the Haiku API call
 *
 * @param category   The resolved category
 * @param dealerId   Optional dealer ID for dealer-specific context
 * @param categorySource  How the category was determined
 * @returns          Complete context for the API call
 */
export async function buildCategoryContext(
  category: DealerCategory,
  dealerId?: string | null,
  categorySource: "dealer" | "text_detection" | "default" = "default"
): Promise<CategoryParsingContext> {
  const categoryDef = getCategoryDefinition(category);

  // Load catalog and few-shot examples in parallel
  const [catalog, fewShotExamples] = await Promise.all([
    fetchDealerCatalog(dealerId),
    fetchFewShotExamples(category, dealerId),
  ]);

  // Build the dynamic system prompt
  const systemPrompt = generateCategoryPrompt(category, catalog);

  // Build few-shot messages (from DB examples)
  const fewShotMessages = buildFewShotMessages(fewShotExamples);

  // Build seed example messages (from category definition, for cold start)
  const seedExamples = categoryDef
    ? buildSeedExampleMessages(categoryDef)
    : [];

  const context: CategoryParsingContext = {
    dealerId: dealerId || null,
    category,
    categorySource,
    catalog,
    fewShotExamples,
    systemPrompt,
    fewShotMessages,
    seedExamples,
    contextSummary: {
      catalogProducts: catalog.length,
      fewShotCount: fewShotExamples.length,
      seedExampleCount: categoryDef?.seedExamples.length || 0,
      hasCatalog: catalog.length > 0,
      hasFewShot: fewShotExamples.length > 0,
      hasSeedExamples: (categoryDef?.seedExamples.length || 0) > 0,
      isColdStart: catalog.length === 0 && fewShotExamples.length === 0,
      category,
      categorySource,
    },
  };

  console.log(
    `[buildCategoryContext] Context built: ` +
    `category=${category} (${categorySource}), ` +
    `dealer=${dealerId || "unknown"}, ` +
    `catalog=${context.contextSummary.catalogProducts}, ` +
    `fewShot=${context.contextSummary.fewShotCount}, ` +
    `seeds=${context.contextSummary.seedExampleCount}, ` +
    `coldStart=${context.contextSummary.isColdStart}`
  );

  return context;
}

// Backwards-compatible alias
export const buildOrderParsingContext = async (
  dealerId?: string | null
): Promise<CategoryParsingContext> => {
  const { category, source } = await detectOrderCategory("", dealerId);
  return buildCategoryContext(category, dealerId, source);
};

// ─────────────────────────────────────────────────────────────────────────
// 8. MAIN PARSE FUNCTION (Multi-Category)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Parse a natural language order message using Claude Haiku with
 * full category-aware context.
 *
 * @param text       The raw user message to parse
 * @param dealerId   Optional dealer ID for dealer-specific context
 * @param context    Optional pre-built context (if null, will be built internally)
 * @returns          Parsed order structure or null on failure
 */
export async function parseOrder(
  text: string,
  dealerId?: string | null,
  context?: CategoryParsingContext | null
): Promise<ParsedOrderMultiCategory | null> {
  try {
    // 1. Build or reuse context
    let ctx: CategoryParsingContext;
    if (context) {
      ctx = context;
    } else {
      // Detect category from text + dealer
      const { category, source } = await detectOrderCategory(text, dealerId);
      ctx = await buildCategoryContext(category, dealerId, source);
    }

    // 2. Assemble messages: seed examples + few-shot + actual request
    //    Priority: few-shot from DB > seed examples from definition
    const exampleMessages = ctx.fewShotMessages.length > 0
      ? ctx.fewShotMessages
      : ctx.seedExamples;

    const allMessages: Array<{ role: "user" | "assistant"; content: string }> = [
      ...exampleMessages,
      {
        role: "user",
        content: `Analizza questo ordine:\n"${text}"`,
      },
    ];

    // 3. Call Haiku
    const message = await anthropicClient.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 1200, // Increased for category attributes
      system: ctx.systemPrompt,
      messages: allMessages,
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    if (CONFIG.runtime.debug) {
      console.log("[parseOrder] Haiku response:", responseText);
      console.log(
        `[parseOrder] Context: category=${ctx.category}, ` +
        `${ctx.contextSummary.catalogProducts} catalog, ` +
        `${ctx.contextSummary.fewShotCount} fewShot, ` +
        `${allMessages.length} messages`
      );
    }

    // 4. Extract JSON from response
    let jsonMatch = responseText.match(/```json\n?([\s\S]*?)\n?```/);
    if (!jsonMatch) {
      jsonMatch = responseText.match(/\{[\s\S]*\}/);
    }

    if (!jsonMatch) {
      console.warn("[parseOrder] No JSON found in response:", responseText);
      return null;
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const parsed = JSON.parse(jsonStr);

    // 5. If not an order, return early
    if (!parsed.is_order) {
      return {
        is_order: false,
        category: ctx.category,
        customer: {},
        delivery: {},
        items: [],
        missing_fields: [],
      };
    }

    // 6. Determine missing required fields
    const missing_fields: string[] = [];

    if (!parsed.customer?.name) missing_fields.push("customer.name");
    if (!parsed.customer?.phone) missing_fields.push("customer.phone");
    if (!parsed.delivery?.street) missing_fields.push("delivery.street");
    if (!parsed.delivery?.number) missing_fields.push("delivery.number");
    if (!parsed.delivery?.city) missing_fields.push("delivery.city");
    if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      missing_fields.push("items");
    }

    // 7. Check category-specific required fields
    const categoryDef = getCategoryDefinition(ctx.category);
    if (categoryDef) {
      for (const item of (parsed.items || [])) {
        const attrs = item.category_attributes || {};
        for (const field of categoryDef.attributeFields) {
          if (field.required && (attrs[field.name] == null || attrs[field.name] === "")) {
            const fieldKey = `items.category_attributes.${field.name}`;
            if (!missing_fields.includes(fieldKey)) {
              missing_fields.push(fieldKey);
            }
          }
        }
      }
    }

    // 8. Post-process items: enrich with catalog prices, normalize attributes
    const items: ParsedItemMultiCategory[] = (parsed.items || []).map((item: any) => {
      const result: ParsedItemMultiCategory = {
        product: item.product || "articolo",
        quantity: item.quantity || 1,
        notes: item.notes || null,
        category_attributes: item.category_attributes || null,
      };

      // Price enrichment from catalog
      if (item.unit_price != null && item.unit_price > 0) {
        result.unit_price = item.unit_price;
      } else if (ctx.catalog.length > 0) {
        const matched = fuzzyMatchCatalog(item.product || "", ctx.catalog);
        if (matched) {
          result.product = matched.name;
          result.unit_price = matched.price;
        }
      }

      return result;
    });

    // 9. Run category-specific validation
    const validation_warnings: ValidationWarning[] = [];
    if (categoryDef) {
      for (let i = 0; i < items.length; i++) {
        const attrs = items[i].category_attributes;
        if (attrs) {
          const warnings = validateCategoryAttributes(
            ctx.category,
            attrs as Record<string, any>
          );
          for (const w of warnings) {
            validation_warnings.push({
              item_index: i,
              field: w.field,
              message: w.message,
              severity: w.severity,
            });
          }
        }
      }
    }

    // 10. Build final result
    return {
      is_order: true,
      category: ctx.category,
      customer: {
        name: parsed.customer?.name || undefined,
        phone: parsed.customer?.phone || undefined,
      },
      delivery: {
        street: parsed.delivery?.street || undefined,
        number: parsed.delivery?.number || undefined,
        city: parsed.delivery?.city || undefined,
        extra: parsed.delivery?.extra || undefined,
      },
      items,
      missing_fields,
      catalog_matched: parsed.catalog_matched || ctx.catalog.length > 0,
      validation_warnings: validation_warnings.length > 0 ? validation_warnings : undefined,
      parse_metadata: {
        category_source: ctx.categorySource,
        model_version: "claude-3-5-haiku-20241022",
        category_prompt_used: true,
      },
    };
  } catch (err) {
    console.error("[parseOrder] Parsing error:", err);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 9. LOCAL FUZZY MATCHING (Unchanged from v1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Simple fuzzy match for catalog price enrichment.
 */
function fuzzyMatchCatalog(
  userProduct: string,
  catalog: CatalogProductExtended[]
): CatalogProductExtended | null {
  if (!userProduct || catalog.length === 0) return null;

  const normalized = userProduct.toLowerCase().trim();

  // 1. Exact match
  const exact = catalog.find(
    (p) => p.name.toLowerCase() === normalized
  );
  if (exact) return exact;

  // 2. Substring match
  const substring = catalog.find((p) => {
    const catName = p.name.toLowerCase();
    return catName.includes(normalized) || normalized.includes(catName);
  });
  if (substring) return substring;

  // 3. Word overlap match
  const userWords = normalized.split(/\s+/).filter((w) => w.length > 2);
  if (userWords.length === 0) return null;

  let bestMatch: CatalogProductExtended | null = null;
  let bestScore = 0;

  for (const p of catalog) {
    const catWords = p.name.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const overlap = userWords.filter((uw) =>
      catWords.some((cw) => cw.includes(uw) || uw.includes(cw))
    ).length;
    const score = overlap / Math.max(userWords.length, catWords.length);

    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = p;
    }
  }

  return bestMatch;
}

// ─────────────────────────────────────────────────────────────────────────
// 10. TRAINING EXAMPLE WRITER (Category-aware)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Save a training example with category metadata.
 */
export async function saveTrainingExample(
  orderId: string,
  rawInput: string,
  parsedOutput: ParsedOrderMultiCategory,
  dealerId?: string | null
): Promise<string | null> {
  try {
    const { data, error } = await supabaseClient
      .from(CONSTANTS.TABLE_TRAINING_EXAMPLES)
      .insert([
        {
          order_id: orderId,
          dealer_id: dealerId || null,
          raw_input: rawInput,
          parsed_output: parsedOutput,
          category: parsedOutput.category || DealerCategory.FOOD,
          is_confirmed: false,
          quality_score: 0,
          source: "telegram",
          model_version: "claude-3-5-haiku-20241022",
        },
      ])
      .select("id")
      .single();

    if (error) {
      console.error("[saveTrainingExample] Insert error:", error.message);
      return null;
    }

    console.log(
      `[saveTrainingExample] Saved training example ${data.id} for order ${orderId} (category: ${parsedOutput.category})`
    );
    return data.id;
  } catch (err) {
    console.error("[saveTrainingExample] Unexpected error:", err);
    return null;
  }
}

/**
 * Mark a training example as confirmed (dealer accepted the order).
 */
export async function confirmTrainingExample(
  orderId: string
): Promise<void> {
  try {
    const { error } = await supabaseClient
      .from(CONSTANTS.TABLE_TRAINING_EXAMPLES)
      .update({
        is_confirmed: true,
        quality_score: 5,
      })
      .eq("order_id", orderId);

    if (error) {
      console.error(
        "[confirmTrainingExample] Update error:",
        error.message
      );
      return;
    }

    console.log(
      `[confirmTrainingExample] Marked training example as confirmed for order ${orderId}`
    );
  } catch (err) {
    console.error("[confirmTrainingExample] Unexpected error:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 11. TELEGRAM DISPLAY HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Format a parsed item for Telegram display using the category's format template.
 * Falls back to a generic format if no category definition is found.
 */
export function formatItemForTelegram(
  item: ParsedItemMultiCategory,
  category: DealerCategory
): string {
  const categoryDef = getCategoryDefinition(category);

  if (!categoryDef || !item.category_attributes) {
    // Generic format (backwards compatible)
    let line = `${item.quantity}x ${item.product}`;
    if (item.unit_price) line += ` (${item.unit_price.toFixed(2)} EUR)`;
    if (item.notes) line += ` -- ${item.notes}`;
    return line;
  }

  // Build from template
  let formatted = categoryDef.telegramItemFormat;
  formatted = formatted.replace("{quantity}", String(item.quantity));
  formatted = formatted.replace("{product}", item.product);
  if (item.unit_price) {
    formatted += ` (${item.unit_price.toFixed(2)} EUR)`;
  }

  // Replace attribute placeholders
  const attrs = item.category_attributes as Record<string, any>;
  // Handle conditional attributes: {attr:field? text} -- only shows if field is non-null
  formatted = formatted.replace(
    /\{attr:(\w+)\?\s*([^}]*)\}/g,
    (_, field, template) => {
      const val = attrs[field];
      if (val == null || val === "" || (Array.isArray(val) && val.length === 0)) {
        return "";
      }
      return template.replace(`{attr:${field}}`, Array.isArray(val) ? val.join(", ") : String(val));
    }
  );

  // Handle direct attribute references: {attr:field}
  formatted = formatted.replace(
    /\{attr:(\w+)\}/g,
    (_, field) => {
      const val = attrs[field];
      if (val == null) return "";
      return Array.isArray(val) ? val.join(", ") : String(val);
    }
  );

  if (item.notes) {
    formatted += ` -- ${item.notes}`;
  }

  return formatted.trim();
}

/**
 * Format validation warnings for Telegram display.
 */
export function formatValidationWarnings(
  warnings: ValidationWarning[]
): string {
  if (!warnings || warnings.length === 0) return "";

  const lines: string[] = [];
  for (const w of warnings) {
    const prefix = w.severity === "error" ? "ERRORE" : "NOTA";
    const itemRef = w.item_index != null ? ` (articolo #${w.item_index + 1})` : "";
    lines.push(`${prefix}${itemRef}: ${w.message}`);
  }
  return lines.join("\n");
}
