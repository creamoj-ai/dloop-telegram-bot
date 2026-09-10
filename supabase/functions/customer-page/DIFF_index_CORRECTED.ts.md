# DIFF: supabase/functions/customer-page/index.ts (CORRETTO - schema reale)

## Modifiche:
1. Riceve `dropoff_address` (non delivery_address), `dropoff_lat`, `dropoff_lng`, `delivery_notes`
2. Salva in `dropoff_address` (TEXT esistente)
3. NON scrive in `dropoff_point` (geography) - resta NULL
4. NON scrive in `delivery_address` (non esiste)

---

```diff
--- a/supabase/functions/customer-page/index.ts
+++ b/supabase/functions/customer-page/index.ts
@@ -27,7 +27,11 @@
 interface OrderData {
   id: string;
   dealer_contact_id: string;
   pickup_address: string;
   payment_mode: string;
   package_size: string;
   package_count: number;
   is_fragile: boolean;
   customer_token: string;
   token_expires_at: string;
   status: string;
-  dropoff_address?: string;
+  dropoff_address?: string;  // Indirizzo formattato Geoapify (TEXT)
+  dropoff_lat?: number;
+  dropoff_lng?: number;
+  delivery_notes?: string;
   customer_name?: string;
   customer_phone?: string;
   notes?: string;
@@ -213,8 +217,12 @@

   const recipientName = body.recipient_name?.toString().trim() || "";
   const recipientPhone = body.recipient_phone?.toString().trim() || "";
-  const deliveryAddress = body.delivery_address?.toString().trim() || "";
+  const dropoffAddress = body.dropoff_address?.toString().trim() || "";
+  const dropoffLat = body.dropoff_lat ? parseFloat(body.dropoff_lat.toString()) : null;
+  const dropoffLng = body.dropoff_lng ? parseFloat(body.dropoff_lng.toString()) : null;
+  const deliveryNotes = body.delivery_notes?.toString().trim() || "";
   const notes = body.notes?.toString().trim() || "";

   // Validazione
   const errors: string[] = [];

   if (!recipientName) {
@@ -226,11 +234,16 @@
     errors.push("Telefono non valido (inserisci numero italiano valido)");
   }

-  if (!deliveryAddress) {
+  if (!dropoffAddress) {
     errors.push("Indirizzo di consegna obbligatorio");
-  } else if (!isValidAddress(deliveryAddress)) {
-    errors.push("Inserisci indirizzo completo: via, civico, città o CAP");
+  }
+
+  // Verifica coordinate Geoapify
+  if (dropoffLat === null || dropoffLng === null) {
+    errors.push("Coordinate consegna non valide. Seleziona un indirizzo dalla lista.");
   }

   if (errors.length > 0) {
@@ -251,18 +264,20 @@
   // Update ordine: compila dati cliente + trigger broadcast
   const updateData: Record<string, unknown> = {
-    dropoff_address: deliveryAddress,
+    dropoff_address: dropoffAddress,  // Indirizzo formattato (TEXT esistente)
+    dropoff_lat: dropoffLat,           // Coordinate Geoapify
+    dropoff_lng: dropoffLng,
+    delivery_notes: deliveryNotes,     // Dettagli consegna separati
     customer_name: recipientName,
     customer_phone: recipientPhone,
     status: "pending",
     delivery_pin: deliveryPin,
     broadcast_tier: 0,
     broadcast_started_at: new Date().toISOString(),
+    // dropoff_point (geography) NON viene toccato - resta NULL
   };

-  // Add notes only if column exists
+  // Add notes se presenti
   if (notes) {
-    updateData.customer_address = deliveryAddress;
+    updateData.notes = notes;
   }

   const { error: updateError } = await supabase
@@ -317,7 +332,8 @@
         `Ordine: #${orderShortId}\n` +
         `Cliente: ${recipientName}\n` +
         `Telefono: ${recipientPhone}\n` +
-        `Consegna: ${deliveryAddress}\n` +
+        `Consegna: ${dropoffAddress}\n` +
+        (deliveryNotes ? `Dettagli: ${deliveryNotes}\n` : '') +
         `${packageInfo.length > 0 ? `Pacco: ${packageInfo.join(', ')}\n` : ''}` +
         `\n**L'ordine è pronto per il ritiro?**`;

```

---

## Punti chiave:
- ✅ `dropoff_address` (TEXT esistente) per indirizzo formattato
- ✅ `dropoff_lat/lng` (double precision) per coordinate
- ✅ `delivery_notes` per dettagli consegna
- ✅ `dropoff_point` (geography) NON viene scritto - resta NULL
- ✅ Rimossa riga buggy `customer_address = deliveryAddress`
