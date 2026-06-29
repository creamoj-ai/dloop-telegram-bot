// ============================================================================
// DLOOP MULTI-CATEGORY SYSTEM - CATEGORY DEFINITIONS
// ============================================================================
// Each category describes a vertical (FOOD, ABBIGLIAMENTO, GROCERY, etc.)
// with its own:
//   - Attribute schema (what fields Haiku should extract)
//   - Validation rules (per-field constraints)
//   - Prompt instructions (how to teach Haiku this vertical)
//   - Few-shot example templates (category-specific parsing patterns)
//
// ADDING A NEW CATEGORY:
//   1. Add the enum value to DealerCategory
//   2. Create a CategoryDefinition object
//   3. Register it in CATEGORY_REGISTRY
//   4. Add a SQL migration to seed dealer_categories rows
//   5. Optionally add seed training_examples for the new category
// ============================================================================

// ---------------------------------------------------------------------------
// CATEGORY ENUM
// ---------------------------------------------------------------------------

export enum DealerCategory {
  FOOD = "food",
  ABBIGLIAMENTO = "abbigliamento",
  GROCERY = "grocery",
  PET = "pet",
  FARMACIE = "farmacie",
  CASA = "casa",
}

// ---------------------------------------------------------------------------
// CATEGORY-SPECIFIC ATTRIBUTE SCHEMAS
// ---------------------------------------------------------------------------

/**
 * Attributes parsed for FOOD orders.
 * Preserves 100% backwards compatibility with the existing ParsedOrder.items format.
 */
export interface FoodAttributes {
  ingredienti_custom?: string[];    // e.g., ["senza aglio", "extra mozzarella"]
  preferenze_dietetiche?: string[]; // e.g., ["vegano", "senza glutine"]
  allergeni_segnalati?: string[];   // e.g., ["lattosio", "arachidi"]
  cottura?: string;                 // e.g., "ben cotta", "al sangue"
  formato?: string;                 // e.g., "famiglia", "mini"
}

/**
 * Attributes for ABBIGLIAMENTO (clothing) orders.
 */
export interface AbbigliamentoAttributes {
  taglia?: string;        // XS, S, M, L, XL, XXL, or numeric (42, 44, ...)
  colore?: string;        // e.g., "bianco", "nero", "rosso"
  materiale?: string;     // e.g., "cotone", "seta", "poliestere"
  genere?: "uomo" | "donna" | "unisex" | "bambino";
  taglia_reggiseno?: string; // e.g., "3C", "4B" (Yamamay-specific)
}

/**
 * Attributes for GROCERY (supermarket) orders.
 */
export interface GroceryAttributes {
  unita?: "kg" | "g" | "l" | "ml" | "pezzi" | "confezioni" | "bottiglie" | "lattine";
  brand?: string;         // e.g., "Barilla", "Mulino Bianco"
  variante?: string;      // e.g., "integrale", "senza zucchero"
  peso_confezione?: string; // e.g., "500g", "1l"
}

/**
 * Attributes for PET (animal products) orders.
 */
export interface PetAttributes {
  specie?: "cane" | "gatto" | "criceto" | "coniglio" | "pesce" | "uccello" | "altro";
  taglia_animale?: "piccola" | "media" | "grande" | "gigante";
  eta_animale?: "cucciolo" | "adulto" | "senior";
  peso_confezione?: string;  // e.g., "5kg", "400g"
  gusto?: string;            // e.g., "pollo", "salmone", "manzo"
}

/**
 * Attributes for FARMACIE (pharmacy/health) orders.
 */
export interface FarmacieAttributes {
  dosaggio?: string;                // e.g., "500mg", "1000mg"
  quantita_confezioni?: number;     // e.g., 2 confezioni
  forma?: "compresse" | "capsule" | "sciroppo" | "crema" | "gocce" | "bustine" | "supposte" | "altro";
  tipo_ricetta?: "senza_ricetta" | "con_ricetta" | "SOP" | "OTC";
  principio_attivo?: string;        // e.g., "paracetamolo", "ibuprofene"
  uso?: string;                     // e.g., "mal di testa", "febbre"
}

/**
 * Attributes for CASA (home/furnishing) orders.
 */
export interface CasaAttributes {
  dimensioni?: string;    // e.g., "200x200cm", "50x70cm"
  colore?: string;        // e.g., "grigio", "bianco"
  materiale?: string;     // e.g., "cotone", "microfibra", "legno"
  stanza?: string;        // e.g., "bagno", "camera", "cucina"
  stile?: string;         // e.g., "moderno", "classico", "minimal"
}

/**
 * Union type of all category-specific attributes.
 * The parser returns the relevant subset based on the detected category.
 */
export type CategoryAttributes =
  | FoodAttributes
  | AbbigliamentoAttributes
  | GroceryAttributes
  | PetAttributes
  | FarmacieAttributes
  | CasaAttributes;

// ---------------------------------------------------------------------------
// VALIDATION RULE DEFINITION
// ---------------------------------------------------------------------------

export interface ValidationRule {
  field: string;
  type: "enum" | "range" | "regex" | "required" | "custom";
  values?: string[];             // For enum type
  min?: number;                  // For range type
  max?: number;                  // For range type
  pattern?: string;              // For regex type
  message_it: string;            // Italian validation error message
  severity: "error" | "warning"; // error = block order, warning = flag but allow
}

// ---------------------------------------------------------------------------
// CATEGORY DEFINITION INTERFACE
// ---------------------------------------------------------------------------

/**
 * Complete definition of a category vertical.
 * Contains everything needed to:
 *   1. Build the AI parsing prompt
 *   2. Validate parsed results
 *   3. Format output for Telegram messages
 *   4. Generate few-shot examples
 */
export interface CategoryDefinition {
  /** Category identifier (matches DealerCategory enum) */
  id: DealerCategory;

  /** Human-readable label (Italian) */
  label_it: string;

  /** Short description for UI/logging */
  description_it: string;

  /** Icon emoji for Telegram messages */
  icon: string;

  /**
   * Category-specific fields that Haiku should extract from the order text.
   * These are appended to the base item schema (product, quantity, notes).
   */
  attributeFields: Array<{
    name: string;
    type: "string" | "number" | "string[]" | "enum";
    enum_values?: string[];
    description_it: string;
    required: boolean;
  }>;

  /**
   * Validation rules applied after parsing.
   * Category-specific constraints beyond basic type checking.
   */
  validationRules: ValidationRule[];

  /**
   * System prompt fragment injected into the Haiku prompt.
   * Teaches the model what to extract for this category.
   */
  promptInstructions: string;

  /**
   * JSON schema example shown in the prompt.
   * Haiku sees this as the expected output shape for items in this category.
   */
  itemSchemaExample: string;

  /**
   * Built-in few-shot examples for cold start.
   * Used when no training_examples exist for this category yet.
   */
  seedExamples: Array<{
    input: string;
    output: string; // JSON string of expected parse
  }>;

  /**
   * Keywords/patterns that help detect this category from free text.
   * Used by detectOrderCategory() when dealer category is unknown.
   */
  detectionKeywords: string[];

  /**
   * How to display items of this category in Telegram confirmation messages.
   * Placeholder tokens: {product}, {quantity}, {unit_price}, {attr:FIELDNAME}
   */
  telegramItemFormat: string;
}

// ---------------------------------------------------------------------------
// CATEGORY REGISTRY
// ---------------------------------------------------------------------------

export const CATEGORY_REGISTRY: Map<DealerCategory, CategoryDefinition> = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// 1. FOOD
// ═══════════════════════════════════════════════════════════════════════════

CATEGORY_REGISTRY.set(DealerCategory.FOOD, {
  id: DealerCategory.FOOD,
  label_it: "Cibo & Ristorazione",
  description_it: "Ordini di cibo da ristoranti, pizzerie, fast food",
  icon: "\uD83C\uDF55", // pizza emoji
  attributeFields: [
    {
      name: "ingredienti_custom",
      type: "string[]",
      description_it: "Modifiche agli ingredienti (es: senza cipolla, extra mozzarella)",
      required: false,
    },
    {
      name: "preferenze_dietetiche",
      type: "string[]",
      description_it: "Preferenze alimentari (es: vegano, senza glutine)",
      required: false,
    },
    {
      name: "allergeni_segnalati",
      type: "string[]",
      description_it: "Allergeni da evitare (es: lattosio, arachidi)",
      required: false,
    },
    {
      name: "cottura",
      type: "string",
      description_it: "Preferenza di cottura (es: ben cotta, al sangue)",
      required: false,
    },
    {
      name: "formato",
      type: "string",
      description_it: "Formato/dimensione (es: famiglia, mini, media)",
      required: false,
    },
  ],
  validationRules: [
    {
      field: "allergeni_segnalati",
      type: "custom",
      message_it: "ATTENZIONE: allergeni dichiarati. Verificare con il ristorante.",
      severity: "warning",
    },
  ],
  promptInstructions: `Questa e una categoria FOOD (cibo/ristorazione).
Estrai anche:
- ingredienti_custom: array di modifiche ingredienti (es: ["senza aglio", "extra mozzarella"])
- preferenze_dietetiche: array (es: ["vegano", "senza glutine"])
- allergeni_segnalati: array di allergeni menzionati (es: ["lattosio"])
- cottura: preferenza cottura (es: "ben cotta")
- formato: dimensione/formato se specificato (es: "famiglia", "mini")
Se il cliente dice "senza X" o "con extra Y", mettilo in ingredienti_custom.
Se menziona allergie o intolleranze, mettilo in allergeni_segnalati.`,
  itemSchemaExample: `{
  "product": "Pizza Margherita",
  "quantity": 2,
  "unit_price": 8.50,
  "notes": "per bambini",
  "category_attributes": {
    "ingredienti_custom": ["senza aglio"],
    "preferenze_dietetiche": ["senza glutine"],
    "allergeni_segnalati": [],
    "cottura": null,
    "formato": "famiglia"
  }
}`,
  seedExamples: [
    {
      input: "2 pizze margherita senza aglio, una diavola ben cotta, insalata mista con dressing a parte. Per Mario, Via Duomo 15 Napoli, 3201234567",
      output: JSON.stringify({
        is_order: true,
        category: "food",
        customer: { name: "Mario", phone: "+39 3201234567" },
        delivery: { street: "Via Duomo", number: "15", city: "Napoli", extra: null },
        items: [
          {
            product: "Pizza Margherita",
            quantity: 2,
            unit_price: null,
            notes: null,
            category_attributes: {
              ingredienti_custom: ["senza aglio"],
              preferenze_dietetiche: [],
              allergeni_segnalati: [],
              cottura: null,
              formato: null,
            },
          },
          {
            product: "Pizza Diavola",
            quantity: 1,
            unit_price: null,
            notes: null,
            category_attributes: {
              ingredienti_custom: [],
              preferenze_dietetiche: [],
              allergeni_segnalati: [],
              cottura: "ben cotta",
              formato: null,
            },
          },
          {
            product: "Insalata Mista",
            quantity: 1,
            unit_price: null,
            notes: "dressing a parte",
            category_attributes: {
              ingredienti_custom: [],
              preferenze_dietetiche: [],
              allergeni_segnalati: [],
              cottura: null,
              formato: null,
            },
          },
        ],
        missing_fields: [],
      }),
    },
  ],
  detectionKeywords: [
    "pizza", "pasta", "panino", "hamburger", "sushi", "insalata",
    "bibita", "coca cola", "acqua", "birra", "dolce", "dessert",
    "antipasto", "primo", "secondo", "contorno", "ristorante",
    "pizzeria", "trattoria", "poke", "kebab", "wok",
    "margherita", "carbonara", "amatriciana", "diavola",
  ],
  telegramItemFormat: "{quantity}x {product}{attr:ingredienti_custom? ({attr:ingredienti_custom})}{attr:cottura? - {attr:cottura}}",
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ABBIGLIAMENTO
// ═══════════════════════════════════════════════════════════════════════════

CATEGORY_REGISTRY.set(DealerCategory.ABBIGLIAMENTO, {
  id: DealerCategory.ABBIGLIAMENTO,
  label_it: "Abbigliamento & Intimo",
  description_it: "Ordini di vestiti, intimo, accessori (Yamamay, etc.)",
  icon: "\uD83D\uDC57", // dress emoji
  attributeFields: [
    {
      name: "taglia",
      type: "string",
      description_it: "Taglia capo (XS, S, M, L, XL, XXL, o numerica 38-56)",
      required: true,
    },
    {
      name: "colore",
      type: "string",
      description_it: "Colore del capo",
      required: true,
    },
    {
      name: "materiale",
      type: "string",
      description_it: "Materiale (cotone, seta, poliestere, etc.)",
      required: false,
    },
    {
      name: "genere",
      type: "enum",
      enum_values: ["uomo", "donna", "unisex", "bambino"],
      description_it: "Genere/destinatario del capo",
      required: false,
    },
    {
      name: "taglia_reggiseno",
      type: "string",
      description_it: "Taglia reggiseno specifica (es: 3C, 4B) -- solo per intimo",
      required: false,
    },
  ],
  validationRules: [
    {
      field: "taglia",
      type: "enum",
      values: ["XS", "S", "M", "L", "XL", "XXL", "38", "40", "42", "44", "46", "48", "50", "52", "54", "56"],
      message_it: "Taglia non riconosciuta. Taglie disponibili: XS-XXL o 38-56.",
      severity: "warning",
    },
    {
      field: "taglia_reggiseno",
      type: "regex",
      pattern: "^[1-6][A-F]$",
      message_it: "Formato taglia reggiseno non valido. Usa formato numerico+lettera (es: 3C, 4B).",
      severity: "warning",
    },
    {
      field: "colore",
      type: "required",
      message_it: "Colore non specificato. Quale colore desideri?",
      severity: "warning",
    },
  ],
  promptInstructions: `Questa e una categoria ABBIGLIAMENTO (vestiti, intimo, accessori).
Estrai anche per ogni articolo:
- taglia: la taglia del capo (XS, S, M, L, XL, XXL, o taglia numerica come 42, 44)
- colore: il colore richiesto
- materiale: il materiale se specificato
- genere: "uomo", "donna", "unisex" o "bambino" se deducibile
- taglia_reggiseno: per intimo/reggiseni usa il formato numerico+lettera (es: "3C", "4B")

REGOLE SPECIFICHE ABBIGLIAMENTO:
- Se il cliente dice "taglia M bianco" riferito a un capo, metti taglia="M" e colore="bianco"
- Se dice "reggiseno nero taglia C" o "coppa C", interpreta come taglia_reggiseno
- La taglia e OBBLIGATORIA per l'abbigliamento; se non specificata, aggiungi "taglia" a missing_fields
- Il colore e molto importante; se non specificato, aggiungi "colore" a missing_fields`,
  itemSchemaExample: `{
  "product": "Maglietta Basica",
  "quantity": 2,
  "unit_price": 15.90,
  "notes": null,
  "category_attributes": {
    "taglia": "M",
    "colore": "bianco",
    "materiale": "cotone",
    "genere": "donna",
    "taglia_reggiseno": null
  }
}`,
  seedExamples: [
    {
      input: "2 magliette bianche taglia M e un reggiseno nero taglia 3C. Per Anna Verdi, Via Toledo 22 Napoli, 3339876543",
      output: JSON.stringify({
        is_order: true,
        category: "abbigliamento",
        customer: { name: "Anna Verdi", phone: "+39 3339876543" },
        delivery: { street: "Via Toledo", number: "22", city: "Napoli", extra: null },
        items: [
          {
            product: "Maglietta Basica",
            quantity: 2,
            unit_price: null,
            notes: null,
            category_attributes: {
              taglia: "M",
              colore: "bianco",
              materiale: null,
              genere: "donna",
              taglia_reggiseno: null,
            },
          },
          {
            product: "Reggiseno",
            quantity: 1,
            unit_price: null,
            notes: null,
            category_attributes: {
              taglia: null,
              colore: "nero",
              materiale: null,
              genere: "donna",
              taglia_reggiseno: "3C",
            },
          },
        ],
        missing_fields: [],
      }),
    },
  ],
  detectionKeywords: [
    "maglietta", "maglia", "reggiseno", "slip", "boxer", "intimo",
    "pigiama", "vestito", "pantaloni", "gonna", "camicia",
    "taglia", "colore", "yamamay", "calzini", "calze",
    "body", "canottiera", "costume", "bikini", "coppa",
    "XS", "XL", "XXL",
  ],
  telegramItemFormat: "{quantity}x {product} - Taglia: {attr:taglia}, Colore: {attr:colore}",
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. GROCERY
// ═══════════════════════════════════════════════════════════════════════════

CATEGORY_REGISTRY.set(DealerCategory.GROCERY, {
  id: DealerCategory.GROCERY,
  label_it: "Supermercato & Grocery",
  description_it: "Spesa al supermercato, prodotti alimentari confezionati",
  icon: "\uD83D\uDED2", // shopping cart emoji
  attributeFields: [
    {
      name: "unita",
      type: "enum",
      enum_values: ["kg", "g", "l", "ml", "pezzi", "confezioni", "bottiglie", "lattine"],
      description_it: "Unita di misura della quantita",
      required: false,
    },
    {
      name: "brand",
      type: "string",
      description_it: "Marca/brand del prodotto",
      required: false,
    },
    {
      name: "variante",
      type: "string",
      description_it: "Variante prodotto (es: integrale, senza zucchero, light)",
      required: false,
    },
    {
      name: "peso_confezione",
      type: "string",
      description_it: "Peso/volume della confezione (es: 500g, 1l)",
      required: false,
    },
  ],
  validationRules: [
    {
      field: "unita",
      type: "enum",
      values: ["kg", "g", "l", "ml", "pezzi", "confezioni", "bottiglie", "lattine"],
      message_it: "Unita di misura non valida.",
      severity: "warning",
    },
    {
      field: "quantity",
      type: "range",
      min: 0.1,
      max: 100,
      message_it: "Quantita fuori range (0.1 - 100).",
      severity: "warning",
    },
  ],
  promptInstructions: `Questa e una categoria GROCERY (supermercato/spesa).
Estrai anche per ogni articolo:
- unita: l'unita di misura ("kg", "g", "l", "ml", "pezzi", "confezioni", "bottiglie", "lattine")
- brand: la marca se specificata (es: "Barilla", "Mulino Bianco")
- variante: variante del prodotto (es: "integrale", "light", "senza zucchero")
- peso_confezione: peso o volume della confezione singola (es: "500g", "1l")

REGOLE SPECIFICHE GROCERY:
- "2kg di pasta" = quantity: 2, unita: "kg", product: "Pasta"
- "1l di latte" = quantity: 1, unita: "l", product: "Latte"
- "6 uova" = quantity: 6, unita: "pezzi", product: "Uova"
- "3 bottiglie di acqua" = quantity: 3, unita: "bottiglie", product: "Acqua"
- Se il brand non e specificato, brand: null
- quantity rappresenta il NUMERO di unita, non il peso (quello va in peso_confezione)`,
  itemSchemaExample: `{
  "product": "Pasta Penne",
  "quantity": 2,
  "unit_price": 1.29,
  "notes": null,
  "category_attributes": {
    "unita": "confezioni",
    "brand": "Barilla",
    "variante": "integrale",
    "peso_confezione": "500g"
  }
}`,
  seedExamples: [
    {
      input: "2kg di pasta Barilla, 1l di latte intero Granarolo, 6 uova, 3 bottiglie acqua Levissima. Maria Bianchi, Via Chiaia 88 Napoli, 3281112233",
      output: JSON.stringify({
        is_order: true,
        category: "grocery",
        customer: { name: "Maria Bianchi", phone: "+39 3281112233" },
        delivery: { street: "Via Chiaia", number: "88", city: "Napoli", extra: null },
        items: [
          {
            product: "Pasta",
            quantity: 2,
            unit_price: null,
            notes: null,
            category_attributes: { unita: "kg", brand: "Barilla", variante: null, peso_confezione: null },
          },
          {
            product: "Latte Intero",
            quantity: 1,
            unit_price: null,
            notes: null,
            category_attributes: { unita: "l", brand: "Granarolo", variante: "intero", peso_confezione: "1l" },
          },
          {
            product: "Uova",
            quantity: 6,
            unit_price: null,
            notes: null,
            category_attributes: { unita: "pezzi", brand: null, variante: null, peso_confezione: null },
          },
          {
            product: "Acqua",
            quantity: 3,
            unit_price: null,
            notes: null,
            category_attributes: { unita: "bottiglie", brand: "Levissima", variante: null, peso_confezione: null },
          },
        ],
        missing_fields: [],
      }),
    },
  ],
  detectionKeywords: [
    "pasta", "latte", "uova", "pane", "riso", "olio", "farina",
    "zucchero", "sale", "burro", "formaggio", "mozzarella",
    "prosciutto", "salame", "yogurt", "cereali", "biscotti",
    "detersivo", "sapone", "supermercato", "spesa",
    "kg", "litri", "confezione", "bottiglia",
    "barilla", "mulino bianco", "granarolo",
  ],
  telegramItemFormat: "{quantity}{attr:unita? {attr:unita}} {product}{attr:brand? ({attr:brand})}",
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PET
// ═══════════════════════════════════════════════════════════════════════════

CATEGORY_REGISTRY.set(DealerCategory.PET, {
  id: DealerCategory.PET,
  label_it: "Articoli per Animali",
  description_it: "Cibo e accessori per animali domestici",
  icon: "\uD83D\uDC3E", // paw prints emoji
  attributeFields: [
    {
      name: "specie",
      type: "enum",
      enum_values: ["cane", "gatto", "criceto", "coniglio", "pesce", "uccello", "altro"],
      description_it: "Specie dell'animale",
      required: true,
    },
    {
      name: "taglia_animale",
      type: "enum",
      enum_values: ["piccola", "media", "grande", "gigante"],
      description_it: "Taglia dell'animale (per cibo/accessori)",
      required: false,
    },
    {
      name: "eta_animale",
      type: "enum",
      enum_values: ["cucciolo", "adulto", "senior"],
      description_it: "Eta dell'animale",
      required: false,
    },
    {
      name: "peso_confezione",
      type: "string",
      description_it: "Peso della confezione (es: 5kg, 400g)",
      required: false,
    },
    {
      name: "gusto",
      type: "string",
      description_it: "Gusto/sapore del cibo (es: pollo, salmone, manzo)",
      required: false,
    },
  ],
  validationRules: [
    {
      field: "specie",
      type: "required",
      message_it: "Per quale animale e il prodotto? (cane, gatto, etc.)",
      severity: "warning",
    },
    {
      field: "specie",
      type: "enum",
      values: ["cane", "gatto", "criceto", "coniglio", "pesce", "uccello", "altro"],
      message_it: "Specie non riconosciuta.",
      severity: "warning",
    },
  ],
  promptInstructions: `Questa e una categoria PET (articoli per animali).
Estrai anche per ogni articolo:
- specie: "cane", "gatto", "criceto", "coniglio", "pesce", "uccello" o "altro"
- taglia_animale: "piccola", "media", "grande", "gigante" (se specificato)
- eta_animale: "cucciolo", "adulto", "senior" (se specificato)
- peso_confezione: peso della confezione (es: "5kg", "400g")
- gusto: gusto/sapore se specificato (es: "pollo", "salmone")

REGOLE SPECIFICHE PET:
- "cibo cane taglia grande 5kg" = specie: "cane", taglia_animale: "grande", peso_confezione: "5kg"
- "giochetto gatto" = specie: "gatto", taglia_animale: null (non serve per giocattoli)
- "croccantini cucciolo pollo" = specie: dedotta dal contesto, eta_animale: "cucciolo", gusto: "pollo"
- La SPECIE e fondamentale: se non specificata, prova a dedurla dal prodotto, altrimenti aggiungi a missing_fields`,
  itemSchemaExample: `{
  "product": "Crocchette Royal Canin",
  "quantity": 1,
  "unit_price": 45.90,
  "notes": null,
  "category_attributes": {
    "specie": "cane",
    "taglia_animale": "grande",
    "eta_animale": "adulto",
    "peso_confezione": "5kg",
    "gusto": "pollo"
  }
}`,
  seedExamples: [
    {
      input: "cibo cane taglia grande 5kg gusto pollo, giochetto gatto con piume, 2 scatolette gatto adulto salmone. Luca Esposito, Via Manzoni 3 Napoli, 3405556677",
      output: JSON.stringify({
        is_order: true,
        category: "pet",
        customer: { name: "Luca Esposito", phone: "+39 3405556677" },
        delivery: { street: "Via Manzoni", number: "3", city: "Napoli", extra: null },
        items: [
          {
            product: "Cibo per Cani",
            quantity: 1,
            unit_price: null,
            notes: null,
            category_attributes: { specie: "cane", taglia_animale: "grande", eta_animale: null, peso_confezione: "5kg", gusto: "pollo" },
          },
          {
            product: "Giochetto con Piume",
            quantity: 1,
            unit_price: null,
            notes: null,
            category_attributes: { specie: "gatto", taglia_animale: null, eta_animale: null, peso_confezione: null, gusto: null },
          },
          {
            product: "Scatolette Salmone",
            quantity: 2,
            unit_price: null,
            notes: null,
            category_attributes: { specie: "gatto", taglia_animale: null, eta_animale: "adulto", peso_confezione: null, gusto: "salmone" },
          },
        ],
        missing_fields: [],
      }),
    },
  ],
  detectionKeywords: [
    "cane", "gatto", "cucciolo", "croccantini", "crocchette",
    "scatolette", "pettorina", "guinzaglio", "lettiera",
    "tiragraffi", "giochetto", "osso", "snack cane",
    "mangime", "pesce rosso", "criceto", "coniglio",
    "antiparassitario", "pet", "animale", "veterinario",
  ],
  telegramItemFormat: "{quantity}x {product} ({attr:specie}{attr:taglia_animale? - taglia {attr:taglia_animale}})",
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. FARMACIE
// ═══════════════════════════════════════════════════════════════════════════

CATEGORY_REGISTRY.set(DealerCategory.FARMACIE, {
  id: DealerCategory.FARMACIE,
  label_it: "Farmacia & Salute",
  description_it: "Farmaci, integratori, prodotti salute e benessere",
  icon: "\uD83D\uDC8A", // pill emoji
  attributeFields: [
    {
      name: "dosaggio",
      type: "string",
      description_it: "Dosaggio del farmaco (es: 500mg, 1000mg)",
      required: false,
    },
    {
      name: "quantita_confezioni",
      type: "number",
      description_it: "Numero di confezioni richieste",
      required: false,
    },
    {
      name: "forma",
      type: "enum",
      enum_values: ["compresse", "capsule", "sciroppo", "crema", "gocce", "bustine", "supposte", "altro"],
      description_it: "Forma farmaceutica",
      required: false,
    },
    {
      name: "tipo_ricetta",
      type: "enum",
      enum_values: ["senza_ricetta", "con_ricetta", "SOP", "OTC"],
      description_it: "Classificazione ricetta",
      required: false,
    },
    {
      name: "principio_attivo",
      type: "string",
      description_it: "Principio attivo del farmaco",
      required: false,
    },
    {
      name: "uso",
      type: "string",
      description_it: "Uso previsto/sintomo (es: mal di testa, febbre)",
      required: false,
    },
  ],
  validationRules: [
    {
      field: "tipo_ricetta",
      type: "custom",
      message_it: "ATTENZIONE: farmaco potenzialmente con obbligo di ricetta. Verificare classificazione.",
      severity: "warning",
    },
    {
      field: "dosaggio",
      type: "regex",
      pattern: "^\\d+\\s*(mg|g|ml|mcg|UI)$",
      message_it: "Formato dosaggio non standard. Usare formato numerico+unita (es: 500mg).",
      severity: "warning",
    },
  ],
  promptInstructions: `Questa e una categoria FARMACIE (farmaci, salute, benessere).
Estrai anche per ogni articolo:
- dosaggio: dosaggio se specificato (es: "500mg", "1000mg")
- quantita_confezioni: numero di confezioni se > 1
- forma: forma farmaceutica ("compresse", "capsule", "sciroppo", "crema", "gocce", "bustine", "supposte", "altro")
- tipo_ricetta: "senza_ricetta" (OTC/SOP) o "con_ricetta" se il farmaco richiede prescrizione
- principio_attivo: principio attivo se noto (es: "paracetamolo" per Tachipirina)
- uso: uso previsto se menzionato (es: "mal di testa", "febbre")

REGOLE SPECIFICHE FARMACIE:
- "Tachipirina 500mg" = product: "Tachipirina", dosaggio: "500mg", principio_attivo: "paracetamolo"
- "10 compresse" = forma: "compresse", la quantita (10) va in notes o nel nome prodotto, NON in quantity
- quantity = numero confezioni ordinate (default 1)
- Se non e chiaro se serve ricetta, tipo_ricetta: null
- FARMACI NOTI senza ricetta: Tachipirina, OKi, Moment, Aspirina, Enterogermina, vitamine
- Non inventare principi attivi se non sei sicuro`,
  itemSchemaExample: `{
  "product": "Tachipirina",
  "quantity": 1,
  "unit_price": 3.90,
  "notes": "10 compresse",
  "category_attributes": {
    "dosaggio": "500mg",
    "quantita_confezioni": 1,
    "forma": "compresse",
    "tipo_ricetta": "senza_ricetta",
    "principio_attivo": "paracetamolo",
    "uso": "febbre"
  }
}`,
  seedExamples: [
    {
      input: "Tachipirina 500mg 2 confezioni, vitamina C effervescente, cerotto termico. Giulia Romano, Via Caracciolo 44 Napoli, 3271234567",
      output: JSON.stringify({
        is_order: true,
        category: "farmacie",
        customer: { name: "Giulia Romano", phone: "+39 3271234567" },
        delivery: { street: "Via Caracciolo", number: "44", city: "Napoli", extra: null },
        items: [
          {
            product: "Tachipirina",
            quantity: 2,
            unit_price: null,
            notes: null,
            category_attributes: {
              dosaggio: "500mg",
              quantita_confezioni: 2,
              forma: "compresse",
              tipo_ricetta: "senza_ricetta",
              principio_attivo: "paracetamolo",
              uso: null,
            },
          },
          {
            product: "Vitamina C Effervescente",
            quantity: 1,
            unit_price: null,
            notes: null,
            category_attributes: {
              dosaggio: null,
              quantita_confezioni: 1,
              forma: "compresse",
              tipo_ricetta: "senza_ricetta",
              principio_attivo: "acido ascorbico",
              uso: null,
            },
          },
          {
            product: "Cerotto Termico",
            quantity: 1,
            unit_price: null,
            notes: null,
            category_attributes: {
              dosaggio: null,
              quantita_confezioni: 1,
              forma: "altro",
              tipo_ricetta: "senza_ricetta",
              principio_attivo: null,
              uso: "dolore",
            },
          },
        ],
        missing_fields: [],
      }),
    },
  ],
  detectionKeywords: [
    "tachipirina", "aspirina", "oki", "moment", "brufen",
    "farmaco", "medicina", "ricetta", "compresse", "capsule",
    "sciroppo", "pomata", "crema", "cerotto", "vitamina",
    "integratore", "antibiotico", "antistaminico",
    "farmacia", "parafarmacia", "dosaggio", "mg",
    "enterogermina", "imodium", "voltaren",
  ],
  telegramItemFormat: "{quantity}x {product}{attr:dosaggio? {attr:dosaggio}}{attr:forma? ({attr:forma})}",
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. CASA
// ═══════════════════════════════════════════════════════════════════════════

CATEGORY_REGISTRY.set(DealerCategory.CASA, {
  id: DealerCategory.CASA,
  label_it: "Casa & Arredamento",
  description_it: "Articoli per la casa, tessili, arredamento, utilita domestiche",
  icon: "\uD83C\uDFE0", // house emoji
  attributeFields: [
    {
      name: "dimensioni",
      type: "string",
      description_it: "Dimensioni dell'articolo (es: 200x200cm, 50x70cm)",
      required: false,
    },
    {
      name: "colore",
      type: "string",
      description_it: "Colore dell'articolo",
      required: false,
    },
    {
      name: "materiale",
      type: "string",
      description_it: "Materiale (cotone, microfibra, legno, ceramica, etc.)",
      required: false,
    },
    {
      name: "stanza",
      type: "string",
      description_it: "Stanza di destinazione (bagno, camera, cucina, soggiorno)",
      required: false,
    },
    {
      name: "stile",
      type: "string",
      description_it: "Stile estetico (moderno, classico, minimal, shabby chic)",
      required: false,
    },
  ],
  validationRules: [
    {
      field: "dimensioni",
      type: "regex",
      pattern: "^\\d+[x×X]\\d+\\s*(cm|mm|m)$",
      message_it: "Formato dimensioni non standard. Usa formato LxH con unita (es: 200x200cm).",
      severity: "warning",
    },
  ],
  promptInstructions: `Questa e una categoria CASA (arredamento, tessili, utilita domestiche).
Estrai anche per ogni articolo:
- dimensioni: dimensioni se specificate (es: "200x200cm", "50x70cm")
- colore: colore dell'articolo
- materiale: materiale (es: "cotone", "microfibra", "legno", "ceramica")
- stanza: stanza di destinazione se deducibile (es: "bagno", "camera", "cucina")
- stile: stile estetico se specificato (es: "moderno", "classico")

REGOLE SPECIFICHE CASA:
- "coperta grigia 200x200cm" = dimensioni: "200x200cm", colore: "grigio"
- "3 asciugamani bianchi" = quantity: 3, colore: "bianco"
- "set lenzuola matrimoniale" = dimensioni possono essere dedotte (es: "matrimoniale")
- Per tessili: il colore e quasi sempre importante
- Per mobili: le dimensioni sono importanti`,
  itemSchemaExample: `{
  "product": "Coperta Pile",
  "quantity": 1,
  "unit_price": 29.90,
  "notes": null,
  "category_attributes": {
    "dimensioni": "200x200cm",
    "colore": "grigio",
    "materiale": "pile",
    "stanza": "camera",
    "stile": null
  }
}`,
  seedExamples: [
    {
      input: "coperta grigia 200x200cm in pile, 3 asciugamani bianchi cotone per bagno, portasapone ceramica. Sofia Greco, Corso Umberto 12 Napoli, 3389998877",
      output: JSON.stringify({
        is_order: true,
        category: "casa",
        customer: { name: "Sofia Greco", phone: "+39 3389998877" },
        delivery: { street: "Corso Umberto", number: "12", city: "Napoli", extra: null },
        items: [
          {
            product: "Coperta in Pile",
            quantity: 1,
            unit_price: null,
            notes: null,
            category_attributes: { dimensioni: "200x200cm", colore: "grigio", materiale: "pile", stanza: "camera", stile: null },
          },
          {
            product: "Asciugamano Cotone",
            quantity: 3,
            unit_price: null,
            notes: null,
            category_attributes: { dimensioni: null, colore: "bianco", materiale: "cotone", stanza: "bagno", stile: null },
          },
          {
            product: "Portasapone",
            quantity: 1,
            unit_price: null,
            notes: null,
            category_attributes: { dimensioni: null, colore: null, materiale: "ceramica", stanza: "bagno", stile: null },
          },
        ],
        missing_fields: [],
      }),
    },
  ],
  detectionKeywords: [
    "coperta", "lenzuola", "asciugamano", "cuscino", "tenda",
    "tappeto", "portasapone", "specchio", "lampada", "vaso",
    "cornice", "mensola", "appendiabiti", "cestino",
    "tovaglia", "tovaglioli", "presina", "grembiule",
    "casa", "arredamento", "bagno", "camera", "cucina",
    "cotone", "microfibra", "200x200", "matrimoniale",
  ],
  telegramItemFormat: "{quantity}x {product}{attr:colore? ({attr:colore})}{attr:dimensioni? - {attr:dimensioni}}",
});

// ---------------------------------------------------------------------------
// HELPER FUNCTIONS
// ---------------------------------------------------------------------------

/**
 * Get a category definition by its enum value.
 * Returns undefined if the category is not registered.
 */
export function getCategoryDefinition(
  category: DealerCategory
): CategoryDefinition | undefined {
  return CATEGORY_REGISTRY.get(category);
}

/**
 * Get all registered category IDs.
 */
export function getAllCategoryIds(): DealerCategory[] {
  return Array.from(CATEGORY_REGISTRY.keys());
}

/**
 * Attempt to detect category from free text using keyword matching.
 * Returns the best-matching category or null if no strong match.
 * Used as a FALLBACK when dealer category is not known.
 */
export function detectCategoryFromText(text: string): DealerCategory | null {
  const normalized = text.toLowerCase();
  const scores = new Map<DealerCategory, number>();

  for (const [categoryId, definition] of CATEGORY_REGISTRY) {
    let score = 0;
    for (const keyword of definition.detectionKeywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        score++;
      }
    }
    if (score > 0) {
      scores.set(categoryId, score);
    }
  }

  if (scores.size === 0) return null;

  // Return the category with the highest keyword match count
  let bestCategory: DealerCategory | null = null;
  let bestScore = 0;

  for (const [category, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  // Require at least 2 keyword matches for confidence (unless only 1 category matched)
  if (bestScore < 2 && scores.size > 1) {
    return null;
  }

  return bestCategory;
}

/**
 * Validate a parsed item's category_attributes against the category's validation rules.
 * Returns an array of validation messages (empty if all valid).
 */
export function validateCategoryAttributes(
  category: DealerCategory,
  attributes: Record<string, any>
): Array<{ field: string; message: string; severity: "error" | "warning" }> {
  const definition = CATEGORY_REGISTRY.get(category);
  if (!definition) return [];

  const results: Array<{ field: string; message: string; severity: "error" | "warning" }> = [];

  for (const rule of definition.validationRules) {
    const value = attributes[rule.field];

    switch (rule.type) {
      case "required":
        if (value == null || value === "") {
          results.push({
            field: rule.field,
            message: rule.message_it,
            severity: rule.severity,
          });
        }
        break;

      case "enum":
        if (value != null && rule.values && !rule.values.includes(String(value).toUpperCase()) && !rule.values.includes(String(value).toLowerCase()) && !rule.values.includes(String(value))) {
          results.push({
            field: rule.field,
            message: rule.message_it,
            severity: rule.severity,
          });
        }
        break;

      case "range":
        if (value != null && (rule.min != null && value < rule.min || rule.max != null && value > rule.max)) {
          results.push({
            field: rule.field,
            message: rule.message_it,
            severity: rule.severity,
          });
        }
        break;

      case "regex":
        if (value != null && rule.pattern && !new RegExp(rule.pattern, "i").test(String(value))) {
          results.push({
            field: rule.field,
            message: rule.message_it,
            severity: rule.severity,
          });
        }
        break;

      case "custom":
        // Custom rules are always flagged as warnings for manual review
        if (value != null && (Array.isArray(value) ? value.length > 0 : true)) {
          results.push({
            field: rule.field,
            message: rule.message_it,
            severity: rule.severity,
          });
        }
        break;
    }
  }

  return results;
}
