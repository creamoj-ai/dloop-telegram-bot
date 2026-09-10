# DIFF: supabase/functions/customer-page/index.ts

## Modifiche:
1. Riceve dropoff_point, dropoff_lat, dropoff_lng, delivery_notes dal body
2. Salva i nuovi campi in orders
3. Fix bug: usa delivery_address invece di dropoff_address (schema corretto)

---

```diff
--- a/supabase/functions/customer-page/index.ts
+++ b/supabase/functions/customer-page/index.ts
@@ -28,6 +28,7 @@
   id: string;
   dealer_contact_id: string; // FK to dealers (schema uses dealer_contact_id)
   pickup_address: string; // Text address (schema uses pickup_address)
   payment_mode: string;
   package_size: string;
   package_count: number;
   is_fragile: boolean;
   customer_token: string;
   token_expires_at: string;
   status: string;
-  dropoff_address?: string; // Schema uses dropoff_address for delivery
+  delivery_address?: string; // Schema uses delivery_address
+  dropoff_point?: string;
+  dropoff_lat?: number;
+  dropoff_lng?: number;
+  delivery_notes?: string;
   customer_name?: string; // Schema uses customer_name
   customer_phone?: string; // Schema uses customer_phone
   notes?: string;
 }

@@ -213,8 +217,12 @@

   const recipientName = body.recipient_name?.toString().trim() || "";
   const recipientPhone = body.recipient_phone?.toString().trim() || "";
   const deliveryAddress = body.delivery_address?.toString().trim() || "";
+  const dropoffPoint = body.delivery_address?.toString().trim() || ""; // Formatted address da Geoapify
+  const dropoffLat = body.dropoff_lat ? parseFloat(body.dropoff_lat.toString()) : null;
+  const dropoffLng = body.dropoff_lng ? parseFloat(body.dropoff_lng.toString()) : null;
+  const deliveryNotes = body.delivery_notes?.toString().trim() || "";
   const notes = body.notes?.toString().trim() || "";

   // Validazione (stessa logica di prima)
   const errors: string[] = [];

   if (!recipientName) {
@@ -232,6 +240,11 @@
     errors.push("Inserisci indirizzo completo: via, civico, città o CAP");
   }

+  // Verifica coordinate Geoapify
+  if (dropoffLat === null || dropoffLng === null) {
+    errors.push("Coordinate consegna non valide. Seleziona un indirizzo dalla lista.");
+  }
+
   if (errors.length > 0) {
     return new Response(
       JSON.stringify({ success: false, error: errors.join(", ") }),
@@ -251,18 +264,24 @@
   // Update ordine: compila dati cliente + trigger broadcast
   // Setta broadcast_tier=0 e broadcast_started_at per triggerare escalation-tick
   const updateData: Record<string, unknown> = {
-    dropoff_address: deliveryAddress, // Schema uses dropoff_address
+    delivery_address: deliveryAddress, // FIX: schema usa delivery_address, non dropoff_address
+    dropoff_point: dropoffPoint, // Formatted address Geoapify
+    dropoff_lat: dropoffLat,
+    dropoff_lng: dropoffLng,
+    delivery_notes: deliveryNotes, // Dettagli consegna separati
     customer_name: recipientName, // Schema uses customer_name
     customer_phone: recipientPhone, // Schema uses customer_phone
     status: "pending", // Rimane pending, escalation-tick gestirà il broadcast
     delivery_pin: deliveryPin,
     broadcast_tier: 0, // Tier iniziale (top reputation)
     broadcast_started_at: new Date().toISOString(), // Trigger broadcast
   };

-  // Add notes only if column exists (might not be in schema)
+  // Add notes se presenti
   if (notes) {
-    updateData.customer_address = deliveryAddress; // Use customer_address for full details if notes doesn't exist
+    updateData.notes = notes;
   }

   const { error: updateError } = await supabase
@@ -307,7 +326,9 @@
         `Ordine: #${orderShortId}\n` +
         `Cliente: ${recipientName}\n` +
         `Telefono: ${recipientPhone}\n` +
         `Consegna: ${deliveryAddress}\n` +
+        (deliveryNotes ? `Dettagli: ${deliveryNotes}\n` : '') +
         `${packageInfo.length > 0 ? `Pacco: ${packageInfo.join(', ')}\n` : ''}` +
         `\n**L'ordine è pronto per il ritiro?**`;
```

---

## Note:
- **Fix bug**: lo schema usa `delivery_address`, non `dropoff_address`
- Ora salva anche `dropoff_point` (formatted), `dropoff_lat`, `dropoff_lng`, `delivery_notes`
- Validazione lato backend per coordinate obbligatorie
