import {
  createCheckoutSessionPayload,
  resolveOriginFromHeaders,
} from '../_lib/stripeBackend';

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

    const result = await createCheckoutSessionPayload({
      authHeader:
        typeof req.headers.authorization === 'string'
          ? req.headers.authorization
          : undefined,
      origin: resolveOriginFromHeaders(req.headers),
      body: parsedBody,
    });
    res.status(200).json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unable to start Stripe Checkout.';
    res.status(400).json({ error: message });
  }
}
