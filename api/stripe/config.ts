import { getStripeConfigPayload } from '../_lib/stripeBackend';

export default function handler(
  req: { method?: string },
  res: { status: (code: number) => { json: (body: unknown) => void } }
) {
  if (req.method && req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  res.status(200).json(getStripeConfigPayload());
}
