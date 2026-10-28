import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createCheckoutSessionPayload,
  getStripeConfigPayload,
  resolveOriginFromHeaders,
  verifyStripeSessionPayload,
} from './api/_lib/stripeBackend.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '64kb' }));

  app.get('/api/stripe/config', (_req, res) => {
    res.json(getStripeConfigPayload());
  });

  app.post('/api/stripe/create-checkout-session', async (req, res) => {
    try {
      const result = await createCheckoutSessionPayload({
        authHeader: req.headers.authorization,
        origin: resolveOriginFromHeaders(req.headers as Record<string, unknown>),
        body: req.body || {},
      });
      res.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to start Stripe Checkout.';
      console.error('Stripe create-checkout-session error:', message);
      res.status(400).json({ error: message });
    }
  });

  app.post('/api/stripe/verify-session', async (req, res) => {
    try {
      const result = await verifyStripeSessionPayload({
        authHeader: req.headers.authorization,
        sessionId: req.body?.sessionId,
      });
      res.json(result);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to verify Stripe session.';
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
