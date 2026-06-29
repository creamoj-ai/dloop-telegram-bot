# AI Modules — Congelati

**Motivo:** Dloop e' SaaS puro. Il flusso ordine NON include parsing articoli/prezzi.

Questi moduli servivano per:
- Parsing AI ordini con Claude Haiku (articoli, quantita, prezzi)
- 6 categorie vertical (food, abbigliamento, grocery, pet, farmacie, casa)
- Validazione attributi categoria-specific

## Quando riabilitarli

Se in futuro `mode: commerce` richiedera' raccolta strutturata articoli (senza processing pagamento), questi moduli sono pronti per essere integrati nel flusso `/nuovo_ordine_commerce`.

**NON cancellare.** Sono gia' Deno-compatibili (o quasi).

## File congelati

- `order-parser.ts` — Claude Haiku multi-category parser
- `category-definitions.ts` — 6 vertical con schema, validation, prompt
- `multi-category-types.ts` — Tipi TypeScript per sistema multi-categoria
