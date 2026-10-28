import fs from 'node:fs';
import Stripe from 'stripe';

const FIREBASE_PROJECT_ID = 'gen-lang-client-0405014241';
const FIREBASE_API_KEY = 'AIzaSyD3VzXthlstky7k7Ul3z4YH4lJBq4SyNcY';
const FIRESTORE_DATABASE_ID =
  'ai-studio-bistrofiveartisa-bfacd9a9-ee5a-4769-9327-6d22c88429ec';

const DEFAULT_MENU_FALLBACK: Array<{
  id: string;
  name: string;
  pricePence: number;
}> = [
  { id: 'sea-salt-brownie', name: 'Maldon Sea Salt Dark Brownie', pricePence: 100 },
  { id: 'butter-croissant', name: 'All-Butter Laminated Croissant', pricePence: 200 },
  { id: 'spiced-cardamom-chai', name: 'Spiced Cardamom Masala Chai', pricePence: 300 },
  { id: 'cheddar-sourdough-toastie', name: 'Aged Cheddar Sourdough Toastie', pricePence: 400 },
  {
    id: 'halloumi-pomegranate-flatbread',
    name: 'Charred Halloumi & Pomegranate Flatbread',
    pricePence: 500,
  },
];

function getStripeSecretKey(): string {
  const envSecret = (
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_SECRET ||
    process.env.VITE_STRIPE_SECRET_KEY ||
    ''
  ).trim();
  if (envSecret) return envSecret;

  try {
    if (fs.existsSync('/tmp/stripe-runtime-secrets.json')) {
      const parsed = JSON.parse(
        fs.readFileSync('/tmp/stripe-runtime-secrets.json', 'utf8')
      ) as { secretKey?: string };
      if (parsed.secretKey) return parsed.secretKey.trim();
    }
  } catch {
    // Ignore
  }

  throw new Error(
    'STRIPE_SECRET_KEY is missing on the server. Add STRIPE_SECRET_KEY in Vercel Project Settings → Environment Variables and Redeploy.'
  );
}

async function verifyFirebaseUser(authHeader?: string) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing Google Sign-In authorization token.');
  }
  const idToken = authHeader.slice('Bearer '.length).trim();
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
      FIREBASE_API_KEY
    )}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );

  if (!response.ok) {
    throw new Error('Your Google Sign-In session expired. Please sign in again.');
  }

  const data = (await response.json()) as {
    users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
  };
  const account = data.users?.[0];
  if (!account?.localId || !account.email || !account.emailVerified) {
    throw new Error('Verified Google account required to start payment.');
  }

  return { uid: account.localId, email: account.email, idToken };
}

async function resolveMenuItem(itemId: string, idToken: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(itemId)) {
    throw new Error(`Invalid item identifier: ${itemId}`);
  }

  const docUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    FIREBASE_PROJECT_ID
  )}/databases/${encodeURIComponent(
    FIRESTORE_DATABASE_ID
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
      throw new Error(`Invalid item price for "${itemId}".`);
    }
    return { id: itemId, name, pricePence };
  }

  const fallback = DEFAULT_MENU_FALLBACK.find((item) => item.id === itemId);
  if (fallback) return fallback;

  throw new Error(`Menu item "${itemId}" was not found.`);
}

function resolveOrigin(headers: Record<string, unknown>): string {
  const originHeader = headers['origin'];
  if (typeof originHeader === 'string' && originHeader.startsWith('http')) {
    return originHeader.replace(/\/$/, '');
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

export async function processCreateCheckoutSession(params: {
  authHeader?: string;
  headers: Record<string, unknown>;
  body: {
    items?: Array<{ itemId?: string; quantity?: number }>;
    diningOption?: string;
  };
}) {
  const user = await verifyFirebaseUser(params.authHeader);
  const { body } = params;

  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 20) {
    throw new Error('Please select between 1 and 20 menu items.');
  }

  const diningOption = body.diningOption === 'Takeaway' ? 'Takeaway' : 'Dine In';
  const quantityMap = new Map<string, number>();

  for (const raw of body.items) {
    const id = String(raw.itemId || '').trim();
    const qty = Number(raw.quantity);
    if (!id || !Number.isInteger(qty) || qty < 1 || qty > 20) {
      throw new Error('Invalid item quantity.');
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
      throw new Error('Maximum 20 units per item.');
    }
    const resolved = await resolveMenuItem(itemId, user.idToken);
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
  const origin = resolveOrigin(params.headers);
  const stripe = new Stripe(getStripeSecretKey());

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: user.email,
    line_items: validatedItems.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: 'gbp',
        unit_amount: item.unitPricePence,
        product_data: {
          name: item.name,
          description: `Bistro Five · ${diningOption}`,
        },
      },
    })),
    metadata: {
      userId: user.uid,
      orderNumber,
      diningOption,
    },
    success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/?checkout_cancelled=1`,
  });

  if (!session.url) {
    throw new Error('Stripe did not return a hosted checkout URL.');
  }

  return {
    sessionId: session.id,
    hostedUrl: session.url,
    orderNumber,
    validatedItems,
    totalQuantity,
    totalPence,
  };
}

export default async function handler(
  req: {
    method?: string;
    headers: Record<string, unknown>;
    body?: unknown;
  },
  res: { status: (code: number) => { json: (body: unknown) => void } }
) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  try {
    const parsedBody =
      typeof req.body === 'string'
        ? (JSON.parse(req.body) as Record<string, unknown>)
        : ((req.body || {}) as Record<string, unknown>);

    const result = await processCreateCheckoutSession({
      authHeader:
        typeof req.headers.authorization === 'string'
          ? req.headers.authorization
          : undefined,
      headers: req.headers,
      body: parsedBody,
    });
    res.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to create Stripe Checkout session.';
    res.status(400).json({ error: message });
  }
}
