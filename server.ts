import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';
import { DEFAULT_CATALOG_ITEMS, PRIMARY_ADMIN_EMAIL } from './src/shared/catalogData.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FirebaseAppletConfig {
  projectId: string;
  apiKey: string;
  firestoreDatabaseId: string;
}

const firebaseConfigPath = path.join(__dirname, 'firebase-applet-config.json');
const firebaseConfig: FirebaseAppletConfig = JSON.parse(
  fs.readFileSync(firebaseConfigPath, 'utf8')
);

function getStripeClient(): Stripe {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error('Server Stripe secret key is not configured in environment.');
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

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseConfig.apiKey)}`,
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

interface ResolvedMenuItem {
  id: string;
  name: string;
  pricePence: number;
}

async function resolveAuthoritativeItem(
  itemId: string,
  idToken: string
): Promise<ResolvedMenuItem> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(itemId)) {
    throw new Error(`Invalid item identifier: ${itemId}`);
  }

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

  // Fallback to default server catalog if Firestore collection hasn't been seeded yet
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

function resolveRequestOrigin(req: express.Request): string {
  const originHeader = req.headers.origin;
  if (typeof originHeader === 'string' && originHeader.startsWith('http')) {
    return originHeader.replace(/\/$/, '');
  }
  if (process.env.APP_URL && process.env.APP_URL.startsWith('http')) {
    return process.env.APP_URL.replace(/\/$/, '');
  }
  const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '64kb' }));

  // Public Stripe configuration endpoint (NEVER exposes secret key)
  app.get('/api/stripe/config', (_req, res) => {
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY || '';
    const hasSecret = Boolean(process.env.STRIPE_SECRET_KEY);
    res.json({
      publishableKey,
      configured: Boolean(publishableKey && hasSecret),
      mode: publishableKey.startsWith('pk_live_') ? 'live' : 'test',
    });
  });

  // Create real Stripe Checkout Session (£1.00 - £5.00 GBP items)
  app.post('/api/stripe/create-checkout-session', async (req, res) => {
    try {
      const authHeader = req.headers.authorization;
      const user = await verifyFirebaseIdToken(authHeader);
      const idToken = authHeader!.slice('Bearer '.length).trim();

      const body = req.body as {
        items?: Array<{ itemId?: string; quantity?: number }>;
        diningOption?: string;
        checkoutMode?: 'embedded' | 'hosted';
      };

      if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 20) {
        res.status(400).json({ error: 'Please select between 1 and 20 items.' });
        return;
      }

      const diningOption = body.diningOption === 'Takeaway' ? 'Takeaway' : 'Dine In';
      const checkoutMode = body.checkoutMode === 'hosted' ? 'hosted' : 'embedded';

      // Merge duplicate itemIds cleanly
      const quantityMap = new Map<string, number>();
      for (const raw of body.items) {
        const id = String(raw.itemId || '').trim();
        const qty = Number(raw.quantity);
        if (!id || !Number.isInteger(qty) || qty < 1 || qty > 20) {
          res.status(400).json({ error: 'Invalid item quantity in bag.' });
          return;
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
          res.status(400).json({ error: 'Maximum 20 units per menu item.' });
          return;
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
        res.status(400).json({ error: 'Order total must be between £1.00 and £250.00.' });
        return;
      }

      const orderNumber = `BF-${Math.floor(100000 + Math.random() * 900000)}`;
      const origin = resolveRequestOrigin(req);
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
          success_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/?checkout_cancelled=1`,
        });

        res.json({
          sessionId: session.id,
          hostedUrl: session.url,
          orderNumber,
          validatedItems,
          totalQuantity,
          totalPence,
        });
        return;
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
        return_url: `${origin}/?session_id={CHECKOUT_SESSION_ID}`,
      });

      res.json({
        sessionId: session.id,
        clientSecret: session.client_secret,
        orderNumber,
        validatedItems,
        totalQuantity,
        totalPence,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start Stripe Checkout.';
      console.error('Stripe create-checkout-session error:', message);
      res.status(400).json({ error: message });
    }
  });

  // Verify Stripe Checkout Session directly with Stripe Live API
  app.post('/api/stripe/verify-session', async (req, res) => {
    try {
      const user = await verifyFirebaseIdToken(req.headers.authorization);
      const { sessionId } = req.body as { sessionId?: string };

      if (!sessionId || typeof sessionId !== 'string' || !/^cs_[a-zA-Z0-9_]+$/.test(sessionId)) {
        res.status(400).json({ error: 'Invalid Stripe Checkout Session ID.' });
        return;
      }

      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.retrieve(sessionId);

      const isAdminRequester = user.email.toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase();
      const sessionOwnerUid = session.metadata?.userId;

      if (!isAdminRequester && sessionOwnerUid && sessionOwnerUid !== user.uid) {
        res.status(403).json({ error: 'This payment session belongs to a different account.' });
        return;
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

      res.json({
        verified: isPaid,
        sessionId: session.id,
        status: session.status,
        paymentStatus: session.payment_status,
        amountTotal: session.amount_total ?? 0,
        currency: session.currency ?? 'gbp',
        paymentIntentId: safePaymentIntentId,
        orderNumber: session.metadata?.orderNumber || '',
        customerEmail: session.customer_details?.email || session.customer_email || '',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to verify Stripe session.';
      console.error('Stripe verify-session error:', message);
      res.status(400).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Bistro Five server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
