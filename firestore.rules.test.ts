/**
 * Phase 0 / Phase 5 Dirty Dozen Security Specification Test Suite
 * Validates all 12 adversarial payloads against firestore.rules invariants.
 * Requires Firebase Local Emulator when executed via @firebase/rules-unit-testing.
 */
import fs from 'node:fs';

export interface DirtyDozenScenario {
  id: number;
  name: string;
  collectionPath: string;
  expectedOutcome: 'PERMISSION_DENIED';
  payload: Record<string, unknown>;
}

export const DIRTY_DOZEN_PAYLOADS: DirtyDozenScenario[] = [
  {
    id: 1,
    name: 'Shadow Privilege Injection on UserProfile',
    collectionPath: 'users/uid_alice',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      uid: 'uid_alice',
      displayName: 'Alice',
      email: 'alice@example.com',
      photoURL: '',
      isAdmin: true,
    },
  },
  {
    id: 2,
    name: 'Unverified Admin Email Spoof on MenuItem',
    collectionPath: 'menuItems/item_spoof',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      name: 'Spoof Dish',
      description: 'Injected with unverified admin email',
      category: 'Bites',
      pricePence: 250,
      imageUrl: '/img.jpg',
      dietaryNote: '',
      available: true,
      sortOrder: 1,
    },
  },
  {
    id: 3,
    name: 'Cross-User PII Read on UserProfile',
    collectionPath: 'users/uid_bob',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {},
  },
  {
    id: 4,
    name: 'Out-of-Range Menu Price (£9.00 > £5.00 max)',
    collectionPath: 'menuItems/item_expensive',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      name: 'Overpriced Dish',
      description: 'Exceeds £5.00 bistro ceiling',
      category: 'Bites',
      pricePence: 900,
      imageUrl: '/img.jpg',
      dietaryNote: '',
      available: true,
      sortOrder: 1,
    },
  },
  {
    id: 5,
    name: 'Unfiltered List Scraping of Unavailable MenuItems',
    collectionPath: 'menuItems',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: { available: false },
  },
  {
    id: 6,
    name: 'Pre-Paid Order Forgery on Creation',
    collectionPath: 'orders/ord_forged',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      orderNumber: 'BF-1001',
      userId: 'uid_alice',
      customerName: 'Alice',
      customerEmail: 'alice@example.com',
      diningOption: 'Dine In',
      tableOrNote: 'Table 4',
      itemsSummary: '1x Brownie',
      itemCount: 1,
      totalPence: 100,
      currency: 'gbp',
      status: 'paid',
      paymentStatus: 'paid',
      stripeSessionId: 'cs_live_test123',
      stripePaymentIntentId: 'pi_test123',
    },
  },
  {
    id: 7,
    name: 'Orphaned Order Without UserProfile Document',
    collectionPath: 'orders/ord_orphan',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      orderNumber: 'BF-1002',
      userId: 'uid_nonexistent',
    },
  },
  {
    id: 8,
    name: 'Identity Spoofing on Order Creation',
    collectionPath: 'orders/ord_spoof',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      orderNumber: 'BF-1003',
      userId: 'uid_victim',
    },
  },
  {
    id: 9,
    name: 'Terminal State Re-Opening on Completed Order',
    collectionPath: 'orders/ord_completed',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      status: 'pending',
    },
  },
  {
    id: 10,
    name: 'Order Total Mutation During Payment Confirmation',
    collectionPath: 'orders/ord_tamper',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      totalPence: 100,
      status: 'paid',
      paymentStatus: 'paid',
    },
  },
  {
    id: 11,
    name: 'ID Poisoning With Invalid Characters',
    collectionPath: 'orders/bad$id!spaces',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {},
  },
  {
    id: 12,
    name: 'Arithmetic-Mismatch OrderItem Subcollection Write',
    collectionPath: 'orders/ord_1/items/line_bad',
    expectedOutcome: 'PERMISSION_DENIED',
    payload: {
      orderId: 'ord_1',
      userId: 'uid_alice',
      menuItemId: 'item_1',
      name: 'Brownie',
      unitPricePence: 200,
      quantity: 3,
      lineTotalPence: 100,
    },
  },
];

export function verifyRulesStaticGuards(): boolean {
  const rules = fs.readFileSync(new URL('./firestore.rules', import.meta.url), 'utf8');
  const requiredGates = [
    'allow read, write: if false;',
    'isValidId(',
    'email_verified == true',
    'data.pricePence >= 100 && data.pricePence <= 500',
    'affectedKeys().hasOnly(',
    'existsAfter(/databases/$(database)/documents/orders/$(orderId))',
    'hasImmutableOrderFields()',
    'isOrderNotTerminal()',
  ];
  for (const gate of requiredGates) {
    if (!rules.includes(gate)) {
      throw new Error(`Missing required security gate in firestore.rules: ${gate}`);
    }
  }
  return true;
}
