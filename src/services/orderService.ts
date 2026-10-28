import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import { getDefaultMenuDocs } from '../data/menuImages';
import type {
  CartItem,
  DiningOption,
  OrderDoc,
  OrderItemDoc,
  StripeVerificationResult,
} from '../types';

export async function seedDefaultMenuToFirestore(): Promise<void> {
  const batch = writeBatch(db);
  const defaults = getDefaultMenuDocs();

  for (const item of defaults) {
    const itemRef = doc(db, 'menuItems', item.id);
    let exists = false;
    try {
      const existingSnap = await getDoc(itemRef);
      exists = existingSnap.exists();
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, `menuItems/${item.id}`);
    }

    if (exists) {
      batch.update(itemRef, {
        name: item.name,
        description: item.description,
        category: item.category,
        pricePence: item.pricePence,
        imageUrl: item.imageUrl,
        dietaryNote: item.dietaryNote,
        available: item.available,
        sortOrder: item.sortOrder,
        updatedAt: serverTimestamp(),
      });
    } else {
      batch.set(itemRef, {
        name: item.name,
        description: item.description,
        category: item.category,
        pricePence: item.pricePence,
        imageUrl: item.imageUrl,
        dietaryNote: item.dietaryNote,
        available: item.available,
        sortOrder: item.sortOrder,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'menuItems');
  }
}

export interface CreateCheckoutResponse {
  orderId: string;
  sessionId: string;
  hostedUrl: string;
  orderNumber: string;
  totalPence: number;
}

export async function initiateStripeOrder(params: {
  cart: CartItem[];
  diningOption: DiningOption;
  tableOrNote: string;
}): Promise<CreateCheckoutResponse> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.email) {
    throw new Error('Please sign in with Google before starting Stripe Checkout.');
  }

  const idToken = await currentUser.getIdToken();

  const res = await fetch('/api/stripe/create-checkout-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      items: params.cart.map((c) => ({
        itemId: c.item.id,
        quantity: c.quantity,
      })),
      diningOption: params.diningOption,
    }),
  });

  let payload: {
    error?: string;
    sessionId?: string;
    hostedUrl?: string;
    orderNumber?: string;
    validatedItems?: Array<{
      menuItemId: string;
      name: string;
      unitPricePence: number;
      quantity: number;
      lineTotalPence: number;
    }>;
    totalQuantity?: number;
    totalPence?: number;
  };

  try {
    payload = (await res.json()) as typeof payload;
  } catch {
    throw new Error(
      `Payment server returned HTTP ${res.status}. Ensure STRIPE_SECRET_KEY is configured and redeployed.`
    );
  }

  if (
    !res.ok ||
    !payload.sessionId ||
    !payload.hostedUrl ||
    !payload.validatedItems ||
    !payload.orderNumber
  ) {
    throw new Error(payload.error || 'Could not create Stripe Checkout session.');
  }

  const orderRef = doc(collection(db, 'orders'));
  const orderId = orderRef.id;

  const safeCustomerName = (
    currentUser.displayName ||
    currentUser.email.split('@')[0] ||
    'Guest'
  )
    .trim()
    .slice(0, 100);
  const safeEmail = currentUser.email.trim().slice(0, 160);
  const safeNote = params.tableOrNote.trim().slice(0, 120);
  const itemsSummary = payload.validatedItems
    .map((line) => `${line.quantity}x ${line.name}`)
    .join(', ')
    .slice(0, 500);

  const batch = writeBatch(db);

  batch.set(orderRef, {
    orderNumber: payload.orderNumber,
    userId: currentUser.uid,
    customerName: safeCustomerName,
    customerEmail: safeEmail,
    diningOption: params.diningOption,
    tableOrNote: safeNote,
    itemsSummary,
    itemCount: payload.totalQuantity ?? 1,
    totalPence: payload.totalPence ?? 100,
    currency: 'gbp',
    status: 'pending',
    paymentStatus: 'unpaid',
    stripeSessionId: payload.sessionId,
    stripePaymentIntentId: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  payload.validatedItems.forEach((line, index) => {
    const lineId = `line_${index + 1}_${line.menuItemId}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
    const lineRef = doc(db, 'orders', orderId, 'items', lineId);
    batch.set(lineRef, {
      orderId,
      userId: currentUser.uid,
      menuItemId: line.menuItemId,
      name: line.name.slice(0, 80),
      unitPricePence: line.unitPricePence,
      quantity: line.quantity,
      lineTotalPence: line.lineTotalPence,
      createdAt: serverTimestamp(),
    });
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `orders/${orderId}`);
  }

  try {
    sessionStorage.setItem(`bistro_order_${payload.sessionId}`, orderId);
  } catch {
    // Ignore storage quota errors
  }

  return {
    orderId,
    sessionId: payload.sessionId,
    hostedUrl: payload.hostedUrl,
    orderNumber: payload.orderNumber,
    totalPence: payload.totalPence ?? 100,
  };
}

export async function verifyStripeSessionOnServer(
  sessionId: string
): Promise<StripeVerificationResult> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Please sign in to verify payment.');
  }
  const idToken = await currentUser.getIdToken();

  const res = await fetch('/api/stripe/verify-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ sessionId }),
  });

  const data = (await res.json()) as StripeVerificationResult & { error?: string };
  if (!res.ok) {
    throw new Error(data.error || 'Unable to verify Stripe payment status.');
  }
  return data;
}

export async function confirmOrderPaidInFirestore(params: {
  sessionId: string;
  knownOrderId?: string;
}): Promise<{ verification: StripeVerificationResult; orderId: string | null }> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('Authentication required to confirm order payment.');
  }

  const verification = await verifyStripeSessionOnServer(params.sessionId);
  if (!verification.verified) {
    return { verification, orderId: params.knownOrderId || null };
  }

  let targetOrderId = params.knownOrderId || null;
  if (!targetOrderId) {
    try {
      targetOrderId = sessionStorage.getItem(`bistro_order_${params.sessionId}`);
    } catch {
      targetOrderId = null;
    }
  }

  if (!targetOrderId) {
    const ordersPath = 'orders';
    try {
      const q = query(
        collection(db, 'orders'),
        where('userId', '==', currentUser.uid),
        where('stripeSessionId', '==', params.sessionId)
      );
      const snap = await getDocs(q);
      if (!snap.empty) {
        targetOrderId = snap.docs[0].id;
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.LIST, ordersPath);
    }
  }

  if (targetOrderId) {
    const orderPath = `orders/${targetOrderId}`;
    const orderRef = doc(db, 'orders', targetOrderId);
    let currentOrder: OrderDoc | null = null;
    try {
      const orderSnap = await getDoc(orderRef);
      if (orderSnap.exists()) {
        currentOrder = { id: orderSnap.id, ...(orderSnap.data() as Omit<OrderDoc, 'id'>) };
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, orderPath);
    }

    if (
      currentOrder &&
      currentOrder.paymentStatus === 'unpaid' &&
      currentOrder.status === 'pending'
    ) {
      try {
        await updateDoc(orderRef, {
          status: 'paid',
          paymentStatus: 'paid',
          stripePaymentIntentId: verification.paymentIntentId,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, orderPath);
      }
    }
  }

  return { verification, orderId: targetOrderId };
}

export async function cancelCustomerPendingOrder(orderId: string): Promise<void> {
  const path = `orders/${orderId}`;
  try {
    await updateDoc(doc(db, 'orders', orderId), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function fetchOrderLineItems(
  orderId: string,
  ownerUid: string,
  isBootstrapAdmin: boolean
): Promise<OrderItemDoc[]> {
  const path = `orders/${orderId}/items`;
  try {
    const itemsCol = collection(db, 'orders', orderId, 'items');
    const q = isBootstrapAdmin
      ? query(itemsCol)
      : query(itemsCol, where('userId', '==', ownerUid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<OrderItemDoc, 'id'>),
    }));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}
