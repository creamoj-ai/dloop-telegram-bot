// ============================================================================
// DLOOP TELEGRAM BOT - TEST UTILITIES & MOCK DATA
// ============================================================================
// Use this file to test the bot locally without making real API calls

import { Order, Dealer, Rider, OrderStatus, PaymentStatus, RiderStatus } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// MOCK DATA
// ─────────────────────────────────────────────────────────────────────────

export const mockDealers: Record<string, Dealer> = {
  yamamay_napoli_1: {
    id: "yamamay_napoli_1",
    name: "Yamamay Napoli 1",
    phone: "+39 081 1234567",
    telegram_user_id: "1234567890", // Change to your test dealer ID
    address: "Via Toledo 123, Napoli",
    location: {
      latitude: 40.8356,
      longitude: 14.2681,
    },
    status: "active",
    created_at: new Date().toISOString(),
  },
  piccolo_merchant: {
    id: "piccolo_merchant",
    name: "Piccolo Merchant",
    phone: "+39 320 9876543",
    telegram_user_id: "9876543210",
    address: "Via Roma 10, Napoli",
    location: {
      latitude: 40.8534,
      longitude: 14.2765,
    },
    status: "active",
    created_at: new Date().toISOString(),
  },
};

export const mockRiders: Record<string, Rider> = {
  rider_001: {
    id: "rider_001",
    name: "Marco Rossi",
    phone: "+39 320 1111111",
    vehicle_type: "motorcycle",
    status: RiderStatus.ONLINE,
    firebase_fcm_token: "fake_fcm_token_001",
    vat_id: "IT12345678901",
    current_location: {
      latitude: 40.836,
      longitude: 14.268,
      updated_at: new Date().toISOString(),
    },
    earnings_week: 85.5,
    orders_completed_week: 12,
    created_at: new Date().toISOString(),
  },
  rider_002: {
    id: "rider_002",
    name: "Giovanni Bianchi",
    phone: "+39 320 2222222",
    vehicle_type: "bike",
    status: RiderStatus.ONLINE,
    firebase_fcm_token: "fake_fcm_token_002",
    vat_id: "IT98765432109",
    current_location: {
      latitude: 40.852,
      longitude: 14.277,
      updated_at: new Date().toISOString(),
    },
    earnings_week: 120.0,
    orders_completed_week: 18,
    created_at: new Date().toISOString(),
  },
  rider_003: {
    id: "rider_003",
    name: "Anna Verdi",
    phone: "+39 320 3333333",
    vehicle_type: "motorcycle",
    status: RiderStatus.OFFLINE,
    firebase_fcm_token: "fake_fcm_token_003",
    vat_id: "IT11111111111",
    earnings_week: 0,
    orders_completed_week: 0,
    created_at: new Date().toISOString(),
  },
};

export const mockOrder: Order = {
  id: "order_001",
  dealer_id: "yamamay_napoli_1",
  customer_name: "Marco Rossi",
  customer_phone: "+39 320 1234567",
  customer_address: "Via Roma 10, Napoli",
  items: [
    {
      name: "Pizza Margherita",
      quantity: 2,
      unit_price: 8.5,
      subtotal: 17.0,
    },
    {
      name: "Panettone",
      quantity: 1,
      unit_price: 12.0,
      subtotal: 12.0,
    },
  ],
  total_amount: 29.0,
  stripe_fee_amount: 1.015,
  total_with_fee: 30.015,
  status: OrderStatus.PENDING,
  payment_status: PaymentStatus.PENDING,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// ─────────────────────────────────────────────────────────────────────────
// TEST HELPERS
// ─────────────────────────────────────────────────────────────────────────

/**
 * Format order for display in Telegram message
 */
export function formatOrderForTelegram(order: Order): string {
  let message = `📋 **Ordine #${order.id.slice(0, 8).toUpperCase()}**\n\n`;
  message += `🏪 Dealer: ${order.dealer_id}\n`;
  message += `👤 Cliente: ${order.customer_name}\n`;
  message += `📱 Tel: ${order.customer_phone}\n`;
  message += `📍 Indirizzo: ${order.customer_address}\n\n`;

  message += `**Articoli:**\n`;
  order.items?.forEach((item) => {
    message += `• ${item.name} x${item.quantity} = €${item.subtotal.toFixed(2)}\n`;
  });

  message += `\n💰 Subtotale: €${order.total_amount?.toFixed(2)}\n`;
  message += `📊 Fee Stripe (3.5%): €${order.stripe_fee_amount?.toFixed(2)}\n`;
  message += `💳 **Totale: €${order.total_with_fee?.toFixed(2)}**\n`;

  return message;
}

/**
 * Test if price calculation is correct
 */
export function validateOrderPricing(order: Order): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check item totals
  let calculatedSubtotal = 0;
  order.items?.forEach((item) => {
    const expectedSubtotal = item.quantity * item.unit_price;
    if (Math.abs(item.subtotal - expectedSubtotal) > 0.01) {
      errors.push(
        `Item ${item.name}: subtotal mismatch (${item.subtotal} vs ${expectedSubtotal})`
      );
    }
    calculatedSubtotal += item.subtotal;
  });

  // Check order total
  if (Math.abs(order.total_amount! - calculatedSubtotal) > 0.01) {
    errors.push(
      `Order total mismatch: ${order.total_amount} vs ${calculatedSubtotal}`
    );
  }

  // Check Stripe fee (3.5%)
  const expectedFee = order.total_amount! * 0.035;
  if (Math.abs(order.stripe_fee_amount! - expectedFee) > 0.01) {
    errors.push(
      `Stripe fee mismatch: ${order.stripe_fee_amount} vs ${expectedFee}`
    );
  }

  // Check total with fee
  const expectedTotal = order.total_amount! + order.stripe_fee_amount!;
  if (Math.abs(order.total_with_fee! - expectedTotal) > 0.01) {
    errors.push(
      `Total with fee mismatch: ${order.total_with_fee} vs ${expectedTotal}`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Simulate user input for multi-step command
 */
export interface SimulatedUserSession {
  chatId: number;
  steps: string[]; // Sequence of user inputs
  expectedResponses?: string[]; // Expected bot responses (partial match)
}

export const testSession1: SimulatedUserSession = {
  chatId: 123456789,
  steps: [
    "/start_order", // Start command
    "yamamay_napoli_1", // Dealer ID
    "Marco Rossi", // Customer name
    "+39 320 1234567", // Phone
    "Via Roma 10, Napoli", // Address
    "Pizza Margherita", // Item 1 name
    "8.50", // Item 1 price
    "2", // Item 1 quantity
    "Panettone", // Item 2 name
    "12.00", // Item 2 price
    "1", // Item 2 quantity
    "/confirm", // Complete order
  ],
  expectedResponses: [
    "Quale dealer?",
    "Nome cliente?",
    "Numero telefono?",
    "Indirizzo?",
    "Nome primo articolo?",
    "Prezzo unitario?",
    "Quantità?",
    "Totale attuale",
    "Riepilogo Ordine",
    "Confermi?",
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// UNIT TESTS
// ─────────────────────────────────────────────────────────────────────────

export function runTests(): void {
  console.log("🧪 Running Dloop Bot unit tests...\n");

  // Test 1: Order pricing validation
  console.log("Test 1: Order pricing validation");
  const validation = validateOrderPricing(mockOrder);
  if (validation.valid) {
    console.log("✅ PASS: Order pricing correct\n");
  } else {
    console.log("❌ FAIL: Order pricing errors:");
    validation.errors.forEach((err) => console.log(`  - ${err}`));
    console.log();
  }

  // Test 2: Dealer mock data
  console.log("Test 2: Mock dealer data");
  const dealer = mockDealers.yamamay_napoli_1;
  if (dealer && dealer.id && dealer.location?.latitude) {
    console.log("✅ PASS: Dealer data valid\n");
  } else {
    console.log("❌ FAIL: Dealer data invalid\n");
  }

  // Test 3: Riders mock data
  console.log("Test 3: Mock riders data");
  const onlineRiders = Object.values(mockRiders).filter(
    (r) => r.status === RiderStatus.ONLINE
  );
  if (onlineRiders.length >= 2) {
    console.log(`✅ PASS: ${onlineRiders.length} online riders found\n`);
  } else {
    console.log("❌ FAIL: Not enough online riders\n");
  }

  // Test 4: Order formatting
  console.log("Test 4: Order formatting");
  const formatted = formatOrderForTelegram(mockOrder);
  if (formatted.includes("Marco Rossi") && formatted.includes("€30.02")) {
    console.log("✅ PASS: Order formatted correctly\n");
  } else {
    console.log("❌ FAIL: Order formatting issue\n");
  }

  // Test 5: Test session validity
  console.log("Test 5: Test session validity");
  if (
    testSession1.steps.length > 0 &&
    testSession1.steps[0] === "/start_order"
  ) {
    console.log(`✅ PASS: Test session valid (${testSession1.steps.length} steps)\n`);
  } else {
    console.log("❌ FAIL: Test session invalid\n");
  }

  console.log("✅ All tests completed!");
}

// ─────────────────────────────────────────────────────────────────────────
// EXPORT FOR CLI TESTING
// ─────────────────────────────────────────────────────────────────────────

// Run with: npx ts-node test-utils.ts
if (require.main === module) {
  runTests();
}
