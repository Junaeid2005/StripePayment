import fs from 'node:fs';

const ISOLATED_RUNTIME_SECRETS_PATH = '/tmp/stripe-runtime-secrets.json';

export function resolveStripeKeys() {
  let fileSecret = '';
  let filePublishable = '';

  try {
    if (fs.existsSync(ISOLATED_RUNTIME_SECRETS_PATH)) {
      const parsed = JSON.parse(
        fs.readFileSync(ISOLATED_RUNTIME_SECRETS_PATH, 'utf8')
      ) as { secretKey?: string; publishableKey?: string };
      fileSecret = (parsed.secretKey || '').trim();
      filePublishable = (parsed.publishableKey || '').trim();
    }
  } catch {
    // Ignore isolated runtime file read errors
  }

  const secretKey = (
    process.env.STRIPE_SECRET_KEY ||
    process.env.STRIPE_SECRET ||
    process.env.VITE_STRIPE_SECRET_KEY ||
    fileSecret
  ).trim();

  const publishableKey = (
    process.env.STRIPE_PUBLISHABLE_KEY ||
    process.env.VITE_STRIPE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ||
    filePublishable
  ).trim();

  const isLive =
    secretKey.startsWith('rk_live_') ||
    secretKey.startsWith('sk_live_') ||
    publishableKey.startsWith('pk_live_');

  return {
    configured: Boolean(secretKey),
    publishableKey,
    mode: isLive ? 'live' : 'test',
  };
}

export default function handler(
  req: { method?: string },
  res: { status: (code: number) => { json: (body: unknown) => void } }
) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  res.status(200).json(resolveStripeKeys());
}
