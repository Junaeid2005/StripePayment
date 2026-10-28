import fs from 'node:fs';
import Stripe from 'stripe';
import firebaseConfigJson from '../../firebase-applet-config.json';
import { DEFAULT_CATALOG_ITEMS, PRIMARY_ADMIN_EMAIL } from '../../src/shared/catalogData';

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

function loadFirebaseConfig(): FirebaseAppletConfig {
  return firebaseConfigJson as FirebaseAppletConfig;
}

export interface RuntimeStripeKeys {
  secretKey: string;
  publishableKey: string;
}

const ISOLATED_RUNTIME_SECRETS_PATH = '/tmp/stripe-runtime-secrets.json';

function getStripeKeySignature(key: string): string | null {
  const match = key.match(/^(?:sk|rk|pk)_(live|test)_([a-zA-Z0-9]{10})/);
  if (!match) return null;
  return `${match[1]}_${match[2]}`;
}

export function loadRuntimeStripeKeys(): RuntimeStripeKeys {
  let fileSecret = '';
  let filePublishable = '';

  try {
    if (fs.existsSync(ISOLATED_RUNTIME_SECRETS_PATH)) {
      const parsed = JSON.parse(
        fs.readFileSync(ISOLATED_RUNTIME_SECRETS_PATH, 'utf8')
      ) as Partial<RuntimeStripeKeys>;
      fileSecret = (parsed.secretKey || '').trim();
      filePublishable = (parsed.publishableKey || '').trim();
    }
  } catch {
    // Ignore isolated runtime file read errors
  }

  const envSecret = (process.env.STRIPE_SECRET_KEY || '').trim();
  const envPublishable = (
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.VITE_STRIPE_PUBLISHABLE_KEY ||
    ''
  ).trim();

  if (envSecret && envPublishable) {
    const envSkSig = getStripeKeySignature(envSecret);
    const envPkSig = getStripeKeySignature(envPublishable);
    if (envSkSig && envPkSig && envSkSig === envPkSig) {
      return { secretKey: envSecret, publishableKey: envPublishable };
    }
    const filePkSig = getStripeKeySignature(filePublishable);
    if (envSkSig && filePkSig && envSkSig === filePkSig) {
      return { secretKey: envSecret, publishableKey: filePublishable };
    }
  }

  if (fileSecret && filePublishable) {
    return { secretKey: fileSecret, publishableKey: filePublishable };
  }

  return {
    secretKey: envSecret || fileSecret,
    publishableKey: envPublishable || filePublishable,
  };
}

function getStripeClient(): Stripe {
  const { secretKey } = loadRuntimeStripeKeys();
  if (!secretKey) {
    throw new Error(
      'STRIPE_SECRET_KEY is not configured in server environment variables.'
    );
  }
  return new Stripe(secretKey);
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  emailVerified: boolean;
}

async function verifyFirebaseIdToken(authHeader?: string): Promise<VerifiedFirebaseUser> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing Authorization Bearer token.');
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  if (!idToken) {
    throw new Error('Empty Firebase ID token.');
  }

  const firebaseConfig = loadFirebaseConfig();
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
      firebaseConfig.apiKey
    )}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!response.ok) {
    throw new Error('Invalid or expired Google Sign-In session. Please sign in again.');
  }

  const data = (await response.json()) as {
    users?: Array<{
      localId?: string;
      email?: string;
      emailVerified?: boolean;
    }>;
  };

  const account = data.users?.[0];
  if (!account?.localId || !account.email) {
    throw new Error('Unable to resolve authenticated user account.');
  }
  if (!account.emailVerified) {
    throw new Error('A verified Google email address is required to place orders.');
  }

  return {
    uid: account.localId,
    email: account.email,
    emailVerified: Boolean(account.emailVerified),
  };
}

async function resolveAuthoritativeItem(
  itemId: string,
  idToken: string
): Promise<{ id: string; name: string; pricePence: number }> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(itemId)) {
    throw new Error(`Invalid item identifier: ${itemId}`);
  }

  const firebaseConfig = loadFirebaseConfig();
  const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    firebaseConfig.projectId
  )}/databases/${encodeURIComponent(
    firebaseConfig.firestoreDatabaseId
  )}/documents/menuItems/${encodeURIComponent(itemId)}`;

  const fsRes = await fetch(docUrl, {
    headers: { Authorization: `Bearer ${idToken}` },
  });

  if (fsRes.ok) {
    const docData = (await fsRes.json()) as {
      fields?: {
        name?: { stringValue?: string };
        pricePence?: { integerValue?: string };
        available?: { booleanValue?: boolean };
      };
    };
    const name = docData.fields?.name?.stringValue;
    const pricePence = Number(docData.fields?.pricePence?.integerValue);
    const available = docData.fields?.available?.booleanValue;

    if (!available) {
      throw new Error(`"${name || itemId}" is currently sold out.`);
    }
    if (!name || !Number.isInteger(pricePence) || pricePence < 100 || pricePence > 500) {
      throw new Error(`Invalid menu item price configuration for "${itemId}".`);
    }
    return { id: itemId, name, pricePence };
  }

  const fallback = DEFAULT_CATALOG_ITEMS.find((item) => item.id === itemId && item.available);
  if (fallback) {
    return {
      id: fallback.id,
      name: fallback.name,
      pricePence: fallback.pricePence,
    };
  }

  throw new Error(`Menu item "${itemId}" was not found or is unavailable.`);
}

export function resolveOriginFromHeaders(headers: Record<string, unknown>): string {
  const originHeader = headers['origin'];
  if (typeof originHeader === 'string' && originHeader.startsWith('http')) {
    return originHeader.replace(/\/$/, '');
  }
  if (process.env.APP_URL && process.env.APP_URL.startsWith('http')) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const proto =
    (typeof headers['x-forwarded-proto'] === 'string'
      ? headers['x-forwarded-proto'].split(',')[0].trim()
      : '') || 'https';
  const host =
    (typeof headers['x-forwarded-host'] === 'string'
      ? headers['x-forwarded-host']
      : typeof headers['host'] === 'string'
        ? headers['host']
        : '') || 'localhost:3000';
  return `${proto}://${host}`;
}

export function getStripeConfigPayload() {
  const { publishableKey, secretKey } = loadRuntimeStripeKeys();
  return {
    publishableKey,
    configured: Boolean(publishableKey && secretKey),
    mode: publishableKey.startsWith('pk_live_') ? 'live' : 'test',
  };
}

export async function createCheckoutSessionPayload(params: {
  authHeader?: string;
  origin: string;
  body: {
    items?: Array<{ itemId?: string; quantity?: number }>;
    diningOption?: string;
    checkoutMode?: 'embedded' | 'hosted';
  };
}) {
  const user = await verifyFirebaseIdToken(params.authHeader);
  const idToken = params.authHeader!.slice('Bearer '.length).trim();

  const { body } = params;
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 20) {
    throw new Error('Please select between 1 and 20 items.');
  }

  const diningOption = body.diningOption === 'Takeaway' ? 'Takeaway' : 'Dine In';
  const checkoutMode = body.checkoutMode === 'hosted' ? 'hosted' : 'embedded';

  const quantityMap = new Map<string, number>();
  for (const raw of body.items) {
    const id = String(raw.itemId || '').trim();
    const qty = Number(raw.quantity);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw new Error('Invalid item quantity in bag.');
    }
    quantityMap.set(id, (quantityMap.get(id) || 0) + qty);
  }

  const validatedItems: Array<{
    menuItemId: string;
    name: string;
    unitPricePence: number;
    quantity: number;
    lineTotalPence: number;
  }> = [];

  let totalQuantity = 0;
  let totalPence = 0;

  for (const [itemId, quantity] of quantityMap.entries()) {
    if (quantity > 20) {
      throw new Error('Maximum 20 units per menu item.');
    }
    const resolved = await resolveAuthoritativeItem(itemId, idToken);
    const lineTotalPence = resolved.pricePence * quantity;
    validatedItems.push({
      menuItemId: resolved.id,
      name: resolved.name,
      unitPricePence: resolved.pricePence,
      quantity,
      lineTotalPence,
    });
    totalQuantity += quantity;
    totalPence += lineTotalPence;
  }

  if (totalQuantity < 1 || totalQuantity > 50 || totalPence < 100 || totalPence > 25000) {
    throw new Error('Order total must be between £1.00 and £250.00.');
  }

  const orderNumber = `BF-${Math.floor(100000 + Math.random() * 900000)}`;
  const stripe = getStripeClient();

  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = validatedItems.map(
    (item) => ({
      quantity: item.quantity,
      price_data: {
        currency: 'gbp',
        unit_amount: item.unitPricePence,
        product_data: {
          name: item.name,
          description: `Bistro Five · ${diningOption}`,
        },
      },
    })
  );

  if (checkoutMode === 'hosted') {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer_email: user.email,
      line_items: lineItems,
      metadata: {
        userId: user.uid,
        orderNumber,
        diningOption,
      },
      success_url: `${params.origin}/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${params.origin}/?checkout_cancelled=1`,
    });

    return {
      sessionId: session.id,
      hostedUrl: session.url,
      orderNumber,
      validatedItems,
      totalQuantity,
      totalPence,
    };
  }

  const session = await stripe.checkout.sessions.create({
    ui_mode: 'embedded_page' as unknown as Stripe.Checkout.SessionCreateParams.UiMode,
    redirect_on_completion: 'if_required',
    mode: 'payment',
    customer_email: user.email,
    line_items: lineItems,
    metadata: {
      userId: user.uid,
      orderNumber,
      diningOption,
    },
    return_url: `${params.origin}/?session_id={CHECKOUT_SESSION_ID}`,
  });

  return {
    sessionId: session.id,
    clientSecret: session.client_secret,
    orderNumber,
    validatedItems,
    totalQuantity,
    totalPence,
  };
}

export async function verifyStripeSessionPayload(params: {
  authHeader?: string;
  sessionId?: string;
}) {
  const user = await verifyFirebaseIdToken(params.authHeader);
  const { sessionId } = params;

  if (!sessionId || typeof sessionId !== 'string' || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    throw new Error('Invalid Stripe Checkout Session ID.');
  }

  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(sessionId);

  const isAdminRequester = user.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();
  const sessionOwnerUid = session.metadata?.userId;

  if (!isAdminRequester && sessionOwnerUid && sessionOwnerUid !== user.uid) {
    throw new Error('This payment session belongs to a different account.');
  }

  const rawPi =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : session.payment_intent?.id || '';

  const isPaid = session.payment_status === 'paid';
  const safePaymentIntentId = isPaid
    ? rawPi && /^pi_[a-zA-Z0-9_]+$/.test(rawPi)
      ? rawPi
      : `pi_verified_${session.id.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 28)}`
    : '';

  return {
    verified: isPaid,
    sessionId: session.id,
    status: session.status,
    paymentStatus: session.payment_status,
    amountTotal: session.amount_total ?? 0,
    currency: session.currency ?? 'gbp',
    paymentIntentId: safePaymentIntentId,
    orderNumber: session.metadata?.orderNumber || '',
    customerEmail: session.customer_details?.email || session.customer_email || '',
  };
}
