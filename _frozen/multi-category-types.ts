// ============================================================================
// DLOOP MULTI-CATEGORY SYSTEM - UNIVERSAL TYPE DEFINITIONS
// ============================================================================
// Extends the existing ParsedOrder type system to support multiple categories.
//
// BACKWARDS COMPATIBILITY:
//   - ParsedOrderMultiCategory extends the shape of ParsedOrder
//   - When category is "food" or undefined, the structure is identical to legacy
//   - The `category` field defaults to "food" for legacy orders
//   - category_attributes on items is optional (null for legacy food items)
//
// MIGRATION PATH:
//   Legacy ParsedOrder -> ParsedOrderMultiCategory with category="food"
// ============================================================================

import {
  DealerCategory,
  CategoryAttributes,
  FoodAttributes,
  AbbigliamentoAttributes,
  GroceryAttributes,
  PetAttributes,
  FarmacieAttributes,
  CasaAttributes,
} from "./category-definitions";

// ---------------------------------------------------------------------------
// UNIVERSAL PARSED ORDER (Multi-Category)
// ---------------------------------------------------------------------------

/**
 * Universal parsed order structure that supports all categories.
 * This is the output of the multi-category parseOrder() function.
 *
 * Backwards compatible: when `category` is "food" or absent,
 * the structure is identical to the legacy ParsedOrder.
 */
export interface ParsedOrderMultiCategory {
  /** Whether the text was recognized as an order */
  is_order: boolean;

  /**
   * The detected/assigned category for this order.
   * - Set from dealer's registered category (primary)
   * - Or detected from text keywords (fallback)
   * - Defaults to "food" for backwards compatibility
   */
  category: DealerCategory;

  /** Customer information */
  customer: {
    name?: string;
    phone?: string;
  };

  /** Delivery address */
  delivery: {
    street?: string;
    number?: string;
    city?: string;
    extra?: string;
  };

  /** Order items with category-specific attributes */
  items: ParsedItemMultiCategory[];

  /** Fields that are missing and required */
  missing_fields: string[];

  /** Whether products were matched against the dealer's catalog */
  catalog_matched?: boolean;

  /** Validation results from category-specific rules */
  validation_warnings?: ValidationWarning[];

  /** Metadata about the parsing context */
  parse_metadata?: {
    /** Which category definition was used */
    category_source: "dealer" | "text_detection" | "default";
    /** Confidence of text-based category detection (0-1) */
    detection_confidence?: number;
    /** Model used for parsing */
    model_version: string;
    /** Whether category-specific prompt was used */
    category_prompt_used: boolean;
  };
}

/**
 * A single parsed item with universal + category-specific attributes.
 */
export interface ParsedItemMultiCategory {
  /** Product name (normalized, first letter capitalized) */
  product: string;

  /** Quantity ordered */
  quantity: number;

  /** Unit price from catalog match (null if not matched) */
  unit_price?: number | null;

  /** Free-form notes for this item */
  notes?: string | null;

  /**
   * Category-specific attributes extracted by the AI.
   * Shape depends on the order's category:
   *   - food -> FoodAttributes
   *   - abbigliamento -> AbbigliamentoAttributes
   *   - grocery -> GroceryAttributes
   *   - pet -> PetAttributes
   *   - farmacie -> FarmacieAttributes
   *   - casa -> CasaAttributes
   *
   * Null for legacy food orders or when no attributes were extracted.
   */
  category_attributes?: CategoryAttributes | null;
}

/**
 * Validation warning produced by category-specific rules.
 */
export interface ValidationWarning {
  /** Which item index this applies to (null for order-level) */
  item_index?: number | null;
  /** Field that failed validation */
  field: string;
  /** Human-readable message in Italian */
  message: string;
  /** Severity: error blocks the order, warning flags but allows */
  severity: "error" | "warning";
}

// ---------------------------------------------------------------------------
// CATEGORY-AWARE PARSING CONTEXT
// ---------------------------------------------------------------------------

/**
 * Extended parsing context that includes category information.
 * Extends the existing OrderParsingContext concept.
 */
export interface CategoryParsingContext {
  /** Dealer ID (null for anonymous orders) */
  dealerId: string | null;

  /** Resolved category for this parsing session */
  category: DealerCategory;

  /** How the category was determined */
  categorySource: "dealer" | "text_detection" | "default";

  /** Dealer's product catalog (from market_products) */
  catalog: CatalogProductExtended[];

  /** Few-shot examples filtered for this category */
  fewShotExamples: CategoryTrainingExample[];

  /** Complete system prompt (includes category instructions) */
  systemPrompt: string;

  /** Few-shot messages formatted for the API */
  fewShotMessages: Array<{ role: "user" | "assistant"; content: string }>;

  /** Seed examples from category definition (for cold start) */
  seedExamples: Array<{ role: "user" | "assistant"; content: string }>;

  /** Summary for logging/debugging */
  contextSummary: {
    catalogProducts: number;
    fewShotCount: number;
    seedExampleCount: number;
    hasCatalog: boolean;
    hasFewShot: boolean;
    hasSeedExamples: boolean;
    isColdStart: boolean;
    category: DealerCategory;
    categorySource: string;
  };
}

/**
 * Extended catalog product with category-specific attributes.
 * Extends the existing CatalogProduct by adding category_attributes JSONB.
 */
export interface CatalogProductExtended {
  name: string;
  price: number;
  category: string | null;
  description: string | null;
  /** Category-specific attributes stored in market_products.category_attributes */
  category_attributes?: Record<string, any> | null;
}

/**
 * Training example with category metadata.
 */
export interface CategoryTrainingExample {
  raw_input: string;
  parsed_output: ParsedOrderMultiCategory;
  category?: DealerCategory;
}

// ---------------------------------------------------------------------------
// DEALER WITH CATEGORY
// ---------------------------------------------------------------------------

/**
 * Extended dealer interface that includes category information.
 * Used by the category resolution logic.
 */
export interface DealerWithCategory {
  id: string;
  name: string;
  category: DealerCategory;
  telegram_user_id?: string;
}

// ---------------------------------------------------------------------------
// TYPE GUARDS AND CONVERTERS
// ---------------------------------------------------------------------------

/**
 * Type guard: check if attributes are FoodAttributes.
 */
export function isFoodAttributes(
  attrs: CategoryAttributes | null | undefined
): attrs is FoodAttributes {
  if (!attrs) return false;
  return "ingredienti_custom" in attrs || "preferenze_dietetiche" in attrs || "allergeni_segnalati" in attrs;
}

/**
 * Type guard: check if attributes are AbbigliamentoAttributes.
 */
export function isAbbigliamentoAttributes(
  attrs: CategoryAttributes | null | undefined
): attrs is AbbigliamentoAttributes {
  if (!attrs) return false;
  return "taglia" in attrs && !("specie" in attrs);
}

/**
 * Type guard: check if attributes are GroceryAttributes.
 */
export function isGroceryAttributes(
  attrs: CategoryAttributes | null | undefined
): attrs is GroceryAttributes {
  if (!attrs) return false;
  return "unita" in attrs || "brand" in attrs || "peso_confezione" in attrs && !("specie" in attrs);
}

/**
 * Type guard: check if attributes are PetAttributes.
 */
export function isPetAttributes(
  attrs: CategoryAttributes | null | undefined
): attrs is PetAttributes {
  if (!attrs) return false;
  return "specie" in attrs;
}

/**
 * Type guard: check if attributes are FarmacieAttributes.
 */
export function isFarmacieAttributes(
  attrs: CategoryAttributes | null | undefined
): attrs is FarmacieAttributes {
  if (!attrs) return false;
  return "dosaggio" in attrs || "tipo_ricetta" in attrs || "principio_attivo" in attrs;
}

/**
 * Type guard: check if attributes are CasaAttributes.
 */
export function isCasaAttributes(
  attrs: CategoryAttributes | null | undefined
): attrs is CasaAttributes {
  if (!attrs) return false;
  return "dimensioni" in attrs && "stanza" in attrs;
}

/**
 * Convert a legacy ParsedOrder to ParsedOrderMultiCategory.
 * Sets category to "food" and wraps items with null category_attributes.
 *
 * This ensures 100% backwards compatibility: any code that produces
 * a legacy ParsedOrder can be wrapped to work with the new system.
 */
export function legacyToMultiCategory(
  legacy: {
    is_order: boolean;
    customer: { name?: string; phone?: string };
    delivery: { street?: string; number?: string; city?: string; extra?: string };
    items: Array<{ product: string; quantity: number; unit_price?: number; notes?: string }>;
    missing_fields: string[];
    catalog_matched?: boolean;
  }
): ParsedOrderMultiCategory {
  return {
    is_order: legacy.is_order,
    category: DealerCategory.FOOD,
    customer: legacy.customer,
    delivery: legacy.delivery,
    items: legacy.items.map((item) => ({
      product: item.product,
      quantity: item.quantity,
      unit_price: item.unit_price ?? null,
      notes: item.notes ?? null,
      category_attributes: null,
    })),
    missing_fields: legacy.missing_fields,
    catalog_matched: legacy.catalog_matched,
    parse_metadata: {
      category_source: "default",
      model_version: "claude-3-5-haiku-20241022",
      category_prompt_used: false,
    },
  };
}

/**
 * Convert a ParsedOrderMultiCategory back to the legacy ParsedOrder shape.
 * Strips category-specific attributes. Used for backwards compatibility
 * with code that expects the old format.
 */
export function multiCategoryToLegacy(
  order: ParsedOrderMultiCategory
): {
  is_order: boolean;
  customer: { name?: string; phone?: string };
  delivery: { street?: string; number?: string; city?: string; extra?: string };
  items: Array<{ product: string; quantity: number; unit_price?: number; notes?: string }>;
  missing_fields: string[];
  catalog_matched?: boolean;
} {
  return {
    is_order: order.is_order,
    customer: order.customer,
    delivery: order.delivery,
    items: order.items.map((item) => ({
      product: item.product,
      quantity: item.quantity,
      unit_price: item.unit_price ?? undefined,
      notes: item.notes ?? undefined,
    })),
    missing_fields: order.missing_fields,
    catalog_matched: order.catalog_matched,
  };
}
