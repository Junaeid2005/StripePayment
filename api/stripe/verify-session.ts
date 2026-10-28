import fs from 'node:fs';
import Stripe from 'stripe';

const FIREBASE_API_KEY = 'AIzaSyD3VzXthlstky7k7Ul3z4YH4lJBq4SyNcY';
const PRIMARY_ADMIN_EMAIL = 'junaeidshohan2005@gmail.com';

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
    'STRIPE_SECRET_KEY is missing on the server. Add STRIPE_SECRET_KEY in Vercel Environment Variables and Redeploy.'
  );
}

async function verifyFirebaseUser(authHeader?: string) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new Error('Missing authorization token.');
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
    throw new Error('Invalid or expired Google Sign-In session.');
  }

  const data = (await response.json()) as {
    users?: Array<{ localId?: string; email?: string; emailVerified?: boolean }>;
  };
  const account = data.users?.[0];
  if (!account?.localId || !account.email || !account.emailVerified) {
    throw new Error('Verified Google account required.');
  }

  return { uid: account.localId, email: account.email };
}

export async function processVerifyStripeSession(params: {
  authHeader?: string;
  sessionId?: string;
}) {
  const user = await verifyFirebaseUser(params.authHeader);
  const { sessionId } = params;

  if (!sessionId || typeof sessionId !== 'string' || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
    throw new Error('Invalid Stripe Checkout Session ID.');
  }

  const stripe = new Stripe(getStripeSecretKey());
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
        ? (JSON.parse(req.body) as { sessionId?: string })
        : ((req.body || {}) as { sessionId?: string });

    const result = await processVerifyStripeSession({
      authHeader:
        typeof req.headers.authorization === 'string'
          ? req.headers.authorization
          : undefined,
      sessionId: parsedBody.sessionId,
    });
    res.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to verify Stripe session.';
    res.status(400).json({ error: message });
  }
}
